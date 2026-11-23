import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startTelegramBot } from "../src/bots/telegram.js";
import { startDiscordBot } from "../src/bots/discord.js";
import { chunkText } from "../src/bots/brain.js";
import { createPendingActions } from "../src/pendingActions.js";

const quiet = { log() {}, warn() {}, error() {} };
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); }
};

/** Fake engine: replies "You said: X"; "shutdown" produces a confirm card. */
function fakeEngine(pendingActions, ran) {
  const seen = [];
  return {
    seen,
    async *chat({ messages, channelNote }) {
      seen.push({ messages: structuredClone(messages), channelNote });
      const last = messages.at(-1).content;
      if (last === "shutdown") {
        const id = pendingActions.create("Shut down the PC", async () => ran.push("shutdown"));
        yield { type: "tool", name: "power", isError: false, display: { kind: "confirm", id, text: "Shut down the PC" }, note: "[used power]" };
        yield { type: "text", text: "Tap Confirm to shut down." };
        return;
      }
      yield { type: "text", text: `You said: ${last}` };
    },
  };
}

async function fakeTelegram() {
  const calls = [];
  const queue = [];
  let id = 1;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const method = req.url.split("/").pop();
    const data = JSON.parse(body || "{}");
    calls.push({ method, data, token: req.url.split("/")[1] });
    const ok = (result) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, result })); };
    if (method === "getUpdates") {
      const pending = queue.filter((u) => u.update_id >= (data.offset ?? 0));
      if (pending.length) return ok(pending);
      return setTimeout(() => ok([]), 30);
    }
    ok({ message_id: 99 });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    calls,
    base: `http://127.0.0.1:${server.address().port}`,
    push: (u) => queue.push({ update_id: id++, ...u }),
    sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.data),
    close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
  };
}

test("Telegram: strangers are refused (and told their ID), owner gets answers", async () => {
  const tg = await fakeTelegram();
  const pa = createPendingActions();
  const engine = fakeEngine(pa, []);
  const bot = startTelegramBot({ token: "123:ABC", allowedUsers: ["42"], engine, pendingActions: pa, baseUrl: tg.base, log: quiet });
  try {
    tg.push({ message: { chat: { id: 7 }, from: { id: 666 }, text: "turn off the pc" } });
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "hello" } });
    await until(() => tg.sent().length >= 2);
    const [stranger, owner] = [tg.sent().find((m) => m.chat_id === 7), tg.sent().find((m) => m.chat_id === 1)];
    assert.match(stranger.text, /Your Telegram user ID is 666/);
    assert.equal(owner.text, "You said: hello");
    assert.equal(engine.seen.length, 1, "stranger's message never reached the AI");
    assert.match(engine.seen[0].channelNote, /Telegram/);
    assert.equal(tg.calls[0].token, "bot123:ABC");
  } finally { await bot.stop(); await tg.close(); }
});

test("Telegram: shutdown shows buttons; only allowed users can confirm", async () => {
  const tg = await fakeTelegram();
  const pa = createPendingActions();
  const ran = [];
  const bot = startTelegramBot({ token: "t", allowedUsers: ["42"], engine: fakeEngine(pa, ran), pendingActions: pa, baseUrl: tg.base, log: quiet });
  try {
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "shutdown" } });
    await until(() => tg.sent().some((m) => m.reply_markup));
    const card = tg.sent().find((m) => m.reply_markup);
    const confirmData = card.reply_markup.inline_keyboard[0][0].callback_data;
    assert.match(confirmData, /^confirm:/);
    assert.ok(confirmData.length <= 64, "Telegram limit");

    tg.push({ callback_query: { id: "q1", from: { id: 666 }, data: confirmData } });
    await until(() => tg.calls.some((c) => c.method === "answerCallbackQuery"));
    assert.deepEqual(ran, [], "stranger can't confirm");

    tg.push({ callback_query: { id: "q2", from: { id: 42 }, data: confirmData, message: { chat: { id: 1 }, message_id: 5, text: card.text } } });
    await until(() => ran.length === 1);
    await until(() => tg.calls.some((c) => c.method === "editMessageText"));
    assert.match(tg.calls.find((c) => c.method === "editMessageText").data.text, /✓ Done: Shut down the PC/);
  } finally { await bot.stop(); await tg.close(); }
});

test("Telegram: /new clears history; history is kept per chat", async () => {
  const tg = await fakeTelegram();
  const pa = createPendingActions();
  const engine = fakeEngine(pa, []);
  const bot = startTelegramBot({ token: "t", allowedUsers: ["42"], engine, pendingActions: pa, baseUrl: tg.base, log: quiet });
  try {
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "one" } });
    await until(() => engine.seen.length === 1);
    await until(() => tg.sent().length === 1);
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "two" } });
    await until(() => engine.seen.length === 2);
    assert.equal(engine.seen[1].messages.length, 3); // one, reply, two
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "/new" } });
    await until(() => tg.sent().some((m) => /fresh start/.test(m.text)));
    tg.push({ message: { chat: { id: 1 }, from: { id: 42 }, text: "three" } });
    await until(() => engine.seen.length === 3);
    assert.equal(engine.seen[2].messages.length, 1);
  } finally { await bot.stop(); await tg.close(); }
});

