# How an AI like this works, explained simply

## 1. The model: a very good next-word predictor

At its core, the AI (a **large language model**, or LLM) does one thing: given some text, it predicts which piece of text comes next.

- Text is split into **tokens**: small pieces such as words or parts of words. `"Hello there!"` becomes roughly `Hello` · ` there` · `!`.
- The model reads all the tokens so far and gives a probability for every possible next token, for example *"the"* 12%, *"a"* 8%, and so on.
- It picks one, adds it to the text, and repeats. One token at a time, a whole answer gets written.

That's why replies appear word by word in the app. We **stream** each token to your screen as soon as the model produces it.

## 2. Where the "knowledge" comes from: training

Before you ever use it, the model was **trained**:

1. **Pre-training.** It read a huge amount of text (books, websites, code) and practised predicting the next token billions of times. Each mistake slightly adjusted its billions of internal numbers (its **weights** or **parameters**). Over time those numbers came to encode grammar, facts, reasoning patterns, and coding skills.
2. **Fine-tuning.** It was then trained further on example conversations and human feedback, so it acts as a helpful assistant rather than just continuing text.

The file you download with `ollama pull llama3.2` *is* those weights, about 2 GB of numbers. Running the model means doing a lot of multiplication with them. That's why a GPU or a fast computer helps.

The model does **not** learn from your chats. Its weights stay the same after training. It only "knows" what is in its weights plus whatever text you send it right now.

## 3. Memory: the context window

The model has no memory between requests. Every time you send a message, the app sends **the whole conversation so far**:

```
system:    You are Nova, a personal assistant. You're talking with Sam. Sam is vegetarian.
user:      Give me dinner ideas
assistant: 1. Chickpea curry ...
user:      Make the second one spicier        ← your new message
```

The amount of text the model can read at once is its **context window**. Llama 3.2 fits about 128,000 tokens. Claude fits about 1,000,000. Long chats use more of it and get slower.

## 4. What makes it "personal": the system prompt

The first message, the **system prompt**, is hidden instructions that the backend writes from your profile (`backend/src/prompt.js`). This is how it knows your name, remembers facts about you, and takes on the personality you chose. Change your profile and every future answer changes, without any retraining.

## 5. How this app is wired

```
You type ──▶ frontend/app.js ──POST /api/chat──▶ backend/src/app.js
                                                  │ adds the system prompt from your profile
                                                  ▼
                                   providers/ollama.js  or  providers/claude.js
                                                  │ sends the conversation, gets tokens back
             screen ◀── streamed words (SSE) ◀───┘
```

- **Frontend** (runs in your browser): shows the chat, keeps your chat history, and sends requests.
- **Backend** (runs in Node.js): holds settings and secrets (API keys), builds the prompt, talks to the model, and streams the answer back. API keys must live here and never in the browser, or anyone could copy them.
- **Provider**: the actual model. **Ollama** runs open models on your computer. **Claude** runs on Anthropic's servers and is smarter, but needs internet and a paid key.

## 6. Local vs cloud models

| | Local (Ollama) | Cloud (Claude) |
|---|---|---|
| Cost | Free | Pay per token |
| Privacy | Nothing leaves your PC | Text is sent to Anthropic |
| Internet | Not needed after download | Required |
| Quality | Good, depends on your hardware | State of the art |
| Speed | Depends on your CPU/GPU | Fast |

## 7. Limits to keep in mind

- **It can be confidently wrong** (people call this "hallucination"). It predicts plausible text, which isn't always true text. Check anything important.
- **Knowledge cutoff.** It only knows what was in its training data, unless you give it more (by pasting text, or later through tools like web search).
- **It only acts through tools.** The model itself can only write text. See the next section.

## 8. How the AI "does things": tools

When you say *"set the volume to 30"*:

1. The backend sends your message **plus a list of tools**. Each tool has a name, a description and the inputs it takes, for example `volume(action, level)`.
2. The model doesn't change anything itself. It replies with a request: *"call `volume` with `{action: "set", level: 30}`"*.
3. The backend **checks** the request (is 30 between 0 and 100?) and runs it. On Windows it uses PowerShell.
4. The result (`{volume: 30}`) goes back to the model, which writes the final answer: *"Done, volume is 30%."*

This loop can repeat several times for one message, for example "check the volume, then lower it by 10". It's also why you stay in control:

- The AI can only use the tools we gave it, and only with checked inputs.
- Apps come from an allow-list, so it can't run arbitrary programs.
- Risky actions (shut down, restart, sleep) only *ask*. You click **Confirm**.
- Every action shows a card in the chat, so you can see what actually happened.

Bigger local models (like `qwen2.5:7b`) and cloud models (Claude) are much better at choosing the right tool than tiny ones.
