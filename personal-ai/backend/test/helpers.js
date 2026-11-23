// Test helpers: a fake Ollama server and a fake Claude client, so tests run
// offline, for free, with no models installed.
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * turns: optional scripted replies, one per /api/chat call, e.g.
 *   [{ content: "", tool_calls: [{ function: { name: "volume", arguments: { action: "get" } } }] },
 *    { content: "Volume is 40%" }]
 * noToolModels: models that answer 400 "does not support tools" when sent tools.
 */
export async function startFakeOllama({ models = ["llama3.2:latest"], reply = ["Hello", " there", "!"], turns = null, noToolModels = [] } = {}) {
  const requests = [];
  let turn = 0;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
    }
    if (req.url === "/api/chat") {
      const wanted = JSON.parse(body).model;
      if (!models.some((m) => m === wanted || m === `${wanted}:latest`)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: `model '${wanted}' not found` }));
      }
      const parsed = JSON.parse(body);
      if (parsed.tools && noToolModels.includes(wanted)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: `registry.ollama.ai/library/${wanted} does not support tools` }));
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (turns) {
        const t = turns[Math.min(turn++, turns.length - 1)];
        if (t.content) res.write(JSON.stringify({ message: { role: "assistant", content: t.content }, done: false }) + "\n");
        if (t.tool_calls) res.write(JSON.stringify({ message: { role: "assistant", content: "", tool_calls: t.tool_calls }, done: false }) + "\n");
        return res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
      }
      for (const part of reply) res.write(JSON.stringify({ message: { role: "assistant", content: part }, done: false }) + "\n");
      return res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * turns: scripted responses, one per request, e.g.
 *   [{ toolUses: [{ id: "t1", name: "volume", input: { action: "get" } }], stop_reason: "tool_use" },
 *    { text: ["Done"] }]
 */
export function fakeClaudeClient({ text = ["Hi", " from Claude"], stopReason = "end_turn", turns = null } = {}) {
  const calls = [];
  const script = turns ?? [{ text, stop_reason: stopReason }];
  return {
    calls,
    beta: {
      messages: {
        stream(params, options) {
          // Snapshot: the provider keeps appending to the same messages array.
          calls.push({ params: structuredClone({ ...params }), options });
          const t = script[Math.min(calls.length - 1, script.length - 1)];
          const content = [
            ...(t.text ?? []).map((x) => ({ type: "text", text: x })),
            ...(t.toolUses ?? []).map((u) => ({ type: "tool_use", ...u })),
          ];
          return {
            async *[Symbol.asyncIterator]() {
              for (const x of t.text ?? []) yield { type: "content_block_delta", delta: { type: "text_delta", text: x } };
            },
            finalMessage: async () => ({ stop_reason: t.stop_reason ?? "end_turn", content }),
          };
        },
      },
    },
  };
}

/** A pretend Windows PC that records what would have happened. */
export function fakeSystem() {
  const log = [];
  const state = { volume: 40, muted: false, brightness: 70 };
  return {
    log,
    state,
    supported: true,
    os: "windows",
    async volume(action, level) {
      log.push(["volume", action, level]);
      if (action === "set") state.volume = level;
      if (action === "mute") state.muted = true;
      if (action === "unmute") state.muted = false;
      return { volume: state.volume, muted: state.muted };
    },
    async brightness(action, level) {
      log.push(["brightness", action, level]);
      if (action === "set") state.brightness = level;
      return { brightness: state.brightness };
    },
    async power(action) { log.push(["power", action]); },
    async launch(target) { log.push(["launch", target]); },
    async notify(title, body) { log.push(["notify", title, body]); },
  };
}

/** Builds a full app with fakes and starts it on a random port. */
export async function startTestApp({ ollamaOptions = {}, claudeOptions = {}, system = fakeSystem(), now } = {}) {
  const { createApp } = await import("../src/app.js");
  const { loadConfig } = await import("../src/config.js");
  const { createProfileStore } = await import("../src/profileStore.js");
  const { createProviders } = await import("../src/providers/index.js");
  const { createClaudeProvider } = await import("../src/providers/claude.js");
  const { createEventHub } = await import("../src/events.js");
  const { createReminderStore } = await import("../src/reminders.js");
  const { createPendingActions } = await import("../src/pendingActions.js");
  const { createTools } = await import("../src/tools/index.js");
  const { DEFAULT_WINDOWS_APPS } = await import("../src/system/windows.js");

  const ollama = await startFakeOllama(ollamaOptions);
  const claudeClient = fakeClaudeClient(claudeOptions);
  const config = loadConfig({ OLLAMA_URL: ollama.url, DATA_DIR: await tempDir() });
  const providers = createProviders(config, { claude: createClaudeProvider({ ...config.claude, client: claudeClient }) });
  const events = createEventHub();
  const reminders = createReminderStore(config.dataDir);
  const pendingActions = createPendingActions();
  const tools = createTools({ reminders, system, apps: DEFAULT_WINDOWS_APPS, pendingActions });
  const app = createApp({
    config, providers, profileStore: createProfileStore(config.dataDir), tools, reminders, events, pendingActions,
    ...(now ? { now } : {}),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    ollama, claudeClient, system, reminders, events, config,
    async close() {
      server.closeAllConnections?.();
      server.close();
      await ollama.close();
    },
  };
}

export async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "personal-ai-test-"));
}

/** POST /api/chat and collect the SSE events into an array. */
export async function chat(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { status: res.status, json: await res.json() };
  const raw = await res.text();
  const events = raw.split("\n\n").filter(Boolean).map((e) => JSON.parse(e.replace(/^data: /, "")));
  return { status: res.status, events, text: events.filter((e) => e.type === "text").map((e) => e.text).join("") };
}
