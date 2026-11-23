// ElevenLabs text-to-speech: natural, human-like voices for your AI.
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// The API key stays on this server; the browser only receives the audio.

const VOICE_ID = /^[a-zA-Z0-9]{10,40}$/;
const MAX_CHARS = 1000; // per request (we send one or two sentences at a time)

export function createElevenLabs({ apiKey, voiceId, modelId, fetchImpl = fetch, baseUrl = "https://api.elevenlabs.io" }) {
  if (!apiKey) return null;
  const headers = { "xi-api-key": apiKey };

  async function failure(res) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail?.message ?? body.detail?.status ?? (typeof body.detail === "string" ? body.detail : "");
    if (res.status === 401) return new Error("ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY in .env.");
    if (res.status === 429) return new Error("ElevenLabs is busy or your plan's limit was reached. Try again shortly.");
    if (/quota/i.test(detail)) return new Error("Your ElevenLabs character quota is used up for this month.");
    return new Error(`ElevenLabs error ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  return {
    defaultVoiceId: voiceId,
    model: modelId,

    async voices() {
      const res = await fetchImpl(`${baseUrl}/v1/voices`, { headers });
      if (!res.ok) throw await failure(res);
      const { voices = [] } = await res.json();
      return voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category }));
    },

    /** Returns { audio: Buffer, contentType } for one chunk of text. */
    async speak(text, requestedVoice) {
      const vid = requestedVoice && VOICE_ID.test(requestedVoice) ? requestedVoice : voiceId;
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: text.slice(0, MAX_CHARS), model_id: modelId }),
        });
      } catch {
        throw new Error("Couldn't reach ElevenLabs. Check your internet connection.");
      }
      if (!res.ok) throw await failure(res);
      return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
    },
  };
}
