// The actions ("tools") your AI can take. Each tool has:
//   name, description  → what the AI reads to decide when to use it
//   parameters         → a JSON schema of the inputs (checked before running)
//   run(input)         → does the work; returns { result, display }
//       result  = what the AI is told happened
//       display = what the chat window shows (a card)
import { parseDueAt } from "../reminders.js";
import { parseSpreadsheetId, sheetUrl } from "../google/sheets.js";

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const pct = (description) => ({ type: "integer", minimum: 0, maximum: 100, description });

const MAX_READ_ROWS = 200;
const MAX_READ_COLS = 26;
const preview = (rows, n = 8) => rows.slice(0, n).map((r) => r.slice(0, 8).map((c) => String(c ?? "")));

export function createTools({ reminders, system, apps = {}, pendingActions, sheets }) {
  const tools = [
    {
      name: "create_reminder",
      description:
        "Set a reminder that pops up on the user's computer at a specific time. " +
        "Work out the exact time from the current time given in the user's message.",
      parameters: {
        type: "object",
        properties: {
          text: str("What to remind the user about, e.g. 'Call mom'", { maxLength: 300 }),
          due_at: str("When, as local ISO 8601 date-time, e.g. 2026-11-23T18:30:00"),
        },
        required: ["text", "due_at"],
      },
      async run({ text, due_at }) {
        const r = await reminders.add({ text, dueAt: parseDueAt(due_at) });
        return { result: { created: r }, display: { kind: "reminder", text: r.text, dueAt: r.dueAt } };
      },
    },
    {
      name: "list_reminders",
      description: "List the user's upcoming and unacknowledged reminders.",
      parameters: { type: "object", properties: {} },
      async run() {
        const list = await reminders.list();
        return {
          result: { reminders: list.map(({ id, text, dueAt, status }) => ({ id, text, dueAt, status })) },
          display: { kind: "info", text: `Checked reminders (${list.length})` },
        };
      },
    },
    {
      name: "cancel_reminder",
      description: "Delete a reminder by its id (get ids from list_reminders).",
      parameters: { type: "object", properties: { id: str("Reminder id") }, required: ["id"] },
      async run({ id }) {
        const r = await reminders.remove(id);
        if (!r) throw new Error(`No reminder with id ${id}`);
        return { result: { cancelled: r }, display: { kind: "info", text: `Cancelled reminder: ${r.text}` } };
      },
    },
    {
      name: "draft_email",
      description:
        "Write an email draft for the user to review and send themselves. " +
        "The app shows it with buttons to open it in their email app or Gmail. It does NOT send anything.",
      parameters: {
        type: "object",
        properties: {
          to: str("Recipient email address(es), comma-separated. Empty if unknown.", { maxLength: 500 }),
          subject: str("Subject line", { maxLength: 300 }),
          body: str("Full email body in plain text", { maxLength: 20000 }),
        },
        required: ["subject", "body"],
      },
      async run({ to = "", subject, body }) {
        return {
          result: { drafted: true, note: "Shown to the user to review; not sent." },
          display: { kind: "email", to, subject, body },
        };
      },
    },
  ];

  if (sheets) tools.push(...sheetTools(sheets, pendingActions));
  if (!system?.supported) return tools;

  const appNames = Object.keys(apps);
  tools.push(
    {
      name: "volume",
      description: "Read or change the computer's speaker volume, or mute/unmute it.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "mute", "unmute"], description: "What to do" },
          level: pct("Volume 0-100, required for action=set. For 'louder/quieter', get the current level first."),
        },
        required: ["action"],
      },
      async run({ action, level }) {
        if (action === "set" && level === undefined) throw new Error("level is required for action=set");
        const r = await system.volume(action, level);
        return { result: r, display: { kind: "info", icon: "🔊", text: r.muted ? "Volume muted" : `Volume: ${r.volume}%` } };
      },
    },
    {
      name: "brightness",
      description: "Read or change screen brightness (built-in laptop screens).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set"], description: "What to do" },
          level: pct("Brightness 0-100, required for action=set"),
        },
        required: ["action"],
      },
      async run({ action, level }) {
        if (action === "set" && level === undefined) throw new Error("level is required for action=set");
        const r = await system.brightness(action, level);
        return { result: r, display: { kind: "info", icon: "☀️", text: `Brightness: ${r.brightness}%` } };
      },
    },
    {
      name: "power",
      description:
        "Lock the screen, put the PC to sleep, shut it down, restart it, or cancel a pending shutdown. " +
        "Shutdown, restart and sleep are NOT done immediately: the user gets a Confirm button. " +
        "Tell them to click it. Only use when the user clearly asks.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["lock", "sleep", "shutdown", "restart", "cancel_shutdown"] },
        },
        required: ["action"],
      },
      async run({ action }) {
        if (action === "lock" || action === "cancel_shutdown") {
          await system.power(action);
          const text = action === "lock" ? "Screen locked" : "Shutdown cancelled";
          return { result: { done: true }, display: { kind: "info", icon: "🔒", text } };
        }
        const label = { sleep: "Put the PC to sleep", shutdown: "Shut down the PC (in 30 s)", restart: "Restart the PC (in 30 s)" }[action];
        const id = pendingActions.create(label, () => system.power(action));
        return {
          result: { status: "waiting_for_user_confirmation", note: "Ask the user to click Confirm in the chat." },
          display: { kind: "confirm", id, text: label },
        };
      },
    },
    {
      name: "open_app",
      description: `Open an app on the computer. Allowed apps: ${appNames.join(", ")}.`,
      parameters: {
        type: "object",
        properties: { name: { type: "string", enum: appNames, description: "App name from the allowed list" } },
        required: ["name"],
      },
      async run({ name }) {
        await system.launch(apps[name]);
        return { result: { opened: name }, display: { kind: "info", icon: "🚀", text: `Opened ${name}` } };
      },
    },
    {
      name: "open_website",
      description:
        "Open a website in the user's browser, or search the web in the browser. Give either url or search_query.",
      parameters: {
        type: "object",
        properties: {
          url: str("Full http(s) URL", { maxLength: 2000 }),
          search_query: str("Text to search for on Google", { maxLength: 500 }),
        },
      },
      async run({ url, search_query }) {
        let target;
        if (url) {
          const u = new URL(url); // throws on garbage
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http/https links can be opened");
          target = u.href;
        } else if (search_query) {
          target = `https://www.google.com/search?q=${encodeURIComponent(search_query)}`;
        } else {
          throw new Error("Give url or search_query");
        }
        await system.launch(target);
        return { result: { opened: target }, display: { kind: "info", icon: "🌐", text: `Opened ${target}` } };
      },
    },
  );
  return tools;
}

