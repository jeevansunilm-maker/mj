// VoiceStudio connector, tested against a fake server shaped like the real
// VoiceStudio API (GET /health, GET /v1/audio/voices, POST /v1/audio/speech).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createVoiceStudio } from "../src/voice/voiceStudio.js";
import { startTestApp } from "./helpers.js";

async function fakeVoiceStudio({ requireKey = null } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    calls.push({ method: req.method, url: req.url, body: body && JSON.parse(body), auth: req.headers.authorization });
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (requireKey && req.headers.authorization !== `Bearer ${requireKey}`) {
      return json(403, { error: { message: "authenticated consumer required", type: "authentication_error" } });
    }
    if (req.url === "/health") return json(200, { status: "ok" });
    if (req.url === "/v1/audio/voices") {
      return json(200, {
        voices: [
          { voice_id: "alloy", id: "alloy", name: "Alloy", type: "openai_alias" },
          { voice_id: "prof_123", id: "prof_123", name: "My Voice", type: "profile", language: "en" },
          { voice_id: "prof_456", id: "prof_456", name: "Narrator", type: "profile", language: null },
        ],
        engines: [],
      });
    }
    if (req.url === "/v1/audio/speech" && req.method === "POST") {
      const b = JSON.parse(body);
      if (b.voice === "Missing") return json(404, { error: { message: "Voice profile 'Missing' not found" } });
      res.writeHead(200, { "Content-Type": "audio/wav" });
      return res.end(Buffer.from("RIFF....WAVE"));
    }
    json(404, { error: { message: "not found" } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

test("VOICESTUDIO_URL=off disables it", () => {
  assert.equal(createVoiceStudio({ baseUrl: "off" }), null);
});

test("lists saved voice profiles (not the OpenAI aliases) plus the default", async () => {
  const f = await fakeVoiceStudio();
  try {
    const vs = createVoiceStudio({ baseUrl: f.url + "/" });
    assert.equal(await vs.health(), true);
    assert.deepEqual(await vs.voices(), [
      { id: "default", name: "Default voice" },
      { id: "prof_123", name: "My Voice (en)" },
      { id: "prof_456", name: "Narrator" },
    ]);
  } finally { await f.close(); }
});

test("speak sends an OpenAI-style request for WAV and returns the audio", async () => {
  const f = await fakeVoiceStudio();
  try {
    const vs = createVoiceStudio({ baseUrl: f.url });
    const out = await vs.speak("Hello there.", "prof_123");
    assert.equal(out.contentType, "audio/wav");
    assert.equal(out.audio.toString(), "RIFF....WAVE");
    assert.deepEqual(f.calls.at(-1).body, { model: "tts-1", input: "Hello there.", voice: "prof_123", response_format: "wav" });
    await vs.speak("x", "bad\nvoice<script>"); // invalid voice -> default
    assert.equal(f.calls.at(-1).body.voice, "default");
    await assert.rejects(vs.speak("x", "Missing"), /VoiceStudio: Voice profile 'Missing' not found/);
  } finally { await f.close(); }
});

test("not running -> plain-English error; login required -> explains the key", async () => {
  const down = createVoiceStudio({ baseUrl: "http://127.0.0.1:1" });
  assert.equal(await down.health(), false);
  await assert.rejects(down.speak("hi"), /isn't running at http:\/\/127\.0\.0\.1:1\. Open the VoiceStudio app/);

  const f = await fakeVoiceStudio({ requireKey: "k1" });
  try {
    await assert.rejects(createVoiceStudio({ baseUrl: f.url }).voices(), /VOICESTUDIO_API_KEY/);
    const withKey = createVoiceStudio({ baseUrl: f.url, apiKey: "k1" });
    assert.equal((await withKey.voices()).length, 3);
  } finally { await f.close(); }
});

test("/api/voices and /api/tts go through the app (browser never calls VoiceStudio directly)", async () => {
  const f = await fakeVoiceStudio();
  const t = await startTestApp({ voiceStudio: createVoiceStudio({ baseUrl: f.url }) });
  try {
    const v = await (await fetch(t.base + "/api/voices")).json();
    assert.equal(v.connected, true);
    assert.equal(v.voices[1].name, "My Voice (en)");
    const r = await fetch(t.base + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hi.", voiceId: "prof_456" }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/wav");
    assert.equal(f.calls.at(-1).body.voice, "prof_456");
  } finally { await t.close(); await f.close(); }
  const off = await startTestApp();
  try {
    const r = await fetch(off.base + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hi." }) });
    assert.equal(r.status, 503);
  } finally { await off.close(); }
});
