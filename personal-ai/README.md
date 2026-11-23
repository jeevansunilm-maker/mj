# Personal AI

Your own AI assistant that runs on your computer. It has a chat window in the browser (the **frontend**) and a small Node.js server (the **backend**) that talks to the AI model.

- **Local by default:** uses [Ollama](https://ollama.com), so the AI runs on your machine. It's free and private, and it works offline once a model is downloaded.
- **Cloud optional:** switch to Claude in the app if you add an API key.
- **Personal:** tell it your name, things about you, and the personality you want.
- **Your chats stay on your computer:** conversations are saved in your browser, and your profile is saved in `data/profile.json`.

```
 Browser (frontend/)            Node server (backend/)              AI model
┌──────────────────┐  /api/chat ┌───────────────────────┐   HTTP   ┌──────────────────────┐
│ chat UI, history │──────────▶│ adds your profile as  │────────▶│ Ollama (your PC)     │
│ in localStorage  │◀──────────│ the system prompt,    │◀────────│  or Claude (cloud)   │
└──────────────────┘  streamed │ streams the reply back│ streamed └──────────────────────┘
                      words    └───────────────────────┘
```

## Run it on your computer

You need **Node.js 20.12 or newer** ([nodejs.org](https://nodejs.org)) and **Ollama** ([ollama.com/download](https://ollama.com/download)).

```bash
# 1. Download a model (one time, about 2 GB)
ollama pull llama3.2

# 2. Install and start the app
cd personal-ai
npm install
cp .env.example .env      # optional: change settings here
npm start
```

Open **http://localhost:3000** and start chatting.

The terminal shows which AIs are ready:

```
  ✔ Local (Ollama)   llama3.2           Running locally
  ✘ Cloud (Claude)   claude-opus-5-5    Add ANTHROPIC_API_KEY to .env to enable
```

### Other models

Any Ollama model works. Download it, then pick it from the model menu in the app:

```bash
ollama pull qwen2.5:7b     # strong all-rounder (needs ~8 GB RAM)
ollama pull gemma3:4b      # small and fast
```

### Use Claude (cloud) too

Put your key from [console.anthropic.com](https://console.anthropic.com) in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Restart with `npm start`, then choose **Cloud (Claude)** in the app. To make it the default, set `AI_PROVIDER=claude`. Claude usage is billed by Anthropic. Ollama is free.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the app |
| `npm run dev` | Start and auto-restart when you edit backend files |
| `npm test` | Run the tests. They work offline, with no Ollama and no API key. |

## Project structure

```
personal-ai/
├── backend/
│   ├── src/
│   │   ├── server.js         starts the server
│   │   ├── app.js            the API routes
│   │   ├── config.js         settings from .env
│   │   ├── prompt.js         builds the "who you are" instructions for the AI
│   │   ├── profileStore.js   saves your profile
│   │   └── providers/        ollama.js, claude.js: how we talk to each AI
│   └── test/                 automated tests
├── frontend/                 index.html, styles.css, app.js: the chat UI
├── docs/HOW-AI-WORKS.md      how AI works, explained simply
├── AGENTS.md                 instructions for Codex and other coding agents
├── CLAUDE.md                 instructions for Claude Code (points to AGENTS.md)
└── .env.example              settings template
```

## Building on it with Codex or Claude Code

Open this folder in either tool and describe what you want, for example *"add a dark/light theme toggle"* or *"add Gemini as a provider"*. Both tools read `AGENTS.md` (Claude Code reaches it through `CLAUDE.md`), so they know the layout, the commands, and the rules. They also know to run `npm test` when they're done.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama isn't running" | Open the Ollama app, or run `ollama serve` in a terminal |
| "Model … isn't installed" | Run `ollama pull <model name>` |
| Replies are slow | Try a smaller model (`gemma3:4b`, `llama3.2:1b`) |
| Port 3000 is in use | Set `PORT=3001` in `.env` |
| "Invalid Claude API key" | Check `ANTHROPIC_API_KEY` in `.env`, then restart |

To learn how it all works, read [docs/HOW-AI-WORKS.md](docs/HOW-AI-WORKS.md).
