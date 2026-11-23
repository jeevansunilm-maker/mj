import { test } from "node:test";
import assert from "node:assert/strict";
import { createOllamaProvider } from "../src/providers/ollama.js";
import { createClaudeProvider } from "../src/providers/claude.js";
import { fakeClaudeClient } from "./helpers.js";

const collect = async (gen) => { let s = ""; for await (const t of gen) s += t; return s; };
const args = { system: "sys", messages: [{ role: "user", content: "hi" }] };

test("Ollama not running -> clear message", async () => {
  const p = createOllamaProvider({ baseUrl: "http://127.0.0.1:1", model: "llama3.2" });
  assert.equal((await p.status()).available, false);
  await assert.rejects(collect(p.stream(args)), /Ollama isn't running/);
});

test("Claude without API key is reported as off", async () => {
  const p = createClaudeProvider({ apiKey: "", model: "claude-opus-5-5", effort: "medium" });
  assert.equal((await p.status()).available, false);
  await assert.rejects(collect(p.stream(args)), /ANTHROPIC_API_KEY/);
});

test("Claude refusal becomes a friendly error", async () => {
  const p = createClaudeProvider({ model: "m", effort: "low", client: fakeClaudeClient({ text: [], stopReason: "refusal" }) });
  await assert.rejects(collect(p.stream(args)), /declined/);
});

test("Claude max_tokens appends a cut-off note", async () => {
  const p = createClaudeProvider({ model: "m", effort: "low", client: fakeClaudeClient({ text: ["abc"], stopReason: "max_tokens" }) });
  assert.match(await collect(p.stream(args)), /^abc\n\n\[Reply cut off/);
});
