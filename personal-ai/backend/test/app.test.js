import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createProfileStore } from "../src/profileStore.js";
import { createProviders } from "../src/providers/index.js";
import { createClaudeProvider } from "../src/providers/claude.js";
import { chat, fakeClaudeClient, startFakeOllama, tempDir } from "./helpers.js";

let ollama, server, base, claudeClient;

before(async () => {
  ollama = await startFakeOllama({ models: ["llama3.2:latest", "qwen2.5:7b"] });
  claudeClient = fakeClaudeClient();
  const config = loadConfig({ OLLAMA_URL: ollama.url, DATA_DIR: await tempDir() });
  const providers = createProviders(config, {
    claude: createClaudeProvider({ ...config.claude, client: claudeClient }),
  });
  const app = createApp({ config, providers, profileStore: createProfileStore(config.dataDir) });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await ollama.close();
});

test("serves the frontend", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Personal AI/);
});

test("status lists both providers and installed Ollama models", async () => {
  const data = await (await fetch(base + "/api/status")).json();
  assert.equal(data.defaultProvider, "ollama");
  const o = data.providers.find((p) => p.id === "ollama");
  assert.equal(o.available, true);
  assert.deepEqual(o.models, ["llama3.2:latest", "qwen2.5:7b"]);
  assert.ok(data.providers.find((p) => p.id === "claude"));
});

test("profile round-trips and is used in the system prompt", async () => {
  const saved = await (
    await fetch(base + "/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: "Sam", aboutMe: "Vegetarian", assistantName: "" }),
    })
  ).json();
  assert.equal(saved.userName, "Sam");
  assert.equal(saved.assistantName, "Nova"); // blank -> default

  await chat(base, { messages: [{ role: "user", content: "dinner ideas?" }] });
  const sent = ollama.requests.filter((r) => r.url === "/api/chat").at(-1).body;
  assert.equal(sent.messages[0].role, "system");
  assert.match(sent.messages[0].content, /Vegetarian/);
});

test("chat streams a reply from Ollama", async () => {
  const r = await chat(base, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "Hello there!");
  assert.equal(r.events.at(-1).type, "done");
});

test("chat uses the model picked in the UI", async () => {
  await chat(base, { model: "qwen2.5:7b", messages: [{ role: "user", content: "hi" }] });
  assert.equal(ollama.requests.at(-1).body.model, "qwen2.5:7b");
});

test("missing Ollama model gives a helpful error", async () => {
  const r = await chat(base, { model: "nope", messages: [{ role: "user", content: "hi" }] });
  assert.match(r.events.at(-1).error, /ollama pull nope/);
});

test("chat can use Claude instead", async () => {
  const r = await chat(base, { provider: "claude", messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.text, "Hi from Claude");
  const { params } = claudeClient.calls.at(-1);
  assert.equal(params.model, "claude-opus-5-5");
  assert.match(params.system, /Nova/);
  assert.deepEqual(params.messages, [{ role: "user", content: "hi" }]);
});

test("rejects invalid requests", async () => {
  assert.equal((await chat(base, { messages: [] })).status, 400);
  assert.equal((await chat(base, { provider: "x", messages: [{ role: "user", content: "hi" }] })).status, 400);
});
