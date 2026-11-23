// Ollama provider — runs open models (Llama, Qwen, Gemma, Mistral, ...) on YOUR computer.
// Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
//   GET  /api/tags  -> list installed models
//   POST /api/chat  -> chat; with stream:true it returns one JSON object per line
import { ProviderError, isAbortError } from "./errors.js";

const MODEL_NAME = /^[\w.\-:/]{1,200}$/;
const MAX_STEPS = 8;

/** Ollama streams one JSON object per line ("NDJSON"). */
async function* readNdjson(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

export function createOllamaProvider({ baseUrl, model, fetchImpl = fetch }) {
  const notRunning = (cause) =>
    new ProviderError(
      `Ollama isn't running at ${baseUrl}. Start the Ollama app (or run "ollama serve") and try again.`,
      { status: 503, cause },
    );

  async function post(useModel, messages, toolDefs, signal) {
    try {
      return await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: useModel,
          messages,
          stream: true,
          ...(toolDefs.length ? { tools: toolDefs } : {}),
        }),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw notRunning(err);
    }
  }

  async function throwHttpError(res, useModel) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new ProviderError(`Model "${useModel}" isn't installed in Ollama. Run: ollama pull ${useModel}`, {
        status: 404,
      });
    }
    throw new ProviderError(`Ollama error ${res.status}: ${body.error ?? res.statusText}`);
  }

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

    /**
     * Chat with optional tools. Yields {type:"text"} and {type:"tool"} events.
     * When the model asks for a tool, we run it via executeTool, send the
     * result back, and let the model continue (up to MAX_STEPS rounds).
     */
    async *run({ system, messages, model: requested, tools = [], executeTool, signal }) {
      const useModel = requested && MODEL_NAME.test(requested) ? requested : model;
      const convo = [{ role: "system", content: system }, ...messages];
      let toolDefs = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));

      for (let step = 0; step < MAX_STEPS; step++) {
        let res = await post(useModel, convo, toolDefs, signal);
        if (res.status === 400 && toolDefs.length) {
          const body = await res.json().catch(() => ({}));
          if (/does not support tools/i.test(body.error ?? "")) {
            toolDefs = []; // this model can chat but not use tools; carry on without them
            yield {
              type: "text",
              text: `(Note: "${useModel}" can't use actions like reminders. Try qwen2.5 or llama3.2 for that.)\n\n`,
            };
            res = await post(useModel, convo, toolDefs, signal);
          } else {
            throw new ProviderError(`Ollama error 400: ${body.error ?? res.statusText}`);
          }
        }
        if (!res.ok) await throwHttpError(res, useModel);

        let content = "";
        const toolCalls = [];
        for await (const data of readNdjson(res.body)) {
          if (data.error) throw new ProviderError(`Ollama error: ${data.error}`);
          if (data.message?.content) {
            content += data.message.content;
            yield { type: "text", text: data.message.content };
          }
          if (data.message?.tool_calls?.length) toolCalls.push(...data.message.tool_calls);
          if (data.done) break;
        }
        if (!toolCalls.length || !executeTool) return;

        convo.push({ role: "assistant", content, tool_calls: toolCalls });
        for (const call of toolCalls) {
          const outcome = await executeTool(call.function?.name, call.function?.arguments ?? {});
          yield { type: "tool", ...outcome };
          convo.push({ role: "tool", tool_name: outcome.name, content: JSON.stringify(outcome.result) });
        }
      }
      yield { type: "text", text: "\n\n[Stopped: too many steps in a row.]" };
    },
  };
}
