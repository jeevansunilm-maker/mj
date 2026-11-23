# AGENTS.md — guide for AI coding agents (Codex, Claude Code, others)

This file tells any coding agent how this project is built and how to change it safely.
`CLAUDE.md` points here, so Codex and Claude Code follow the same rules.

## What this project is

A personal AI chat assistant that runs on the user's own computer.

- **Backend:** Node.js (ESM, no TypeScript, no build step) + Express 5, in `backend/src/`.
- **Frontend:** plain HTML/CSS/JS in `frontend/`, no framework and no bundler. The backend serves it.
- **AI providers:** Ollama (local, the default) and Claude (cloud, optional), in `backend/src/providers/`.
- **Tools (actions):** reminders, email drafts, Google Sheets (service account, `backend/src/google/`), and on Windows: volume, brightness, power, apps and websites. They live in `backend/src/tools/` and `backend/src/system/`.
- **Target OS:** the user runs **Windows**. PC-control code is Windows-only and is hidden on other systems.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Run | `npm start` → http://localhost:3000 |
| Run with auto-reload | `npm run dev` |
| Test (offline, no API key, Ollama or Windows needed) | `npm test` |
| Start on Windows | double-click `scripts\start-windows.bat` |

Always run `npm test` after a change. All tests must pass before you say you're done.

## Layout

```
backend/src/server.js          entry point: loads config, starts HTTP server
backend/src/app.js             Express routes: status, profile, chat (SSE), polish, reminders, actions confirm, events (SSE)
backend/src/config.js          every setting comes from env vars (see .env.example)
backend/src/prompt.js          system prompt builder + chat-history validation
backend/src/profileStore.js    saves the user's profile to data/profile.json
backend/src/reminders.js       reminder store (data/reminders.json) + scheduler
backend/src/pendingActions.js  Confirm step for risky actions (shutdown/restart/sleep)
backend/src/events.js          pub/sub for /api/events (reminders firing)
backend/src/tools/index.js     tool definitions: name, description, JSON-schema parameters, run()
backend/src/tools/validate.js  validates every tool input before it runs
backend/src/tools/executor.js  runs a tool call, turns failures into error results for the AI
backend/src/system/windows.js  PowerShell/shutdown.exe/rundll32 wrappers (values passed via env vars)
backend/src/system/index.js    picks the OS module; loads the app allow-list (data/apps.json)
backend/src/google/            serviceAccount.js (JWT → access token, node:crypto) + sheets.js (Sheets v4 via fetch)
backend/src/security.js        Host allow-list (DNS rebinding), cross-site POST block, security headers
backend/src/providers/
  index.js                     provider registry
  ollama.js                    local models via Ollama's /api/chat (NDJSON stream)
  claude.js                    Anthropic SDK (@anthropic-ai/sdk), streaming
  errors.js                    ProviderError = an error message safe to show users
backend/test/                  node:test tests; helpers.js has a fake Ollama server, a fake Claude client,
                               a fake Windows PC (fakeSystem) and startTestApp() to wire them together
frontend/index.html|styles.css|app.js   (chat, action cards, reminders, 🎤 dictation, 🗣️ hands-free voice loop)
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
  // Yields {type:"text", text} and {type:"tool", ...outcome}. When the model calls a tool,
  // run it with `await executeTool(name, input)`, send the result back, and continue the loop.
  async *run({ system, messages, model, tools, executeTool, signal }) { ... }
}
```

- `run` throws `ProviderError` with a message a non-technical user can act on.
- It must respect `signal` (an AbortSignal) so the Stop button and closed tabs stop generation.
- With no `tools`/`executeTool` (as `/api/polish` calls it), it must just chat.
- To add a provider: create the file, register it in `providers/index.js`, and add tests that use a fake. Tests must never call a real model.

## Adding a tool (action)

1. Add an entry in `backend/src/tools/index.js` with `name`, `description` (written for the AI), `parameters` (a JSON schema; `validate.js` supports object/string/integer/number/boolean, enum, required, minimum, maximum, maxLength), and `run(input)` returning `{ result, display }`.
2. `display.kind` picks the chat card: `info` (`icon`, `text`), `reminder`, `email`, `confirm`, or `error`. A new kind needs a renderer in `actionCard()` in `frontend/app.js`.
3. Anything that changes the PC goes through the `system` object (`backend/src/system/`), so tests can use `fakeSystem()`.
4. Add a test in `backend/test/tools.test.js` that scripts the fake model to call the tool.

**Safety rules for tools:**
- Anything destructive or hard to undo (shutdown, restart, sleep, deleting or sending things) must use `pendingActions.create(...)` and show a `confirm` card. Never run it directly.
- Never build shell commands by joining strings. Use `execFile`/`spawn` with argument arrays, and pass values to PowerShell through environment variables.
- Apps come only from the allow-list. URLs must be http(s).
- Email is draft-only. Sending email needs the user's explicit OK.
- Google Sheets: reading and appending run directly. Overwriting cells (`sheets_update_cells`) goes through Confirm. Never log or return the service-account key.

## Rules

- **Secrets:** API keys live only in `.env` (git-ignored) and are read in `config.js`. Never send them to the frontend, never log them, never commit them.
- **Safety:** render AI output with `textContent`, never `innerHTML`. Keep `HOST=127.0.0.1` as the default.
- **Claude API:** the model is `claude-opus-5-5`, unless the user picks another one through `CLAUDE_MODEL`. Don't send `thinking: {type:"disabled"}`, `budget_tokens`, `temperature`, or an assistant-message prefill. The API rejects all of these. Use `output_config.effort` to control depth.
- **Ollama:** use the HTTP API at `OLLAMA_URL` (`/api/tags`, `/api/chat` with `tools`). Model names come from the user; validate them as `ollama.js` does. Models without tool support get a 400; we retry without tools.
- **Claude tools:** use the manual streaming loop in `claude.js`. Send back the full `final.content`, put all `tool_result` blocks in one user message, never run tools when `stop_reason` is `max_tokens` or `refusal`, and set `eager_input_streaming: true` (inputs are validated by `validate.js`). Never use forced `tool_choice`.
- **Current time:** `withCurrentTime()` adds it to the newest user message, not the system prompt, so the prompt cache keeps working.
- **Dependencies:** keep them minimal. Ask the user before adding a framework, a bundler, or a database.
- **Style:** ES modules, small functions, a short comment on *why* when it isn't obvious. Write user-facing errors in plain English.
- **Installing skills/plugins/MCP servers:** follow the repository-root `CLAUDE.md`. Inspect the skill or plugin first, report on it, and wait for the user to say "yes".
