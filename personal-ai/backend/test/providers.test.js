import { test } from "node:test";
import assert from "node:assert/strict";
import { createOllamaProvider } from "../src/providers/ollama.js";
import { createClaudeProvider } from "../src/providers/claude.js";
import { fakeClaudeClient } from "./helpers.js";

const collect = async (gen) => {
  let s = "";
  for await (const e of gen) if (e.type === "text") s += e.text;
  return s;
};
const args = { system: "sys", messages: [{ role: "user", content: "hi" }] };

test("Ollama not running -> clear message", async () => {
  const p = createOllamaProvider({ baseUrl: "http://127.0.0.1:1", model: "llama3.2" });
  assert.equal((await p.status()).available, false);
  await assert.rejects(collect(p.run(args)), /Ollama isn't running/);
});

test("Claude without API key is reported as off", async () => {
  const p = createClaudeProvider({ apiKey: "", model: "claude-opus-5-5", effort: "medium" });
  assert.equal((await p.status()).available, false);
  await assert.rejects(collect(p.run(args)), /ANTHROPIC_API_KEY/);
});

test("Claude refusal becomes a friendly error and runs no tools", async () => {
  let ran = false;
  const client = fakeClaudeClient({ turns: [{ toolUses: [{ id: "t", name: "x", input: {} }], stop_reason: "refusal" }] });
  const p = createClaudeProvider({ model: "m", effort: "low", client });
  await assert.rejects(collect(p.run({ ...args, executeTool: async () => { ran = true; } })), /declined/);
  assert.equal(ran, false);
});

test("Claude max_tokens with a tool call: cut-off note, tool NOT run", async () => {
  let ran = false;
  const client = fakeClaudeClient({ turns: [{ text: ["abc"], toolUses: [{ id: "t", name: "x", input: {} }], stop_reason: "max_tokens" }] });
  const p = createClaudeProvider({ model: "m", effort: "low", client });
  assert.match(await collect(p.run({ ...args, executeTool: async () => { ran = true; } })), /^abc\n\n\[Reply cut off/);
  assert.equal(ran, false);
});

test("Claude without tools sends no tools array", async () => {
  const client = fakeClaudeClient();
  const p = createClaudeProvider({ model: "m", effort: "low", client });
  await collect(p.run(args));
  assert.equal(client.calls[0].params.tools, undefined);
});
