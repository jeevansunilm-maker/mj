// Builds the system prompt (hidden instructions sent with every request)
// and validates the chat history coming from the browser.

export function buildSystemPrompt(p) {
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
