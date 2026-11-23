import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chat, startTestApp } from "./helpers.js";

let t;
before(async () => {
  t = await startTestApp({ ollamaOptions: { models: ["llama3.2:latest", "qwen2.5:7b"] } });
});
after(() => t.close());

test("serves the frontend", async () => {
  const res = await fetch(t.base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Personal AI/);
});

test("status lists both providers, installed Ollama models and tools", async () => {
  const data = await (await fetch(t.base + "/api/status")).json();
  assert.equal(data.defaultProvider, "ollama");
  const o = data.providers.find((p) => p.id === "ollama");
  assert.equal(o.available, true);
  assert.deepEqual(o.models, ["llama3.2:latest", "qwen2.5:7b"]);
  assert.ok(data.providers.find((p) => p.id === "claude"));
  assert.ok(data.tools.includes("create_reminder") && data.tools.includes("volume"));
});

test("profile round-trips and is used in the system prompt", async () => {
  const saved = await (
    await fetch(t.base + "/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: "Sam", aboutMe: "Vegetarian", assistantName: "" }),
    })
  ).json();
  assert.equal(saved.userName, "Sam");
  assert.equal(saved.assistantName, "Nova"); // blank -> default

  await chat(t.base, { messages: [{ role: "user", content: "dinner ideas?" }] });
  const sent = t.ollama.requests.filter((r) => r.url === "/api/chat").at(-1).body;
  assert.equal(sent.messages[0].role, "system");
  assert.match(sent.messages[0].content, /Vegetarian/);
  assert.match(sent.messages.at(-1).content, /^\[Current local time: \w+day \d{4}-\d\d-\d\dT/);
  assert.ok(sent.tools.some((x) => x.function.name === "create_reminder"));
});

test("chat streams a reply from Ollama", async () => {
  const r = await chat(t.base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "Hello there!");
  assert.equal(r.events.at(-1).type, "done");
});

test("chat uses the model picked in the UI", async () => {
  await chat(t.base, { model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] });
  assert.equal(t.ollama.requests.at(-1).body.model, "qwen2.5:7b");
});

test("missing Ollama model gives a helpful error", async () => {
  const r = await chat(t.base, { model: "nope", messages: [{ role: "user", content: "hi" }] });
  assert.match(r.events.at(-1).error, /ollama pull nope/);
});

test("chat can use Claude instead", async () => {
  const r = await chat(t.base, { provider: "claude", messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "Hi from Claude");
  const { params } = t.claudeClient.calls.at(-1);
  assert.equal(params.model, "claude-opus-5-5");
  assert.match(params.system, /Nova/);
  assert.match(params.messages[0].content, /hi$/);
  assert.ok(params.tools.some((x) => x.type === "web_search_20260209"));
});

test("rejects invalid requests", async () => {
  assert.equal((await chat(t.base, { messages: [] })).status, 400);
  assert.equal((await chat(t.base, { provider: "x", messages: [{ role: "user", content: "hi" }] })).status, 400);
});

test("stats endpoint reports CPU and memory", async () => {
  const s = await (await fetch(t.base + "/api/stats")).json();
  assert.ok(s.cpu >= 0 && s.cpu <= 100);
  assert.ok(s.memTotalGb > 0 && s.memPct >= 0 && s.memPct <= 100);
  assert.ok(s.uptimeSec > 0);
});
