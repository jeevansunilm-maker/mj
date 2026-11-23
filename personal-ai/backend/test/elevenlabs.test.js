import { test } from "node:test";
import assert from "node:assert/strict";
import { createElevenLabs } from "../src/voice/elevenlabs.js";
import { startTestApp } from "./helpers.js";

function fakeFetch(status = 200) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers, body: opts.body && JSON.parse(opts.body) });
    if (String(url).endsWith("/v1/voices")) {
      return Response.json({ voices: [{ voice_id: "abcdefghij1234567890", name: "Aria", category: "premade" }] });
    }
    if (status !== 200) return Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status });
    return new Response(new Uint8Array([0x49, 0x44, 0x33]), { headers: { "Content-Type": "audio/mpeg" } });
  };
  return { calls, fetchImpl };
}

test("no API key -> ElevenLabs is off", () => {
  assert.equal(createElevenLabs({ apiKey: "" }), null);
});

test("speak sends text with the key header and returns mp3 audio", async () => {
  const f = fakeFetch();
  const el = createElevenLabs({ apiKey: "k", voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "eleven_flash_v2_5", fetchImpl: f.fetchImpl });
  const out = await el.speak("Hello there.", "../../etc"); // bad voice id -> default
  assert.equal(out.contentType, "audio/mpeg");
  assert.deepEqual([...out.audio], [0x49, 0x44, 0x33]);
  assert.match(f.calls[0].url, /\/v1\/text-to-speech\/21m00Tcm4TlvDq8ikWAM\?output_format=mp3_44100_128$/);
  assert.equal(f.calls[0].headers["xi-api-key"], "k");
  assert.deepEqual(f.calls[0].body, { text: "Hello there.", model_id: "eleven_flash_v2_5" });
  assert.deepEqual(await el.voices(), [{ id: "abcdefghij1234567890", name: "Aria", category: "premade" }]);
});

test("bad key -> plain-English error", async () => {
  const el = createElevenLabs({ apiKey: "bad", voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "m", fetchImpl: fakeFetch(401).fetchImpl });
  await assert.rejects(el.speak("hi"), /rejected the API key/);
});

test("/api/tts streams audio to the browser; 503 when not set up", async () => {
  const plain = await startTestApp();
  try {
    const r = await fetch(plain.base + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    assert.equal(r.status, 503);
  } finally { await plain.close(); }
  const f = fakeFetch();
  const t = await startTestApp({ tts: createElevenLabs({ apiKey: "k", voiceId: "21m00Tcm4TlvDq8ikWAM", modelId: "m", fetchImpl: f.fetchImpl }) });
  try {
    const r = await fetch(t.base + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello.", voiceId: "abcdefghij1234567890" }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.equal((await r.arrayBuffer()).byteLength, 3);
    assert.match(f.calls[0].url, /abcdefghij1234567890/);
    const v = await (await fetch(t.base + "/api/voices")).json();
    assert.equal(v.voices[0].name, "Aria");
  } finally { await t.close(); }
});
