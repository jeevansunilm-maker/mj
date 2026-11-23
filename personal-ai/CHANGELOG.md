# Changelog

## 1.5.0 (2026-11-23)

### Changed
- **VoiceStudio replaces ElevenLabs.** Your AI's natural voice now comes from the VoiceStudio app on your PC (`http://127.0.0.1:3900`): free, private, offline-capable, and able to use your cloned or designed voices. The ElevenLabs code and settings were removed. Windows voices remain the fallback.
- `OLLAMA_URL` also accepts the OpenAI-style address (`http://localhost:11434/v1`).

### Added
- Settings: `VOICESTUDIO_URL` and `VOICESTUDIO_API_KEY`.
- The startup summary and the Profile panel show whether VoiceStudio was found.

## 1.4.0 (2026-11-23)

### Added
- **HUD look (new default):** an original holographic interface.
  - an animated AI core orb that reacts to listening, thinking and speaking
  - a live system panel with clock, date, CPU, RAM, battery and uptime (new `/api/stats` endpoint)
  - corner-bracket panels over a grid background, using Windows' built-in Bahnschrift font (nothing to download)
- **Full-screen voice stage** in hands-free mode, with live captions.
- **Look switcher** (HUD / Classic) in Profile. Animations respect the reduce-motion setting.

## 1.3.0 (2026-11-23)

### Added
- **ElevenLabs voices:** pick a natural voice (including your own cloned voices) in Spoken voice. Replies are spoken sentence by sentence, with the next sentence downloaded while the current one plays. If ElevenLabs fails, the PC voice takes over.
- **Telegram bot:**
  - message your AI from your phone, with no public URL needed
  - Confirm/Cancel buttons for risky actions
  - `/new` starts a fresh conversation
- **Discord bot:**
  - answers DMs and @mentions
  - Confirm/Cancel buttons
  - uses no privileged intents
- Both bots answer only allow-listed user IDs.
- The Profile panel shows the status of every connection.

### Changed
- Requires Node.js 22+ (uses the built-in WebSocket).
- Chat logic moved into `chatEngine.js`, shared by the web app and the bots.

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
