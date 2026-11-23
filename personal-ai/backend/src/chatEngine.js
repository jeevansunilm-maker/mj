// The one place a conversation turn happens. Used by the web app, Telegram and
// Discord, so every channel gets the same profile, tools and safety checks.
import { buildSystemPrompt, withCurrentTime } from "./prompt.js";
import { ProviderError } from "./providers/errors.js";
import { createToolExecutor } from "./tools/executor.js";
import { describeAction } from "./tools/index.js";

export function createChatEngine({ config, providers, profileStore, tools = [], now = () => new Date() }) {
  const executeTool = createToolExecutor(tools);
  return {
    executeTool,
    /**
     * Yields {type:"text", text} and {type:"tool", name, isError, display, note}.
     * channelNote: extra instructions for a channel (e.g. "replying in Telegram").
     */
    async *chat({ providerId, model, messages, signal, channelNote }) {
      const provider = providers.get(providerId ?? config.defaultProvider);
      if (!provider) throw new ProviderError(`Unknown provider "${providerId}"`, { status: 400 });
      let system = buildSystemPrompt(await profileStore.get(), { hasTools: tools.length > 0 });
      if (channelNote) system += `\n${channelNote}`;
      for await (const event of provider.run({
        system,
        messages: withCurrentTime(messages, now()),
        model,
        tools,
        executeTool,
        signal,
      })) {
        if (event.type === "text") yield event;
        else if (event.type === "tool") {
          yield { type: "tool", name: event.name, isError: event.isError, display: event.display, note: describeAction(event) };
        }
      }
    },
  };
}
