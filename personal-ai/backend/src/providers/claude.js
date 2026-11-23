// Claude provider — Anthropic's cloud models. Needs ANTHROPIC_API_KEY in .env.
// The key stays on this server; the browser never sees it.
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, isAbortError } from "./errors.js";

const MAX_STEPS = 10;
const MAX_STREAM_RETRIES = 2;

export function createClaudeProvider({ apiKey, model, effort, webSearch = true, client }) {
  const api = client ?? (apiKey ? new Anthropic({ apiKey }) : null);

  return {
    id: "claude",
    label: "Cloud (Claude)",
    defaultModel: model,

    async status() {
      return api
        ? { available: true, model, models: [model], detail: "API key set" }
        : { available: false, model, models: [], detail: "Add ANTHROPIC_API_KEY to .env to enable" };
    },

    /**
     * Streams a reply; when Claude asks for tools, runs them with executeTool
     * and continues. Yields {type:"text"} and {type:"tool"} events.
     */
    async *run({ system, messages, tools = [], executeTool, signal }) {
      if (!api) {
        throw new ProviderError("Claude isn't set up. Add ANTHROPIC_API_KEY to .env and restart.", { status: 503 });
      }
      const apiTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        eager_input_streaming: true, // stream tool input; we validate it ourselves before running
      }));
      // Claude's built-in web search runs on Anthropic's servers; no extra key needed.
      if (webSearch && executeTool) apiTools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });

      const convo = [...messages];
      let retries = 0;

      for (let step = 0; step < MAX_STEPS; step++) {
        let final;
        try {
          const stream = api.beta.messages.stream(
            {
              model,
              max_tokens: 64000,
              system,
              messages: convo,
              ...(apiTools.length ? { tools: apiTools } : {}),
              output_config: { effort },
              cache_control: { type: "ephemeral" }, // cheaper repeated conversation prefix
              // If the model declines for safety reasons, the API retries on a fallback model.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            },
            { signal },
          );
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              yield { type: "text", text: event.delta.text };
            }
          }
          final = await stream.finalMessage();
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof Anthropic.APIError) throw new ProviderError(describeClaudeError(err), { cause: err });
          // Unparseable streamed tool input: re-issue the request a couple of times.
          if (++retries <= MAX_STREAM_RETRIES) { step--; continue; }
          throw new ProviderError("Claude sent a broken response. Please try again.", { cause: err });
        }

        const toolUses = final.content.filter((b) => b.type === "tool_use");
        if (final.stop_reason === "refusal") {
          throw new ProviderError("The assistant declined to answer this request.", { status: 422 });
        }
        if (final.stop_reason === "max_tokens") {
          // A cut-off tool input can look valid, so never run tools from this turn.
          yield { type: "text", text: "\n\n[Reply cut off: it got too long.]" };
          return;
        }
        if (final.stop_reason === "pause_turn") {
          // A long server-side web search paused; send it back to let Claude continue.
          convo.push({ role: "assistant", content: final.content });
          continue;
        }
        if (final.stop_reason !== "tool_use" || !toolUses.length || !executeTool) return;

        // Keep the whole assistant turn (thinking blocks included) unchanged.
        convo.push({ role: "assistant", content: final.content });
        const results = [];
        for (const block of toolUses) {
          const outcome = await executeTool(block.name, block.input);
          yield { type: "tool", ...outcome };
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(outcome.result),
            ...(outcome.isError ? { is_error: true } : {}),
          });
        }
        // All tool results go back together in one user message.
        convo.push({ role: "user", content: results });
      }
      yield { type: "text", text: "\n\n[Stopped: too many steps in a row.]" };
    },
  };
}

function describeClaudeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Claude API key. Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (err instanceof Anthropic.RateLimitError) return "Claude rate limit hit — wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  return `Claude error ${err.status}: ${err.message}`;
}
