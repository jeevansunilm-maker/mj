// Ollama provider — runs open models (Llama, Qwen, Gemma, Mistral, ...) on YOUR computer.
// Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
//   GET  /api/tags  -> list installed models
//   POST /api/chat  -> chat; with stream:true it returns one JSON object per line
import { ProviderError, isAbortError } from "./errors.js";

const MODEL_NAME = /^[\w.\-:/]{1,200}$/;

export function createOllamaProvider({ baseUrl, model, fetchImpl = fetch }) {
  const notRunning = (cause) =>
    new ProviderError(
      `Ollama isn't running at ${baseUrl}. Start the Ollama app (or run "ollama serve") and try again.`,
      { status: 503, cause },
    );

  const sameModel = (installed, wanted) =>
    installed === wanted || installed === `${wanted}:latest`;

  return {
    id: "ollama",
    label: "Local (Ollama)",
    defaultModel: model,

    async status() {
      try {
        const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { models = [] } = await res.json();
        const names = models.map((m) => m.name);
        const installed = names.some((n) => sameModel(n, model));
        return {
          available: names.length > 0,
          model,
          models: names,
          detail: installed
            ? "Running locally"
            : names.length
              ? `Model "${model}" not installed — pick another or run: ollama pull ${model}`
              : `No models installed — run: ollama pull ${model}`,
        };
      } catch {
        return {
          available: false,
          model,
          models: [],
          detail: `Ollama not reachable at ${baseUrl} — install it from ollama.com and start it`,
        };
      }
    },

    async *stream({ system, messages, model: requested, signal }) {
      const useModel = requested && MODEL_NAME.test(requested) ? requested : model;
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: useModel,
            messages: [{ role: "system", content: system }, ...messages],
            stream: true,
          }),
          signal,
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw notRunning(err);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) {
          throw new ProviderError(
            `Model "${useModel}" isn't installed in Ollama. Run: ollama pull ${useModel}`,
            { status: 404 },
          );
        }
        throw new ProviderError(`Ollama error ${res.status}: ${body.error ?? res.statusText}`);
      }

      // Read the NDJSON stream line by line.
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.error) throw new ProviderError(`Ollama error: ${data.error}`);
          if (data.message?.content) yield data.message.content;
          if (data.done) return;
        }
      }
    },
  };
}
