// Discord bot: talk to your AI in Discord DMs, or by @mentioning it in a server.
// Connects out to Discord's Gateway (a WebSocket), so no public URL is needed.
// Uses Node's built-in WebSocket (Node 22+). Docs: https://discord.com/developers/docs/events/gateway
//
// SECURITY: only Discord user IDs in DISCORD_ALLOWED_USERS can use it.
// It only uses non-privileged intents: DMs, plus server messages that @mention it.
import { chunkText, createBotBrain, describeCard } from "./brain.js";

const API = "https://discord.com/api/v10";
const GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS = (1 << 9) | (1 << 12); // GUILD_MESSAGES | DIRECT_MESSAGES
const CHANNEL_NOTE =
  "You are replying in Discord. Keep answers short. Actions needing confirmation show Confirm/Cancel buttons.";

export function startDiscordBot({
  token, allowedUsers, engine, pendingActions,
  fetchImpl = fetch, apiBase = API, gatewayUrl = GATEWAY,
  connect = (url) => new WebSocket(url), log = console,
}) {
  const brain = createBotBrain({ engine, channelNote: CHANNEL_NOTE });
  const allowed = new Set(allowedUsers.map(String));
  let ws = null;
  let heartbeat = null;
  let seq = null;
  let botId = null;
  let running = true;
  let reconnectTimer = null;

  async function rest(method, path, body) {
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Discord ${method} ${path}: ${res.status} ${data.message ?? ""}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  const send = async (channelId, text, extra = {}, replyTo) => {
    const parts = chunkText(text || "(no reply)", 1900);
    for (let i = 0; i < parts.length; i++) {
      await rest("POST", `/channels/${channelId}/messages`, {
        content: parts[i],
        allowed_mentions: { parse: [] }, // never ping @everyone etc.
        ...(i === 0 && replyTo ? { message_reference: { message_id: replyTo } } : {}),
        ...(i === parts.length - 1 ? extra : {}),
      });
    }
  };

  const confirmButtons = (id) => ({
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Confirm", custom_id: `confirm:${id}` },
        { type: 2, style: 2, label: "Cancel", custom_id: `cancel:${id}` },
      ],
    }],
  });

  async function onMessage(m) {
    if (m.author?.bot) return;
    const isDm = !m.guild_id;
    const mentioned = (m.mentions ?? []).some((u) => u.id === botId);
    if (!isDm && !mentioned) return; // in servers, only answer when @mentioned
    const text = (m.content ?? "").replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
    if (!allowed.has(String(m.author.id))) {
      log.warn?.(`[discord] ignored message from user ${m.author.id}`);
      return send(m.channel_id, `I'm a private assistant. Your Discord user ID is ${m.author.id}. ` +
        "If this is your bot, add it to DISCORD_ALLOWED_USERS in .env and restart the app.", {}, m.id);
    }
    if (!text) return send(m.channel_id, "Hi! Ask me anything. Say `new` to start a fresh conversation.", {}, m.id);
    const key = m.channel_id;
    if (/^(new|\/new|reset)$/i.test(text)) { brain.reset(key); return send(m.channel_id, "Okay, fresh start.", {}, m.id); }

    rest("POST", `/channels/${m.channel_id}/typing`).catch(() => {});
    const typing = setInterval(() => rest("POST", `/channels/${m.channel_id}/typing`).catch(() => {}), 8000);
    try {
      const { text: reply, actions } = await brain.reply(key, text);
      for (const a of actions) {
        const d = a.display ?? { kind: a.isError ? "error" : "info", text: a.note };
        await send(m.channel_id, describeCard(d), d.kind === "confirm" ? confirmButtons(d.id) : {});
      }
      if (reply) await send(m.channel_id, reply, {}, m.id);
    } finally {
      clearInterval(typing);
    }
  }

  async function onInteraction(i) {
    const userId = String(i.member?.user?.id ?? i.user?.id ?? "");
    const [action, id] = String(i.data?.custom_id ?? "").split(":");
    let result;
    if (!allowed.has(userId)) result = "Not allowed.";
    else {
      try {
        if (action === "confirm") result = `✓ Done: ${await pendingActions.confirm(id)}`;
        else { pendingActions.cancel(id); result = "Cancelled."; }
      } catch (err) {
        result = `✗ ${err.message}`;
      }
    }
    // Type 7 = update the message the button was on (and remove the buttons).
    await rest("POST", `/interactions/${i.id}/${i.token}/callback`, {
      type: 7,
      data: { content: `${i.message?.content ?? ""}\n\n${result}`.trim(), components: [] },
    });
  }

  function open() {
    ws = connect(gatewayUrl);
    ws.onmessage = (e) => {
      const p = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString());
      if (p.s != null) seq = p.s;
      switch (p.op) {
        case 10: { // Hello: start heartbeating, then identify
          clearInterval(heartbeat);
          heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), p.d.heartbeat_interval);
          ws.send(JSON.stringify({
            op: 2,
            d: { token, intents: INTENTS, properties: { os: "windows", browser: "personal-ai", device: "personal-ai" } },
          }));
          break;
        }
        case 1: ws.send(JSON.stringify({ op: 1, d: seq })); break; // server asked for a heartbeat
        case 7: case 9: ws.close(4000, "reconnect"); break; // reconnect / invalid session
        case 0:
          if (p.t === "READY") { botId = p.d.user.id; log.log?.(`  ✔ Discord bot online as ${p.d.user.username}`); }
          else if (p.t === "MESSAGE_CREATE") onMessage(p.d).catch((err) => log.error?.("[discord]", err.message));
          else if (p.t === "INTERACTION_CREATE" && p.d.type === 3) onInteraction(p.d).catch((err) => log.error?.("[discord]", err.message));
          break;
      }
    };
    ws.onclose = (e) => {
      clearInterval(heartbeat);
      if (!running) return;
      if (e?.code === 4004) {
        log.error?.("[discord] The bot token was rejected. Check DISCORD_BOT_TOKEN in .env. Discord bot stopped.");
        running = false;
        return;
      }
      if (e?.code === 4014) {
        log.error?.("[discord] Discord refused the requested intents. Discord bot stopped.");
        running = false;
        return;
      }
      reconnectTimer = setTimeout(open, 5000);
    };
    ws.onerror = () => {}; // onclose handles reconnecting
  }

  open();
  return {
    stop() {
      running = false;
      clearInterval(heartbeat);
      clearTimeout(reconnectTimer);
      try { ws?.close(1000); } catch { /* already closed */ }
    },
  };
}
