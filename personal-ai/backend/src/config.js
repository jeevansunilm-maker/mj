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
    // Google Sheets: path to the service-account key (see README → Google Sheets)
    googleKeyFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || path.join(env.DATA_DIR ?? path.join(ROOT_DIR, "data"), "google-service-account.json"),
    voiceStudio: {
      // VoiceStudio app on this PC. Set VOICESTUDIO_URL=off to disable.
      baseUrl: env.VOICESTUDIO_URL || "http://127.0.0.1:3900",
      apiKey: env.VOICESTUDIO_API_KEY ?? "",
    },
    telegram: {
      token: env.TELEGRAM_BOT_TOKEN ?? "",
      allowedUsers: (env.TELEGRAM_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
    discord: {
      token: env.DISCORD_BOT_TOKEN ?? "",
      allowedUsers: (env.DISCORD_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
    ollama: {
      // Accepts "http://localhost:11434" or the OpenAI-style "http://localhost:11434/v1";
      // this app uses Ollama's native /api routes on the same server.
      baseUrl: (env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "").replace(/\/v1$/, ""),
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
