// Telegram bot: message your AI from your phone.
// Uses long polling (getUpdates), so it works from your PC with no public URL.
// Bot API docs: https://core.telegram.org/bots/api
//
// SECURITY: only Telegram user IDs in TELEGRAM_ALLOWED_USERS can use it,
// because the AI can control your PC. Anyone else is told their ID and ignored.
import { chunkText, createBotBrain, describeCard } from "./brain.js";

const CHANNEL_NOTE =
  "You are replying in Telegram on the user's phone. Keep answers short and in plain text (no Markdown). " +
  "Actions needing confirmation show Confirm/Cancel buttons in the chat.";

export function startTelegramBot({ token, allowedUsers, engine, pendingActions, fetchImpl = fetch, baseUrl = "https://api.telegram.org", log = console }) {
  const api = `${baseUrl}/bot${token}`;
  const brain = createBotBrain({ engine, channelNote: CHANNEL_NOTE });
  const allowed = new Set(allowedUsers.map(String));
  let offset = 0;
  let running = true;
  let controller = new AbortController();

  async function call(method, body) {
    const res = await fetchImpl(`${api}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description ?? res.status}`);
      err.status = res.status;
      throw err;
    }
    return data.result;
  }

  const send = async (chatId, text, extra = {}) => {
    for (const part of chunkText(text || "(no reply)", 4000)) await call("sendMessage", { chat_id: chatId, text: part, ...extra });
  };

  async function onMessage(msg) {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "");
    const text = msg.text?.trim();
    if (!text) return send(chatId, "I can read text messages for now.");
    if (!allowed.has(userId)) {
      log.warn?.(`[telegram] ignored message from user ${userId}`);
      return send(chatId, `Hi! I'm a private assistant. Your Telegram user ID is ${userId}. ` +
        "If this is your bot, add it to TELEGRAM_ALLOWED_USERS in .env and restart the app.");
    }
    if (text === "/start") return send(chatId, "Hi! I'm your personal AI. Ask me anything. Send /new to start a fresh conversation.");
    if (text === "/new") { brain.reset(chatId); return send(chatId, "Okay, fresh start."); }

    const typing = setInterval(() => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}), 4500);
    call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    try {
      const { text: reply, actions } = await brain.reply(chatId, text);
      for (const a of actions) {
        const d = a.display ?? { kind: a.isError ? "error" : "info", text: a.note };
        const extra = d.kind === "confirm" ? {
          reply_markup: { inline_keyboard: [[
            { text: "✅ Confirm", callback_data: `confirm:${d.id}` },
            { text: "Cancel", callback_data: `cancel:${d.id}` },
          ]] },
        } : {};
        await send(chatId, describeCard(d), extra);
      }
      if (reply) await send(chatId, reply);
    } finally {
      clearInterval(typing);
    }
  }

  async function onCallback(q) {
    const userId = String(q.from?.id ?? "");
    const [action, id] = String(q.data ?? "").split(":");
    if (!allowed.has(userId)) return call("answerCallbackQuery", { callback_query_id: q.id, text: "Not allowed." });
    let result;
    try {
      if (action === "confirm") result = `✓ Done: ${await pendingActions.confirm(id)}`;
      else { pendingActions.cancel(id); result = "Cancelled."; }
    } catch (err) {
      result = `✗ ${err.message}`;
    }
    await call("answerCallbackQuery", { callback_query_id: q.id, text: result.slice(0, 190) });
    if (q.message) {
      await call("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${q.message.text ?? ""}\n\n${result}` }).catch(() => {});
    }
  }

  async function loop() {
    let backoff = 1000;
    while (running) {
      try {
        const updates = await call("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          // Handle each update without blocking the poll loop.
          const job = u.callback_query ? onCallback(u.callback_query) : u.message ? onMessage(u.message) : null;
          job?.catch((err) => log.error?.("[telegram]", err.message));
        }
      } catch (err) {
        if (!running) return;
        if (err.status === 401 || err.status === 404) {
          log.error?.("[telegram] The bot token was rejected. Check TELEGRAM_BOT_TOKEN in .env. Telegram bot stopped.");
          running = false;
          return;
        }
        const why = err.status ? err.message : "can't reach Telegram (check your internet)";
        log.error?.(`[telegram] ${why}; retrying in ${backoff / 1000}s`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  const done = loop();
  return {
    done,
    stop() { running = false; controller.abort(); controller = new AbortController(); return done; },
  };
}
