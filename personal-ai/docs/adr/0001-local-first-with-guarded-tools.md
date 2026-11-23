# ADR 0001: Local-first assistant with guarded tools

- **Status:** accepted
- **Date:** 2026-11-23

## Context

The user wants a personal AI that runs on their own Windows PC and can act on it: reminders, email, volume, brightness, apps and power. It must work without paid services, and both Codex and Claude Code must be able to keep building it.

## Decision

1. **Local by default.** Ollama is the default provider; Claude is optional. The server listens only on `127.0.0.1`.
2. **No build step.** The project uses plain Node.js ESM, Express 5 and vanilla HTML/CSS/JS, with only two runtime dependencies. This keeps it easy for a beginner and for AI coding agents to change safely.
3. **Tools are defined once.** Each tool is written once (a JSON schema plus `run`) and works with both providers. The tool loop lives inside each provider (`run()`), because Ollama and Claude format tool messages differently.
4. **Guard rails live in code, not in the prompt.**
   - Every tool input is validated (`tools/validate.js`).
   - Apps come from an allow-list.
   - Only http(s) URLs can be opened.
   - Destructive actions (shutdown, restart, sleep) only create a pending request, which runs after the user clicks Confirm.
   - Email is draft-only.
5. **PC control uses only built-in Windows tools** (PowerShell, `shutdown.exe`, `rundll32`). They are called with argument arrays, and values pass through environment variables, so nothing is ever joined into a shell string.
6. **Browser-origin protection.** Because a local server can be reached from any web page, the server checks `Host` (against DNS rebinding) and `Origin` / `Sec-Fetch-Site` (against cross-site requests), and sends strict security headers.

## Consequences

- Works offline and for free. Action quality depends on the local model; `qwen2.5:7b` or better is recommended.
- PC controls are Windows-only. A macOS or Linux module would add a file under `backend/src/system/`.
- Voice typing uses the browser's speech service (Chrome/Edge), which isn't local. A fully offline option would need a local Whisper model.
- Real Windows behaviour can't be covered by CI on Linux. The tests check the exact commands and arguments through fakes, so the first real run on Windows is a manual check.
