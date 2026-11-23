// End-to-end tests of the AI taking actions, using fake models and a fake PC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chat, startTestApp } from "./helpers.js";

const user = (content) => ({ messages: [{ role: "user", content }] });
const call = (name, args) => ({ function: { name, arguments: args } });
const post = (base, path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

test("Ollama: AI sets the volume, gets the result, then answers", async () => {
  const t = await startTestApp({
    ollamaOptions: { turns: [{ tool_calls: [call("volume", { action: "set", level: 30 })] }, { content: "Volume set to 30%." }] },
  });
  try {
    const r = await chat(t.base, user("volume to 30"));
    const tool = r.events.find((e) => e.type === "tool");
    assert.equal(tool.display.text, "Volume: 30%");
    assert.equal(r.text, "Volume set to 30%.");
    assert.deepEqual(t.system.log, [["volume", "set", 30]]);
    // Second request carries the tool call and its result back to the model.
    const second = t.ollama.requests.filter((x) => x.url === "/api/chat")[1].body.messages;
    assert.equal(second.at(-2).tool_calls[0].function.name, "volume");
    assert.deepEqual(second.at(-1), { role: "tool", tool_name: "volume", content: JSON.stringify({ volume: 30, muted: false }) });
  } finally { await t.close(); }
});

test("Ollama: invalid tool input is rejected and reported back, nothing runs", async () => {
  const t = await startTestApp({
    ollamaOptions: { turns: [{ tool_calls: [call("volume", { action: "set", level: 500 })] }, { content: "Sorry." }] },
  });
  try {
    const r = await chat(t.base, user("volume 500"));
    const tool = r.events.find((e) => e.type === "tool");
    assert.equal(tool.isError, true);
    assert.match(tool.display.text, /<= 100/);
    assert.deepEqual(t.system.log, []);
  } finally { await t.close(); }
});

test("Ollama: model without tool support still chats", async () => {
  const t = await startTestApp({ ollamaOptions: { models: ["gemma:2b"], noToolModels: ["gemma:2b"], reply: ["Hi!"] } });
  try {
    const r = await chat(t.base, { model: "gemma:2b", ...user("hello") });
    assert.match(r.text, /can't use actions[\s\S]*Hi!$/);
    assert.equal(t.ollama.requests.at(-1).body.tools, undefined);
  } finally { await t.close(); }
});

test("Claude: creates a reminder with the proper tool_result round trip", async () => {
  const t = await startTestApp({
    claudeOptions: {
      turns: [
        { text: ["Sure."], toolUses: [{ id: "toolu_1", name: "create_reminder", input: { text: "Call mom", due_at: "2030-05-01T18:00:00" } }], stop_reason: "tool_use" },
        { text: ["Reminder set for 6 pm."] },
      ],
    },
  });
  try {
    const r = await chat(t.base, { provider: "claude", ...user("remind me to call mom") });
    assert.equal(r.text, "Sure.Reminder set for 6 pm.");
    assert.equal(r.events.find((e) => e.type === "tool").display.kind, "reminder");
    assert.equal((await t.reminders.list())[0].text, "Call mom");
    const msgs = t.claudeClient.calls[1].params.messages;
    assert.equal(msgs.at(-2).role, "assistant");
    assert.equal(msgs.at(-2).content[1].type, "tool_use");
    assert.equal(msgs.at(-1).content[0].type, "tool_result");
    assert.equal(msgs.at(-1).content[0].tool_use_id, "toolu_1");
  } finally { await t.close(); }
});

test("shutdown needs the user to click Confirm", async () => {
  const t = await startTestApp({
    ollamaOptions: { turns: [{ tool_calls: [call("power", { action: "shutdown" })] }, { content: "Click Confirm to shut down." }] },
  });
  try {
    const r = await chat(t.base, user("shut down my pc"));
    const card = r.events.find((e) => e.type === "tool").display;
    assert.equal(card.kind, "confirm");
    assert.deepEqual(t.system.log, [], "must not shut down before confirmation");
    const res = await post(t.base, `/api/actions/${card.id}/confirm`);
    assert.equal(res.status, 200);
    assert.deepEqual(t.system.log, [["power", "shutdown"]]);
    assert.equal((await post(t.base, `/api/actions/${card.id}/confirm`)).status, 400, "one-time only");
  } finally { await t.close(); }
});

test("lock happens immediately; apps limited to the allow-list; only http(s) links", async () => {
  const t = await startTestApp({
    ollamaOptions: {
      turns: [
        { tool_calls: [
          call("power", { action: "lock" }),
          call("open_app", { name: "notepad" }),
          call("open_app", { name: "cmd.exe /c del *" }),
          call("open_website", { url: "javascript:alert(1)" }),
          call("open_website", { search_query: "weather today" }),
          call("brightness", { action: "set", level: "60" }),
        ] },
        { content: "Done." },
      ],
    },
  });
  try {
    const r = await chat(t.base, user("do things"));
    const tools = r.events.filter((e) => e.type === "tool");
    assert.deepEqual(tools.map((x) => x.isError), [false, false, true, true, false, false]);
    assert.deepEqual(t.system.log, [
      ["power", "lock"],
      ["launch", "notepad.exe"],
      ["launch", "https://www.google.com/search?q=weather%20today"],
      ["brightness", "set", 60],
    ]);
  } finally { await t.close(); }
});

test("email drafts are shown, never sent", async () => {
  const t = await startTestApp({
    ollamaOptions: { turns: [{ tool_calls: [call("draft_email", { to: "boss@example.com", subject: "Leave", body: "Hi,\nI'd like Friday off." })] }, { content: "Here's your draft." }] },
  });
  try {
    const r = await chat(t.base, user("email my boss for friday off"));
    const d = r.events.find((e) => e.type === "tool").display;
    assert.deepEqual(d, { kind: "email", to: "boss@example.com", subject: "Leave", body: "Hi,\nI'd like Friday off." });
    assert.deepEqual(t.system.log, []);
  } finally { await t.close(); }
});

test("PC tools are hidden when not on Windows", async () => {
  const t = await startTestApp({ system: { supported: false, os: "linux", notify: async () => {} } });
  try {
    const { tools } = await (await fetch(t.base + "/api/status")).json();
    assert.deepEqual(tools, ["create_reminder", "list_reminders", "cancel_reminder", "draft_email"]);
  } finally { await t.close(); }
});

test("reminders API: add, list, delete, and live event on /api/events", async () => {
  const t = await startTestApp();
  try {
    assert.equal((await post(t.base, "/api/reminders", { text: "x", dueAt: "1999-01-01T00:00:00Z" })).status, 400);
    const r = await (await post(t.base, "/api/reminders", { text: "Drink water", dueAt: "2031-01-01T09:00:00Z" })).json();
    assert.equal((await (await fetch(t.base + "/api/reminders")).json()).length, 1);

    const ctrl = new AbortController();
    const res = await fetch(t.base + "/api/events", { signal: ctrl.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    t.events.publish({ type: "reminder", reminder: r });
    let got = "";
    while (!got.includes("Drink water")) got += (await reader.read()).value;
    ctrl.abort();

    assert.equal((await fetch(`${t.base}/api/reminders/${r.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await (await fetch(t.base + "/api/reminders")).json()).length, 0);
  } finally { await t.close(); }
});

test("polish cleans dictated text without tools", async () => {
  const t = await startTestApp({ ollamaOptions: { reply: ["Can you call me tomorrow?"] } });
  try {
    const out = await (await post(t.base, "/api/polish", { text: "um so like can you uh call me tomorrow" })).json();
    assert.equal(out.text, "Can you call me tomorrow?");
    const req = t.ollama.requests.at(-1).body;
    assert.equal(req.tools, undefined);
    assert.match(req.messages[0].content, /filler words/);
  } finally { await t.close(); }
});