function fakeDiscord() {
  const sockets = [];
  const rest = [];
  const connect = () => {
    const s = { sent: [], send(d) { this.sent.push(JSON.parse(d)); }, close() { this.closed = true; } };
    sockets.push(s);
    return s;
  };
  const fetchImpl = async (url, opts) => {
    rest.push({ url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization });
    return new Response(JSON.stringify({ id: "m1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const emit = (payload) => sockets.at(-1).onmessage({ data: JSON.stringify(payload) });
  return { sockets, rest, connect, fetchImpl, emit, posts: () => rest.filter((r) => r.url.endsWith("/messages")) };
}

test("Discord: identifies with safe intents, answers DMs and mentions from allowed users only", async () => {
  const d = fakeDiscord();
  const pa = createPendingActions();
  const engine = fakeEngine(pa, []);
  const bot = startDiscordBot({ token: "tok", allowedUsers: ["42"], engine, pendingActions: pa, connect: d.connect, fetchImpl: d.fetchImpl, apiBase: "https://discord.test", log: quiet });
  try {
    d.emit({ op: 10, d: { heartbeat_interval: 60000 } });
    const identify = d.sockets[0].sent.find((p) => p.op === 2);
    assert.equal(identify.d.token, "tok");
    assert.equal(identify.d.intents, 4608); // GUILD_MESSAGES | DIRECT_MESSAGES, no privileged intents
    d.emit({ op: 0, s: 1, t: "READY", d: { user: { id: "BOT", username: "nova" } } });

    d.emit({ op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "a", channel_id: "dm1", author: { id: "42" }, content: "hi there" } });
    d.emit({ op: 0, s: 3, t: "MESSAGE_CREATE", d: { id: "b", channel_id: "g1", guild_id: "G", author: { id: "42" }, content: "not for the bot", mentions: [] } });
    d.emit({ op: 0, s: 4, t: "MESSAGE_CREATE", d: { id: "c", channel_id: "g1", guild_id: "G", author: { id: "42" }, content: "<@BOT> what time is it", mentions: [{ id: "BOT" }] } });
    d.emit({ op: 0, s: 5, t: "MESSAGE_CREATE", d: { id: "e", channel_id: "dm2", author: { id: "666" }, content: "shutdown" } });
    await until(() => d.posts().length === 3);
    const byChannel = Object.fromEntries(d.posts().map((p) => [p.url.split("/")[4], p.body]));
    assert.equal(byChannel.dm1.content, "You said: hi there");
    assert.equal(byChannel.g1.content, "You said: what time is it");
    assert.match(byChannel.dm2.content, /Your Discord user ID is 666/);
    assert.deepEqual(byChannel.dm1.allowed_mentions, { parse: [] });
    assert.equal(engine.seen.length, 2);
    assert.equal(d.rest[0].auth, "Bot tok");
  } finally { bot.stop(); }
});

test("Discord: Confirm button runs the action for the owner only", async () => {
  const d = fakeDiscord();
  const pa = createPendingActions();
  const ran = [];
  const bot = startDiscordBot({ token: "tok", allowedUsers: ["42"], engine: fakeEngine(pa, ran), pendingActions: pa, connect: d.connect, fetchImpl: d.fetchImpl, apiBase: "https://discord.test", log: quiet });
  try {
    d.emit({ op: 10, d: { heartbeat_interval: 60000 } });
    d.emit({ op: 0, s: 1, t: "READY", d: { user: { id: "BOT", username: "nova" } } });
    d.emit({ op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "a", channel_id: "dm1", author: { id: "42" }, content: "shutdown" } });
    await until(() => d.posts().some((p) => p.body.components));
    const customId = d.posts().find((p) => p.body.components).body.components[0].components[0].custom_id;

    d.emit({ op: 0, s: 3, t: "INTERACTION_CREATE", d: { type: 3, id: "i1", token: "it", user: { id: "666" }, data: { custom_id: customId }, message: { content: "x" } } });
    await until(() => d.rest.some((r) => r.url.includes("/interactions/i1/")));
    assert.deepEqual(ran, []);
    d.emit({ op: 0, s: 4, t: "INTERACTION_CREATE", d: { type: 3, id: "i2", token: "it", user: { id: "42" }, data: { custom_id: customId }, message: { content: "⚠️ Shut down the PC?" } } });
    await until(() => ran.length === 1);
    await until(() => d.rest.some((r) => r.url.includes("/interactions/i2/")));
    const cb = d.rest.find((r) => r.url.includes("/interactions/i2/")).body;
    assert.equal(cb.type, 7);
    assert.match(cb.data.content, /✓ Done/);
    assert.deepEqual(cb.data.components, []);
  } finally { bot.stop(); }
});

test("chunkText splits long replies on line or word breaks", () => {
  const parts = chunkText("word ".repeat(1000).trim(), 1900);
  assert.ok(parts.every((p) => p.length <= 1900));
  assert.equal(parts.join(" "), "word ".repeat(1000).trim());
});
