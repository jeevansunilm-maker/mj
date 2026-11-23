// The provider registry. To add a new AI provider, create a file that returns
// { id, label, defaultModel, status(), stream() } and register it here.
import { createClaudeProvider } from "./claude.js";
import { createOllamaProvider } from "./ollama.js";

export function createProviders(config, overrides = {}) {
  const list = [
    overrides.ollama ?? createOllamaProvider(config.ollama),
    overrides.claude ?? createClaudeProvider(config.claude),
  ];
  return new Map(list.map((p) => [p.id, p]));
}
