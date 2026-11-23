// Claude provider — Anthropic's cloud models. Needs ANTHROPIC_API_KEY in .env.
// The key stays on this server; the browser never sees it.
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, isAbortError } from "./errors.js";

export function createClaudeProvider({ apiKey, model, effort, client }) {
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

    async *stream({ system, messages, signal }) {
      if (!api) {
        throw new ProviderError("Claude isn't set up. Add ANTHROPIC_API_KEY to .env and restart.", {
          status: 503,
        });
      }
      const stream = api.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          system,
          messages,
          output_config: { effort },
          cache_control: { type: "ephemeral" }, // cheaper repeated conversation prefix
          // If the model declines for safety reasons, the API retries on a fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );

      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          throw new ProviderError("The assistant declined to answer this request.", { status: 422 });
        }
        if (final.stop_reason === "max_tokens") yield "\n\n[Reply cut off: it got too long.]";
      } catch (err) {
        if (err instanceof ProviderError || isAbortError(err)) throw err;
        throw new ProviderError(describeClaudeError(err), { cause: err });
      }
    },
  };
}

function describeClaudeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid Claude API key. Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key can't use that model.";
  if (err instanceof Anthropic.RateLimitError) return "Claude rate limit hit — wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude error ${err.status}: ${err.message}`;
  return "Unexpected error talking to Claude.";
}
