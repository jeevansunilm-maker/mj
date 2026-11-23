// Shared logic for chat-app bots (Telegram, Discord): keeps a short history
// per conversation and runs each message through the same chat engine as the
// web app. Returns plain text plus any action cards to show.
import { ProviderError } from "../providers/errors.js";

const MAX_HISTORY = 30;

export function createBotBrain({ engine, channelNote }) {
  const histories = new Map();
  const queues = new Map(); // one message at a time per conversation

  async function run(key, userText) {
    const history = histories.get(key) ?? [];
    history.push({ role: "user", content: userText });
    let text = "";
    const actions = [];
    try {
      for await (const ev of engine.chat({ messages: history, channelNote })) {
        if (ev.type === "text") text += ev.text;
        else if (ev.type === "tool") actions.push(ev);
      }
    } catch (err) {
      history.pop(); // don't keep a turn that failed
      histories.set(key, history);
      const msg = err instanceof ProviderError ? err.message : "Something went wrong on my side.";
      if (!(err instanceof ProviderError)) console.error("[bot]", err);
      return { text: `⚠️ ${msg}`, actions: [] };
    }
    const notes = actions.map((a) => a.note).join("\n");
    history.push({ role: "assistant", content: [text.trim(), notes].filter(Boolean).join("\n") || "(done)" });
    histories.set(key, history.slice(-MAX_HISTORY));
    return { text: text.trim(), actions };
  }

  return {
    reset(key) { histories.delete(key); },
    reply(key, userText) {
      const prev = queues.get(key) ?? Promise.resolve();
      const next = prev.then(() => run(key, userText));
      queues.set(key, next.catch(() => {}));
      return next;
    },
  };
}

/** Plain-text version of an action card, for chat apps. */
export function describeCard(d = {}) {
  switch (d.kind) {
    case "reminder": return `⏰ Reminder set: ${d.text} · ${new Date(d.dueAt).toLocaleString()}`;
    case "email": return `✉️ Email draft${d.to ? ` to ${d.to}` : ""}\nSubject: ${d.subject}\n\n${d.body}`;
    case "confirm": return `⚠️ ${d.text}?`;
    case "error": return `⚠️ ${d.text}`;
    default: {
      const table = d.rows?.length ? "\n" + d.rows.slice(0, 5).map((r) => r.join(" | ")).join("\n") : "";
      return `${d.icon ?? "✓"} ${d.text}${table}${d.url ? `\n${d.url}` : ""}`;
    }
  }
}

/** Splits long text into chunks a chat app accepts. */
export function chunkText(text, max) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
