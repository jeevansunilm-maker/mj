// Builds the Express app. Kept separate from server.js so tests can create
// an app with fake providers, a fake PC, and no real network calls.
import express from "express";
import { createChatEngine } from "./chatEngine.js";
import { cleanMessages } from "./prompt.js";
import { ProviderError, isAbortError } from "./providers/errors.js";
import { parseDueAt } from "./reminders.js";
import { securityMiddleware } from "./security.js";
import { createStats } from "./stats.js";

const POLISH_PROMPT =
  "You clean up dictated speech. Remove filler words (um, uh, like, you know), false starts and " +
  "repeated words. Fix punctuation, capitalisation and obvious transcription mistakes. Keep the " +
  "speaker's meaning, words and tone; do not add anything. Reply with only the cleaned text.";

export function createApp({
  config, providers, profileStore, tools = [], reminders, events, pendingActions,
  integrations = { googleSheets: { connected: false } }, now = () => new Date(),
  engine = createChatEngine({ config, providers, profileStore, tools, now }), voiceStudio = null,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityMiddleware({ extraHosts: config.allowedHosts }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(config.frontendDir));

  function pickProvider(req, res) {
    const id = req.body?.provider ?? config.defaultProvider;
    const provider = providers.get(id);
    if (!provider) res.status(400).json({ error: `Unknown provider "${id}"` });
    return provider;
  }
  const modelOf = (req) => (typeof req.body?.model === "string" ? req.body.model : undefined);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const readStats = createStats();
  app.get("/api/stats", (_req, res) => res.json(readStats()));

  // Which AI providers can be used right now, and which actions exist?
  app.get("/api/status", async (_req, res) => {
    const list = await Promise.all(
      [...providers.values()].map(async (p) => ({ id: p.id, label: p.label, ...(await p.status()) })),
    );
    res.json({ defaultProvider: config.defaultProvider, providers: list, tools: tools.map((t) => t.name), integrations });
  });

  app.get("/api/profile", async (_req, res) => res.json(await profileStore.get()));
  app.put("/api/profile", async (req, res) => res.json(await profileStore.save(req.body ?? {})));

  // ── Chat ─────────────────────────────────────────────────
  // POST /api/chat   { provider?, model?, messages: [{role, content}, ...] }
  // Streams Server-Sent Events:
  //   {"type":"text","text":"..."}                 words of the reply
  //   {"type":"tool","name","display","note",...}  an action the AI took
  //   {"type":"done"} | {"type":"error","error":"..."}
  app.post("/api/chat", async (req, res) => {
    const messages = cleanMessages(req.body?.messages);
    if (!messages) {
      return res.status(400).json({ error: "messages must be a non-empty list ending with a user message" });
    }
    const provider = pickProvider(req, res);
    if (!provider) return;

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // If the browser disconnects (tab closed / Stop pressed), stop generating.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      for await (const event of engine.chat({ providerId: provider.id, model: modelOf(req), messages, signal: controller.signal })) {
        send(event);
      }
      send({ type: "done" });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return res.end();
      if (!(err instanceof ProviderError)) console.error(err);
      send({ type: "error", error: err instanceof ProviderError ? err.message : "Something went wrong on the server." });
    }
    res.end();
  });

  // ── Voice: clean up dictated text (like Wispr Flow) ──────
  app.post("/api/polish", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 20000) : "";
    if (!text) return res.status(400).json({ error: "text is required" });
    const provider = pickProvider(req, res);
    if (!provider) return;
    try {
      let out = "";
      for await (const e of provider.run({ system: POLISH_PROMPT, messages: [{ role: "user", content: text }], model: modelOf(req) })) {
        if (e.type === "text") out += e.text;
      }
      res.json({ text: out.trim() || text });
    } catch (err) {
      res.status(502).json({ error: err instanceof ProviderError ? err.message : "Couldn't polish the text." });
    }
  });

  // ── Voice: VoiceStudio (natural voices from the app on this PC) ──
  app.get("/api/voices", async (_req, res) => {
    if (!voiceStudio) return res.json({ connected: false, voices: [], error: "VoiceStudio is turned off (VOICESTUDIO_URL=off)." });
    try {
      res.json({ connected: true, voices: await voiceStudio.voices() });
    } catch (err) {
      res.json({ connected: false, voices: [], error: err.message });
    }
  });

  app.post("/api/tts", async (req, res) => {
    if (!voiceStudio) return res.status(503).json({ error: "VoiceStudio is turned off (VOICESTUDIO_URL=off)." });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text is required" });
    try {
      const { audio, contentType } = await voiceStudio.speak(text, typeof req.body?.voiceId === "string" ? req.body.voiceId : undefined);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.end(audio);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // ── Reminders ────────────────────────────────────────────
  app.get("/api/reminders", async (_req, res) => res.json(await reminders.list()));

  app.post("/api/reminders", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 300) : "";
    if (!text) return res.status(400).json({ error: "text is required" });
    try {
      res.status(201).json(await reminders.add({ text, dueAt: parseDueAt(req.body?.dueAt, now()) }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/reminders/:id", async (req, res) => {
    const r = await reminders.remove(req.params.id);
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });

  app.post("/api/reminders/:id/dismiss", async (req, res) => {
    const r = await reminders.setStatus(req.params.id, "dismissed");
    if (!r) return res.status(404).json({ error: "Not found" });
    res.json(r);
  });

  // ── Confirm / cancel risky actions (shutdown, restart, sleep) ──
  app.post("/api/actions/:id/confirm", async (req, res) => {
    try {
      res.json({ ok: true, done: await pendingActions.confirm(req.params.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.post("/api/actions/:id/cancel", (req, res) => res.json({ ok: pendingActions.cancel(req.params.id) }));

  // ── Live events (reminders firing) ───────────────────────
  app.get("/api/events", async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    // Reminders that fired while the page was closed and haven't been dismissed yet.
    for (const r of await reminders.list()) if (r.status === "fired") send({ type: "reminder", reminder: r });
    const unsubscribe = events.subscribe(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      unsubscribe();
      clearInterval(ping);
    });
  });

  return app;
}
