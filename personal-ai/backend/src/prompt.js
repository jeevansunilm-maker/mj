// Builds the system prompt (hidden instructions sent with every request)
// and validates the chat history coming from the browser.

export function buildSystemPrompt(p, { hasTools = false } = {}) {
  const lines = [
    `You are ${p.assistantName}, a personal AI assistant.`,
    `Personality and style: ${p.personality}`,
  ];
  if (p.userName) lines.push(`You are talking with ${p.userName}.`);
  if (p.aboutMe) {
    lines.push(
      "Things the user has told you about themselves (use them to personalise answers, " +
        "but don't repeat them back unprompted):",
      p.aboutMe,
    );
  }
  if (hasTools) {
    lines.push(
      "You can take actions on the user's computer with your tools (reminders, email drafts, and on " +
        "Windows: volume, brightness, opening apps and websites, power). Use a tool when the user asks " +
        "for that action; otherwise just answer. After using a tool, briefly confirm what you did. " +
        "Never claim you did something unless a tool result says it succeeded.",
    );
  }
  lines.push("Format answers in plain text with short paragraphs or simple lists.");
  return lines.join("\n");
}

const MAX_MESSAGES = 200;
const MAX_CHARS = 100_000;

/** Returns a clean [{role, content}] array, or null if the history is invalid. */
export function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== "",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length === 0 || msgs.at(-1).role !== "user") return null;
  return msgs;
}

/**
 * Adds the current date/time to the newest user message (not the system
 * prompt), so "remind me in 2 hours" works while the cached prompt prefix
 * stays the same from one request to the next.
 */
export function withCurrentTime(messages, now = new Date()) {
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const pad = (n) => String(n).padStart(2, "0");
  const local =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offset}`;
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const out = messages.slice();
  const last = out.at(-1);
  out[out.length - 1] = { ...last, content: `[Current local time: ${day} ${local}]\n${last.content}` };
  return out;
}
