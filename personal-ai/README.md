# Personal AI

Your own AI assistant that runs on your Windows PC. It chats, remembers who you are, and **does things for you**: sets reminders, drafts emails, changes volume and brightness, opens apps and websites, and shuts down the PC after you confirm. It also has voice typing.

- **Local by default:** uses [Ollama](https://ollama.com), so the AI runs on your machine. It's free and private.
- **Cloud optional:** switch to Claude in the app if you add an API key. Claude can also search the web.
- **Personal:** tell it your name, things about you, and the personality you want.

```
 Browser (frontend/)            Node server (backend/)                    AI model
┌──────────────────┐  /api/chat ┌──────────────────────────────┐  HTTP  ┌──────────────────┐
│ chat, cards,     │──────────▶│ adds your profile + the time │──────▶│ Ollama (your PC) │
│ reminders, 🎤    │◀──────────│ runs the AI's actions:       │◀──────│ or Claude (cloud)│
└──────────────────┘  streamed │  reminders · email · volume  │        └──────────────────┘
                               │  brightness · apps · power   │──▶ Windows (PowerShell)
                               └──────────────────────────────┘
```

## Start it on Windows

1. Install **Node.js** (LTS, version 22 or newer) from [nodejs.org](https://nodejs.org) and **Ollama** from [ollama.com/download](https://ollama.com/download).
2. Download a model that can use actions. Open *Command Prompt* and run:
   ```bat
   ollama pull qwen2.5:7b
   ```
   On a PC with less than 8 GB of RAM, use `ollama pull llama3.2` instead.
3. Double-click **`scripts\start-windows.bat`**. The first run installs everything, and the app then opens at **http://localhost:3000**.

   (Or from a terminal: `npm install`, then `npm start`.)
4. Pick your model in the top-right menu and say hi.

**Start automatically when you log in:** press `Win+R`, type `shell:startup`, and put a shortcut to `scripts\start-windows.bat` in that folder.

## What you can ask

| Say something like… | What happens |
|---|---|
| "Remind me to call mom at 6 pm" | Reminder saved. At 6 pm a Windows notification appears and the app shows a pop-up with a beep |
| "Draft an email to my boss asking for Friday off" | An email card with **Open in email app**, **Open in Gmail** and **Copy** buttons. Nothing is sent automatically |
| "Set the volume to 30" / "mute" | Changes the speaker volume |
| "Make the screen dimmer" | Changes brightness (built-in laptop screens only) |
| "Open notepad" / "open Spotify" | Opens apps from your allow-list |
| "Search the web for cheap flights to Goa" | Opens Google in your browser. On Claude, it can also read the results and answer |
| "Add a ₹450 lunch to my budget sheet" (paste the sheet link once) | Reads the sheet's columns and adds a row. Changing existing cells needs **Confirm** |
| "What did I spend on rent this month?" + sheet link | Reads the sheet and answers |
| "Lock my PC" | Locks immediately |
| "Shut down" / "restart" / "sleep" | Shows a **Confirm** button first. Shutdown and restart wait 30 seconds; run `shutdown /a` to cancel |

You can also manage reminders yourself with the **⏰ Reminders** button.

## The look

By default the app uses a futuristic **HUD** design:
- an animated AI core that changes colour as it **listens** (green), **thinks** (amber) and **speaks** (cyan)
- a live system panel with the clock, CPU, memory and battery
- glowing panels with corner brackets

In hands-free mode the core fills the screen, with live captions of what you said and what it answers.

To switch to the simple **Classic** look, open **Profile & personality → Look**. If you've turned on Windows' *reduce animations* setting, the animations are switched off.

## Hands-free conversation

Click **🗣️**, or press **Ctrl+Shift+H**, then just talk.

1. When you pause, your message is sent.
2. Your AI **speaks the answer** and then listens again.
3. To stop, say **"stop listening"** or **"goodbye"**, or click 🗣️.

Choose the spoken voice and speed in **Profile & personality → Spoken voice**. Your VoiceStudio voices sound the most natural (see below). The built-in Windows voices, such as *Microsoft Zira* or *David*, work as a basic fallback. Use Chrome or Edge.

## Natural voice (VoiceStudio)

Your AI speaks with **VoiceStudio**, the voice studio app on your PC. It's free, private (your text never leaves your PC), and works offline once its voice models are downloaded. Any voice you **clone or design** in VoiceStudio can be your AI's voice.

1. Open the **VoiceStudio** app and leave it running. Its API is at `http://127.0.0.1:3900`, which is where your AI looks by default.
2. Start or restart your Personal AI. The terminal shows `✔ VoiceStudio found`.
3. In **Profile & personality → Spoken voice**, pick a voice under *VoiceStudio*: *Default voice*, or one of your saved voice profiles. Click **Test voice**.

Good to know:
- **If you start VoiceStudio after your AI**, just reopen Profile & personality and the voices appear.
- **If VoiceStudio is closed or busy**, your AI uses the basic Windows voice for that sentence, so you always hear an answer.
- **If you protected VoiceStudio with a login or key**, put its key in `.env` as `VOICESTUDIO_API_KEY=`.
- **If VoiceStudio runs on a different port**, set `VOICESTUDIO_URL=` in `.env`. Set it to `off` to turn the feature off.

## Message your AI from your phone

Your PC must be on with the app running. The bots reach out to Telegram or Discord from your PC, so you don't need to open your PC to the internet.

**Only people you allow can use the bots**, because your AI can control your PC. Anyone else just gets a message with their own user ID.

### Telegram (easiest)

1. In Telegram, open **@BotFather**, send `/newbot`, and pick a name and a username ending in `bot`.
2. BotFather gives you a token like `123456:ABC-...`. Put it in `.env` as `TELEGRAM_BOT_TOKEN=`.
3. Restart the app, open your bot in Telegram, and send `hi`. It replies with *"Your Telegram user ID is 123456789"*.
4. Put that number in `.env` as `TELEGRAM_ALLOWED_USERS=123456789`, then restart.

Now chat as normal:
- Actions like shutdown show ✅ **Confirm** / **Cancel** buttons.
- `/new` starts a fresh conversation.

### Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**.
2. Open **Bot** → **Reset Token**, copy the token, and put it in `.env` as `DISCORD_BOT_TOKEN=`.
3. Open **OAuth2 → URL Generator**:
   - tick **bot**
   - then tick **View Channels**, **Send Messages** and **Read Message History**
   - open the generated link and add the bot to your own server
4. Restart the app and send the bot a direct message (or @mention it in your server). It replies with your user ID.
5. Put it in `.env` as `DISCORD_ALLOWED_USERS=`, then restart.

In servers, the bot only answers when you @mention it. Say `new` to start a fresh conversation.

### WhatsApp (not built yet)

WhatsApp is harder. Meta's servers have to *push* each message to your app, so your PC would need to be reachable from the internet through a tunnel (such as Cloudflare Tunnel). You'd also need a WhatsApp Business account in Meta's developer console. Telegram does the same job without any of that. Ask if you want WhatsApp anyway, and it can be added with the tunnel locked down to WhatsApp only.

## Voice typing (like Wispr Flow)

- Click **🎤**, or press **Ctrl+Shift+Space**, and talk. Click again to stop.
- With **✨** on, your AI cleans up what you said: it removes "um"s and false starts and fixes punctuation.
- Voice typing uses the browser's speech recognition, so use **Chrome or Edge**. Note that the browser sends the audio to its speech service (Google or Microsoft) to turn it into text.
- To dictate in any app, Windows has its own voice typing: press **Win+H**.

## Google Sheets

Your AI uses a Google **service account**: a "robot" Google account that can only open the sheets **you share with it**. Setup takes about 5 minutes, one time:

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project, for example *Personal AI*.
2. Open **APIs & Services → Library**, search **Google Sheets API**, and click **Enable**.
3. Open **IAM & Admin → Service Accounts → Create service account**. Name it `personal-ai`, click **Done**, and skip the roles.
4. Click the new account, then **Keys → Add key → Create new key → JSON**. A file downloads.
5. Rename that file to `google-service-account.json` and move it into the `personal-ai\data\` folder.
6. Restart the app. **Profile & personality** should now show *Google Sheets: connected ✓* and the robot's email (`…@….iam.gserviceaccount.com`).
7. In any sheet you want your AI to use, click **Share**, paste that email, and choose **Editor**.

Then paste the sheet's link in the chat: *"Add today's lunch, 450, to https://docs.google.com/spreadsheets/d/…"*. Tip: put your main sheet's link in **About you**, for example *"My budget sheet: https://…"*, so you never have to paste it again.

Your AI can read cells, add rows, and change cells. Changing existing cells always asks you to **Confirm** first. Keep the key file private: it lives in `data\`, which is never committed to git.

## Your apps

The AI can open only apps on an allow-list. The built-in list is Notepad, Calculator, Paint, File Explorer, Task Manager, Settings pages, Edge, Camera, Mail, Calendar, Spotify and WhatsApp.

To add your own apps, copy `apps.example.json` to `data/apps.json` and edit the paths. To find an app's path, right-click its shortcut, choose **Open file location**, then right-click the file and choose **Copy as path**. Set an app to `null` to remove it from the list. Restart the app after editing.

## Models

Any Ollama model can chat. To use **actions**, the model needs tool support:

| Model | Size | Notes |
|---|---|---|
| `qwen2.5:7b` | ~4.7 GB | Best local choice for actions |
| `llama3.2` | ~2 GB | Lighter; handles simple actions |
| `gemma3:4b` | ~3 GB | Chat only. The app tells you it can't use actions |

**Claude (cloud):** put your key from [console.anthropic.com](https://console.anthropic.com) in `.env` as `ANTHROPIC_API_KEY=sk-ant-...`, restart, and choose **Cloud (Claude)**. It's the most capable option, can search the web, and is billed by Anthropic.

## Where your data lives

| What | Where |
|---|---|
| Conversations | Your browser (localStorage) |
| Profile | `data/profile.json` |
| Reminders | `data/reminders.json` |
| Your apps | `data/apps.json` |
| Google key (secret) | `data/google-service-account.json` |
| Bot conversations | Memory only, cleared when the app restarts |
| Settings and API key | `.env` (never commit it) |

The app listens on `127.0.0.1` only, so other devices on your network can't open it. It also refuses requests from other websites open in your browser, so a web page can't control your PC through it. Open it as `http://localhost:3000` or `http://127.0.0.1:3000`.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the app |
| `npm run dev` | Start and auto-restart when you edit backend files |
| `npm test` | Run the tests. They work offline, with no Ollama, no API key and no Windows needed |

## Project structure

```
personal-ai/
├── backend/src/
│   ├── server.js            starts everything
│   ├── app.js               API routes (chat, reminders, confirm, events, polish)
│   ├── config.js            settings from .env
│   ├── prompt.js            "who you are" instructions + current time
│   ├── profileStore.js      your profile
│   ├── reminders.js         reminder storage + scheduler
│   ├── pendingActions.js    the Confirm step for shutdown/restart/sleep
│   ├── events.js            live updates to the browser
│   ├── providers/           ollama.js, claude.js: talking to the AI (with tool loop)
│   ├── tools/               the actions the AI can take + input checking
│   └── system/windows.js    volume, brightness, power, apps, notifications
├── backend/test/            automated tests (fake AI, fake PC)
├── frontend/                index.html, styles.css, app.js
├── scripts/start-windows.bat
├── docs/HOW-AI-WORKS.md     how AI works, explained simply
├── AGENTS.md                instructions for Codex and other coding agents
└── CLAUDE.md                instructions for Claude Code (points to AGENTS.md)
```

## Updating and rolling back

Before updating, back up the `data\` folder (profile, reminders, apps). Then update the code:

```bat
git pull
npm install
npm start
```

If something breaks, go back to the last version that worked:

```bat
git log --oneline            :: find the last good commit
git checkout <commit> -- .   :: restore that version of the code
npm install
npm start
```

Your `data\` files and browser chats keep working across versions. Older saved chats are still readable, and `data\reminders.json` didn't exist before 1.1.0, so older versions just ignore it. See [CHANGELOG.md](CHANGELOG.md).

## Building on it with Codex or Claude Code

Open this folder in either tool and describe what you want, for example *"add a weather tool"* or *"add Google Sheets"*. Both tools read `AGENTS.md`, which explains how to add a new action safely.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama isn't running" | Open the Ollama app, or run `ollama serve` |
| "Model … isn't installed" | Run `ollama pull <model name>` |
| The AI says it did something but nothing happened | Small models sometimes skip the tool. Use `qwen2.5:7b` or Claude. Real actions always show a card in the chat |
| Volume or brightness error | Brightness works on laptop screens only. Check that PowerShell isn't blocked by your organisation |
| No Windows notification | Settings → System → Notifications → make sure notifications are on for **Windows PowerShell** |
| 🎤 does nothing | Use Chrome or Edge, and allow the microphone when asked |
| Port 3000 is in use | Set `PORT=3001` in `.env` |

To learn how it all works, read [docs/HOW-AI-WORKS.md](docs/HOW-AI-WORKS.md).
