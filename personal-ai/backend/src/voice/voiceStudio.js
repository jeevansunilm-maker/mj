// VoiceStudio (OmniVoice Studio): a voice studio app running on YOUR PC.
// Free, private, offline once its models are downloaded, and it can use
// voices you cloned or designed in the app.
// API (from the app's own docs): GET /health, GET /v1/audio/voices,
// POST /v1/audio/speech (OpenAI-compatible). Default address http://127.0.0.1:3900.

const VOICE = /^[\w .:@'()-]{1,100}$/u;

export function createVoiceStudio({ baseUrl, apiKey = "", fetchImpl = fetch }) {
  if (!baseUrl || baseUrl === "off") return null;
  const root = baseUrl.replace(/\/+$/, "");
  const auth = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  async function call(path, init = {}, timeoutMs = 120_000) {
    try {
      return await fetchImpl(`${root}${path}`, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error(`VoiceStudio isn't running at ${root}. Open the VoiceStudio app and try again.`);
    }
  }

  async function failure(res) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error?.message ?? (typeof body.detail === "string" ? body.detail : "") ?? "";
    if (res.status === 401 || res.status === 403) {
      return new Error("VoiceStudio asked for a login. Set VOICESTUDIO_API_KEY in .env to the key from VoiceStudio's settings.");
    }
    return new Error(`VoiceStudio: ${msg || `error ${res.status}`}`);
  }

  return {
    url: root,
    async health() {
      try {
        const res = await call("/health", {}, 2000);
        return res.ok;
      } catch {
        return false;
      }
    },
    /** Saved / cloned voice profiles, plus the engine's default voice. */
    async voices() {
      const res = await call("/v1/audio/voices", {}, 5000);
      if (!res.ok) throw await failure(res);
      const { voices = [] } = await res.json();
      const profiles = voices
        .filter((v) => v.type === "profile")
        .map((v) => ({ id: v.id ?? v.voice_id, name: v.language ? `${v.name} (${v.language})` : v.name }));
      return [{ id: "default", name: "Default voice" }, ...profiles];
    },
    /** Returns { audio: Buffer, contentType } for one sentence or two. */
    async speak(text, voiceId) {
      const voice = voiceId && VOICE.test(voiceId) ? voiceId : "default";
      const res = await call("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // wav needs no ffmpeg on the VoiceStudio side; "tts-1" = the active engine.
        body: JSON.stringify({ model: "tts-1", input: text.slice(0, 4000), voice, response_format: "wav" }),
      });
      if (!res.ok) throw await failure(res);
      return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "audio/wav" };
    },
  };
}
