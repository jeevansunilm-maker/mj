// Builds the Express app. Kept separate from server.js so tests can create
// an app with fake providers and no real network calls.
import express from "express";
import { buildSystemPrompt, cleanMessages } from "./prompt.js";
import { ProviderError, isAbortError } from "./providers/errors.js";

export function createApp({ config, providers, profileStore }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(config.frontendDir));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Which AI providers can be used right now?
  app.get("/api/status", async (_req, res) => {
    const list = await Promise.all(
      [...providers.values()].map(async (p) => ({ id: p.id, label: p.label, ...(await p.status()) })),
    );
    res.json({ defaultProvider: config.defaultProvider, providers: list });
  });

  app.get("/api/profile", async (_req, res) => res.json(await profileStore.get()));

  app.put("/api/profile", async (req, res) => res.json(await profileStore.save(req.body ?? {})));

  // POST /api/chat   { provider?, model?, messages: [{role, content}, ...] }
  // Streams the reply as Server-Sent Events:
  //   data: {"type":"text","text":"..."}   (many)
  //   data: {"type":"done"} | {"type":"error","error":"..."}
  app.post("/api/chat", async (req, res) => {
    const messages = cleanMessages(req.body?.messages);
    if (!messages) {
      return res.status(400).json({ error: "messages must be a non-empty list ending with a user message" });
    }
    const providerId = req.body?.provider ?? config.defaultProvider;
    const provider = providers.get(providerId);
    if (!provider) return res.status(400).json({ error: `Unknown provider "${providerId}"` });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // If the browser disconnects (tab closed / Stop pressed), stop generating.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const system = buildSystemPrompt(await profileStore.get());
      for await (const text of provider.stream({
        system,
        messages,
        model: typeof req.body?.model === "string" ? req.body.model : undefined,
        signal: controller.signal,
      })) {
        send({ type: "text", text });
      }
      send({ type: "done" });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return res.end();
      if (!(err instanceof ProviderError)) console.error(err);
      send({
        type: "error",
        error: err instanceof ProviderError ? err.message : "Something went wrong on the server.",
      });
    }
    res.end();
  });

  return app;
}
