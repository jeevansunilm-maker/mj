// All settings come from environment variables (see .env.example).
// Defaults are chosen so the app works locally with Ollama and zero config.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..", "..");

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1", // localhost only — not exposed to your network
    // Extra host names allowed to open the app (advanced; e.g. a LAN name). Comma-separated.
    allowedHosts: (env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
    defaultProvider: env.AI_PROVIDER ?? "ollama", // "ollama" (local) or "claude" (cloud)
    dataDir: env.DATA_DIR ?? path.join(ROOT_DIR, "data"),
    frontendDir: path.join(ROOT_DIR, "frontend"),
    ollama: {
      baseUrl: (env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
      model: env.OLLAMA_MODEL ?? "llama3.2",
    },
    claude: {
      apiKey: env.ANTHROPIC_API_KEY ?? "",
      model: env.CLAUDE_MODEL ?? "claude-opus-5-5",
      effort: env.CLAUDE_EFFORT ?? "medium", // low | medium | high | xhigh | max
      webSearch: (env.CLAUDE_WEB_SEARCH ?? "on") !== "off", // Claude's built-in web search
    },
  };
}