// ── Google Sheets ─────────────────────────────────────────────
function sheetTools(sheets, pendingActions) {
  const spreadsheet = str("Google Sheets link (or ID) the user gave", { maxLength: 500 });
  const cell = { type: "string", maxLength: 5000, description: "Cell value; formulas like =SUM(A1:A5) allowed" };
  const rowsSchema = (description) => ({
    type: "array", minItems: 1, maxItems: 500, description,
    items: { type: "array", maxItems: 50, items: cell },
  });
  const shareHint = `The sheet must be shared with ${sheets.clientEmail} (Editor).`;

  return [
    {
      name: "sheets_info",
      description: `Get a Google Sheet's title and its tab names and sizes. Use first when you don't know the tab names. ${shareHint}`,
      parameters: { type: "object", properties: { spreadsheet }, required: ["spreadsheet"] },
      async run({ spreadsheet: s }) {
        const id = parseSpreadsheetId(s);
        const info = await sheets.info(id);
        return {
          result: info,
          display: { kind: "sheet", icon: "📊", text: `Opened “${info.title}” · tabs: ${info.tabs.map((t) => t.name).join(", ")}`, url: sheetUrl(id) },
        };
      },
    },
    {
      name: "sheets_read",
      description:
        "Read cells from a Google Sheet. range uses A1 notation with the tab name, e.g. 'Sheet1!A1:F50' " +
        `or just 'Sheet1' for the whole tab. Returns at most ${MAX_READ_ROWS} rows. ${shareHint}`,
      parameters: {
        type: "object",
        properties: { spreadsheet, range: str("A1 range, e.g. 'Budget!A1:D100' or 'Budget'", { maxLength: 200 }) },
        required: ["spreadsheet", "range"],
      },
      async run({ spreadsheet: s, range }) {
        const id = parseSpreadsheetId(s);
        const { range: got, values } = await sheets.read(id, range);
        const rows = values.slice(0, MAX_READ_ROWS).map((r) => r.slice(0, MAX_READ_COLS));
        const truncated = values.length > rows.length || values.some((r) => r.length > MAX_READ_COLS);
        return {
          result: { range: got, rows, ...(truncated ? { note: `Showing first ${MAX_READ_ROWS} rows / ${MAX_READ_COLS} columns only; read a smaller range for more.` } : {}) },
          display: { kind: "sheet", icon: "📖", text: `Read ${got} (${values.length} rows)`, rows: preview(rows), url: sheetUrl(id) },
        };
      },
    },
    {
      name: "sheets_append_rows",
      description:
        "Add new rows at the bottom of a table in a Google Sheet (doesn't change existing cells). " +
        `tab is the tab name, e.g. 'Expenses'. Read the header row first so the columns line up. ${shareHint}`,
      parameters: {
        type: "object",
        properties: {
          spreadsheet,
          tab: str("Tab name (optionally with columns, e.g. 'Expenses!A:D')", { maxLength: 200 }),
          rows: rowsSchema("Rows to add; each row is a list of cell values, left to right"),
        },
        required: ["spreadsheet", "tab", "rows"],
      },
      async run({ spreadsheet: s, tab, rows }) {
        const id = parseSpreadsheetId(s);
        const r = await sheets.append(id, tab, rows);
        return {
          result: r,
          display: { kind: "sheet", icon: "➕", text: `Added ${r.updatedRows} row(s) to ${r.updatedRange ?? tab}`, rows: preview(rows), url: sheetUrl(id) },
        };
      },
    },
    {
      name: "sheets_update_cells",
      description:
        "Overwrite existing cells in a Google Sheet, e.g. range 'Budget!B2:C3' with values [[...],[...]]. " +
        "This replaces what's there, so the user must click Confirm first. Tell them to click it. " +
        `To add new rows use sheets_append_rows instead. ${shareHint}`,
      parameters: {
        type: "object",
        properties: {
          spreadsheet,
          range: str("Exact A1 range to overwrite, with tab name", { maxLength: 200 }),
          values: rowsSchema("New values, row by row, matching the range's shape"),
        },
        required: ["spreadsheet", "range", "values"],
      },
      async run({ spreadsheet: s, range, values }) {
        const id = parseSpreadsheetId(s);
        const cells = values.reduce((n, r) => n + r.length, 0);
        const label = `Overwrite ${range} in your Google Sheet (${cells} cell${cells === 1 ? "" : "s"})`;
        const actionId = pendingActions.create(label, () => sheets.update(id, range, values));
        return {
          result: { status: "waiting_for_user_confirmation", note: "Ask the user to click Confirm in the chat." },
          display: { kind: "confirm", id: actionId, text: label, rows: preview(values), url: sheetUrl(id) },
        };
      },
    },
  ];
}

/** Short note added to the chat history so the AI remembers what it did. */
export function describeAction(a) {
  return a.isError ? `[${a.name} failed: ${a.result?.error}]` : `[used ${a.name}: ${JSON.stringify(a.input)}]`;
}
