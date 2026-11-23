// The actions ("tools") your AI can take. Each tool has:
//   name, description  → what the AI reads to decide when to use it
//   parameters         → a JSON schema of the inputs (checked before running)
//   run(input)         → does the work; returns { result, display }
//       result  = what the AI is told happened
//       display = what the chat window shows (a card)
import { parseDueAt } from "../reminders.js";

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const pct = (description) => ({ type: "integer", minimum: 0, maximum: 100, description });

export function createTools({ reminders, system, apps = {}, pendingActions }) {
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

/** Short note added to the chat history so the AI remembers what it did. */
export function describeAction(a) {
  return a.isError ? `[${a.name} failed: ${a.result?.error}]` : `[used ${a.name}: ${JSON.stringify(a.input)}]`;
}
