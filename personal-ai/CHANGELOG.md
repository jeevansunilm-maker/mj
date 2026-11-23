# Changelog

## 1.2.0 (2026-11-23)

### Added
- **Google Sheets:** your AI can look at a spreadsheet's tabs, read cells, add rows, and change cells (changes need Confirm). It uses a Google service account that only sees the sheets you share with it; no new packages. The Profile panel shows the connection and the email to share sheets with.
- **Hands-free conversation (🗣️ / Ctrl+Shift+H):**
  - sends when you pause
  - speaks the reply sentence by sentence
  - then listens again
  - "stop listening" or "goodbye" ends it
- **Spoken voice and speed** settings, with a "Test voice" button.

## 1.1.0 (2026-11-23)

### Added
- **Actions (tools):** the AI can take actions with Ollama or Claude. It asks for a tool, the backend checks the input and runs it, and the result goes back to the AI.
- **Reminders:** set by chatting or in the ⏰ panel. Saved in `data/reminders.json`. When due, they show a Windows notification and an in-app pop-up with a beep.
- **Email drafts:** cards with Open in email app / Open in Gmail / Copy. Nothing is ever sent automatically.
- **Windows controls:**
  - volume and mute
  - brightness (laptop screens)
  - lock
  - open apps from an allow-list (`data/apps.json`)
  - open websites and Google searches
  - shutdown, restart and sleep, only after you click **Confirm**
- **Voice typing:** 🎤 / Ctrl+Shift+Space, with ✨ AI clean-up of dictated text.
- **Claude web search** (`CLAUDE_WEB_SEARCH`, on by default).
- `scripts/start-windows.bat` and `apps.example.json`.

### Security
- The server refuses requests whose `Host` isn't localhost. This blocks DNS-rebinding attacks.
- It refuses cross-site POSTs (checked through `Origin` / `Sec-Fetch-Site`).
- Added headers: `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`. Removed `X-Powered-By`.
- New setting: `ALLOWED_HOSTS` (advanced) to allow other host names.

## 1.0.0 (2026-11-23)

### Added
- Local-first chat app: a Node.js/Express backend with a plain HTML/CSS/JS frontend.
- Providers: Ollama (local, default) and Claude (cloud, optional), with streamed replies.
- Profile and personality, saved chats, and a model picker.
- `AGENTS.md` + `CLAUDE.md` so Codex and Claude Code share the project rules.
- An offline test suite using fakes.
