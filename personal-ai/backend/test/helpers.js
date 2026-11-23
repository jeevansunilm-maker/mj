// Test helpers: a fake Ollama server and a fake Claude client, so tests run
// offline, for free, with no models installed.
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function startFakeOllama({ models = ["llama3.2:latest"], reply = ["Hello", " there", "!"] } = {}) {
  const requests = [];
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
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
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

export function fakeClaudeClient({ text = ["Hi", " from Claude"], stopReason = "end_turn" } = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params, options) {
          calls.push({ params, options });
          return {
            async *[Symbol.asyncIterator]() {
              for (const t of text) yield { type: "content_block_delta", delta: { type: "text_delta", text: t } };
            },
            finalMessage: async () => ({ stop_reason: stopReason }),
          };
        },
      },
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
