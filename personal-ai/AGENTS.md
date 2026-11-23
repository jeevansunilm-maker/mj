# AGENTS.md — guide for AI coding agents (Codex, Claude Code, others)

This file tells any coding agent how this project is built and how to change it safely.
`CLAUDE.md` points here, so Codex and Claude Code follow the same rules.

## What this project is

A personal AI chat assistant that runs on the user's own computer.

- **Backend:** Node.js (ESM, no TypeScript, no build step) + Express 5, in `backend/src/`.
- **Frontend:** plain HTML/CSS/JS in `frontend/`, no framework and no bundler. The backend serves it.
- **AI providers:** Ollama (local, the default) and Claude (cloud, optional), in `backend/src/providers/`.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Run | `npm start` → http://localhost:3000 |
| Run with auto-reload | `npm run dev` |
| Test (offline, no API key or Ollama needed) | `npm test` |

Always run `npm test` after a change. All tests must pass before you say you're done.

## Layout

```
backend/src/server.js          entry point: loads config, starts HTTP server
backend/src/app.js             Express routes: /api/status, /api/profile, /api/chat (SSE)
backend/src/config.js          every setting comes from env vars (see .env.example)
backend/src/prompt.js          system prompt builder + chat-history validation
backend/src/profileStore.js    saves the user's profile to data/profile.json
backend/src/providers/
  index.js                     provider registry
  ollama.js                    local models via Ollama's /api/chat (NDJSON stream)
  claude.js                    Anthropic SDK (@anthropic-ai/sdk), streaming
  errors.js                    ProviderError = an error message safe to show users
backend/test/                  node:test tests; helpers.js has a fake Ollama server + fake Claude client
frontend/index.html|styles.css|app.js
docs/HOW-AI-WORKS.md           beginner explanation of how the AI works
```

## The provider contract

Every provider in `backend/src/providers/` returns an object with:

```js
{
  id: "ollama",                 // used in requests and in AI_PROVIDER
  label: "Local (Ollama)",      // shown in the UI
  defaultModel: "llama3.2",
  async status() { return { available, model, models: [], detail } },
  async *stream({ system, messages, model, signal }) { yield "text chunk" }
}
```

- `stream` yields plain text chunks. It throws `ProviderError` with a message a non-technical user can act on.
- It must respect `signal` (an AbortSignal) so the Stop button and closed tabs stop generation.
- To add a provider: create the file, register it in `providers/index.js`, and add tests that use a fake. Tests must never call a real model.

## Rules

- **Secrets:** API keys live only in `.env` (git-ignored) and are read in `config.js`. Never send them to the frontend, never log them, never commit them.
- **Safety:** render AI output with `textContent`, never `innerHTML`. Keep `HOST=127.0.0.1` as the default.
- **Claude API:** the model is `claude-opus-5-5`, unless the user picks another one through `CLAUDE_MODEL`. Don't send `thinking: {type:"disabled"}`, `budget_tokens`, `temperature`, or an assistant-message prefill. The API rejects all of these. Use `output_config.effort` to control depth.
- **Ollama:** use the HTTP API at `OLLAMA_URL` (`/api/tags`, `/api/chat`). Model names come from the user; validate them as `ollama.js` does.
- **Dependencies:** keep them minimal. Ask the user before adding a framework, a bundler, or a database.
- **Style:** ES modules, small functions, a short comment on *why* when it isn't obvious. Write user-facing errors in plain English.
- **Installing skills/plugins/MCP servers:** follow the repository-root `CLAUDE.md`. Inspect the skill or plugin first, report on it, and wait for the user to say "yes".
