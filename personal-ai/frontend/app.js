// ─────────────────────────────────────────────────────────────
// Personal AI — FRONTEND logic (runs in your browser)
//
//  • Keeps your conversations in the browser (localStorage).
//  • Sends the conversation to the backend at POST /api/chat and shows the
//    streamed reply, including "action cards" when the AI uses a tool.
//  • Listens on /api/events for reminders that fire.
//  • Voice typing (🎤) with optional AI clean-up (✨), like Wispr Flow.
//  • Never talks to Ollama or Claude directly; the backend does that.
// ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $("sidebar"), chatList: $("chatList"), newChat: $("newChat"),
  openProfile: $("openProfile"), openReminders: $("openReminders"), reminderCount: $("reminderCount"),
  toggleSidebar: $("toggleSidebar"), title: $("assistantTitle"),
  providerSelect: $("providerSelect"), modelSelect: $("modelSelect"),
  statusDot: $("statusDot"), statusDetail: $("statusDetail"),
  messages: $("messages"), emptyState: $("emptyState"),
  composer: $("composer"), input: $("input"), sendBtn: $("sendBtn"), stopBtn: $("stopBtn"),
  micBtn: $("micBtn"), polishBtn: $("polishBtn"), talkBtn: $("talkBtn"),
  voiceSelect: $("voiceSelect"), rateInput: $("rateInput"), testVoice: $("testVoice"),
  profileDialog: $("profileDialog"), profileForm: $("profileForm"),
  remindersDialog: $("remindersDialog"), reminderList: $("reminderList"), reminderForm: $("reminderForm"),
  enableNotifications: $("enableNotifications"), closeReminders: $("closeReminders"), notifyHint: $("notifyHint"),
  toasts: $("toasts"),
};

// ── Local storage helpers (wrapped: storage can be blocked in private mode) ──
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const state = {
  // [{ id, title, messages: [{role:"user", content} | {role:"assistant", parts:[...]}] }]
  chats: store.get("pai.chats", []),
  activeId: store.get("pai.activeId", null),
  providers: [],
  prefs: store.get("pai.prefs", {}), // { provider, models: { [providerId]: model }, polish }
  controller: null, // AbortController for the reply in progress
};

const activeChat = () => state.chats.find((c) => c.id === state.activeId);
const saveChats = () => { store.set("pai.chats", state.chats); store.set("pai.activeId", state.activeId); };
const fmtTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const api = (path, body, method = "POST") =>
  fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });

// Older saved chats stored the assistant reply as plain `content`.
const partsOf = (m) => m.parts ?? [{ type: "text", text: m.content ?? "" }];

/** What the AI sees as history: text, plus short notes about actions it took. */
function historyForModel(messages) {
  return messages
    .map((m) => m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: partsOf(m).map((p) => (p.type === "text" ? p.text : `\n${p.note ?? ""}\n`)).join("").trim() })
    .filter((m) => m.content);
}

// ── Small DOM helper ─────────────────────────────────────────
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c)); // text is always escaped
  return el;
}

// ── Rendering ────────────────────────────────────────────────
function renderChatList() {
  els.chatList.replaceChildren(
    ...state.chats.map((chat) =>
      h("li", { class: chat.id === state.activeId ? "active" : "" },
        h("button", {
          class: "open", type: "button",
          onclick: () => { state.activeId = chat.id; saveChats(); render(); els.sidebar.classList.remove("open"); },
        }, chat.title || "New chat"),
        h("button", {
          class: "delete", type: "button", "aria-label": `Delete "${chat.title || "New chat"}"`,
          onclick: () => {
            state.chats = state.chats.filter((c) => c.id !== chat.id);
            if (state.activeId === chat.id) state.activeId = state.chats[0]?.id ?? null;
            saveChats(); render();
          },
        }, "×"),
      ),
    ),
  );
}

/** A small read-only table preview of spreadsheet rows. */
function previewTable(rows) {
  if (!rows?.length) return null;
  return h("div", { class: "table-wrap" },
    h("table", {}, h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
}
const sheetLink = (url) => url && h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" }, "Open sheet");

/** A card for an action the AI took (reminder, email draft, confirmation...). */
function actionCard(part) {
  const d = part.display ?? { kind: part.isError ? "error" : "info", text: part.note };
  switch (d.kind) {
    case "reminder":
      return h("div", { class: "card" }, "⏰ Reminder set: ", h("strong", {}, d.text), ` · ${fmtTime(d.dueAt)}`);
    case "email": {
      const mailto = `mailto:${encodeURIComponent(d.to || "").replace(/%2C/gi, ",")}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
      const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(d.to || "")}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
      const copyBtn = h("button", { class: "btn", type: "button" }, "Copy");
      copyBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`); copyBtn.textContent = "Copied ✓"; }
        catch { copyBtn.textContent = "Copy failed"; }
      };
      return h("div", { class: "card" },
        h("div", {}, "✉️ ", h("strong", {}, "Email draft")),
        d.to ? h("div", { class: "field" }, `To: ${d.to}`) : null,
        h("div", { class: "field" }, `Subject: ${d.subject}`),
        h("pre", {}, d.body),
        h("div", { class: "row" },
          h("a", { class: "btn primary", href: mailto }, "Open in email app"),
          h("a", { class: "btn", href: gmail, target: "_blank", rel: "noopener" }, "Open in Gmail"),
          copyBtn,
        ),
      );
    }
    case "sheet":
      return h("div", { class: "card" },
        h("div", {}, `${d.icon ?? "📊"} ${d.text}`),
        previewTable(d.rows),
        d.url ? h("div", { class: "row" }, sheetLink(d.url)) : null,
      );
    case "confirm": {
      const card = h("div", { class: "card" }, h("div", {}, "⚠️ ", h("strong", {}, d.text), "?"), previewTable(d.rows));
      if (d.resolved) { card.append(h("div", { class: "resolved" }, d.resolved)); return card; }
      const resolve = async (choice) => {
        let text;
        try {
          const res = await api(`/api/actions/${d.id}/${choice}`);
          const body = await res.json();
          text = res.ok ? (choice === "confirm" ? "✓ Done" : "Cancelled") : `✗ ${body.error}`;
        } catch { text = "✗ Couldn't reach the app"; }
        d.resolved = text; // remember the outcome in the saved chat
        saveChats();
        row.replaceWith(h("div", { class: "resolved" }, text));
      };
      const row = h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", onclick: () => resolve("confirm") }, "Confirm"),
        h("button", { class: "btn", type: "button", onclick: () => resolve("cancel") }, "Cancel"),
        sheetLink(d.url),
      );
      card.append(row);
      return card;
    }
    case "error":
      return h("div", { class: "card error" }, `⚠️ ${d.text}`);
    default:
      return h("div", { class: "card" }, `${d.icon ?? "✓"} ${d.text}`);
  }
}

function assistantBubble(parts) {
  const el = h("div", { class: "msg assistant" });
  for (const p of parts) el.append(p.type === "text" ? h("div", { class: "part-text" }, p.text) : actionCard(p));
  return el;
}

function renderMessages() {
  const msgs = activeChat()?.messages ?? [];
  els.messages.replaceChildren(
    ...(msgs.length
      ? msgs.map((m) => (m.role === "user" ? h("div", { class: "msg user" }, m.content) : assistantBubble(partsOf(m))))
      : [els.emptyState]),
  );
  scrollDown();
}
const scrollDown = () => { els.messages.scrollTop = els.messages.scrollHeight; };
function render() { renderChatList(); renderMessages(); }

// ── Providers & models ───────────────────────────────────────
async function loadStatus() {
  try {
    const data = await (await fetch("/api/status")).json();
    state.providers = data.providers;
    renderConnections(data.integrations);
    const preferred = state.prefs.provider ?? data.defaultProvider;
    els.providerSelect.replaceChildren(
      ...data.providers.map((p) => new Option(`${p.label}${p.available ? "" : " — off"}`, p.id)),
    );
    els.providerSelect.value = data.providers.some((p) => p.id === preferred) ? preferred : data.defaultProvider;
    renderModels();
  } catch {
    showStatus(false, "Can't reach the backend. Is `npm start` running?");
  }
}

function currentProvider() { return state.providers.find((p) => p.id === els.providerSelect.value); }

function renderModels() {
  const p = currentProvider();
  if (!p) return;
  const models = p.models.length ? p.models : [p.model];
  const saved = state.prefs.models?.[p.id];
  els.modelSelect.replaceChildren(...models.map((m) => new Option(m, m)));
  els.modelSelect.value = models.includes(saved) ? saved
    : models.find((m) => m === p.model || m === `${p.model}:latest`) ?? models[0];
  els.modelSelect.disabled = models.length < 2;
  showStatus(p.available, p.detail);
}

function showStatus(ok, text) {
  els.statusDot.className = `dot ${ok ? "ok" : "bad"}`;
  els.statusDot.title = text;
  els.statusDetail.textContent = text;
}

function savePrefs(extra = {}) {
  state.prefs = {
    ...state.prefs,
    provider: els.providerSelect.value,
    models: { ...state.prefs.models, [els.providerSelect.value]: els.modelSelect.value },
    ...extra,
  };
  store.set("pai.prefs", state.prefs);
}

// ── Reading a Server-Sent Events stream ──────────────────────
async function* readEvents(res) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop();
    for (const c of chunks) if (c.startsWith("data: ")) yield JSON.parse(c.slice(6));
  }
}

// ── Sending a message & streaming the reply ──────────────────
/** hooks.onText(delta) is called as reply text streams in (used to speak it). */
async function send(text, hooks = {}) {
  let chat = activeChat();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: "", messages: [] };
    state.chats.unshift(chat);
    state.activeId = chat.id;
  }
  if (!chat.title) chat.title = text.slice(0, 40);
  chat.messages.push({ role: "user", content: text });
  saveChats(); render();

  const parts = [];
  const bubble = h("div", { class: "msg assistant thinking" });
  els.messages.append(bubble);
  let textEl = null; // the text block currently being typed into
  setBusy(true);

  let error = null;
  state.controller = new AbortController();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: els.providerSelect.value,
        model: els.modelSelect.value,
        messages: historyForModel(chat.messages),
      }),
      signal: state.controller.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);

    for await (const ev of readEvents(res)) {
      if (ev.type === "text") {
        let last = parts.at(-1);
        if (last?.type !== "text") {
          last = { type: "text", text: "" };
          parts.push(last);
          textEl = h("div", { class: "part-text" });
          bubble.append(textEl);
        }
        last.text += ev.text;
        textEl.textContent = last.text; // textContent: AI output is never run as HTML
        hooks.onText?.(ev.text);
      } else if (ev.type === "tool") {
        const part = { type: "tool", name: ev.name, isError: ev.isError, display: ev.display, note: ev.note };
        parts.push(part);
        bubble.append(actionCard(part));
        if (ev.name === "create_reminder" || ev.name === "cancel_reminder") loadReminders();
      } else if (ev.type === "error") {
        error = ev.error;
      }
      scrollDown();
    }
  } catch (err) {
    if (err.name !== "AbortError") error = err.message;
  } finally {
    state.controller = null;
    setBusy(false);
    bubble.classList.remove("thinking");
  }

  for (const p of parts) if (p.type === "text") p.text = p.text.trim();
  const kept = parts.filter((p) => p.type !== "text" || p.text);
  if (kept.length) chat.messages.push({ role: "assistant", parts: kept });
  else bubble.remove();
  if (error) els.messages.append(h("div", { class: "msg error" }, error));
  saveChats();
  scrollDown();
}

function setBusy(busy) {
  els.sendBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.input.disabled = busy;
  if (!busy) els.input.focus();
}

// ── Connections (Google Sheets) ──────────────────────────────
function renderConnections(integrations = {}) {
  const g = integrations.googleSheets ?? {};
  const box = $("connections");
  if (!g.connected) {
    box.replaceChildren(
      h("strong", {}, "Google Sheets: "),
      g.problem ? `⚠️ ${g.problem}` : "not set up. See README → Google Sheets.",
    );
    return;
  }
  const copy = h("button", { class: "btn icon-btn", type: "button" }, "Copy");
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(g.email); copy.textContent = "Copied ✓"; } catch { copy.textContent = "Copy failed"; }
  };
  box.replaceChildren(
    h("strong", {}, "Google Sheets: connected ✓"),
    h("div", {}, "To let your AI use a sheet, click Share in Google Sheets and add this email as an Editor:"),
    h("div", { class: "row" }, h("code", {}, g.email), copy),
  );
}

// ── Profile ──────────────────────────────────────────────────
async function loadProfile() {
  try {
    const p = await (await fetch("/api/profile")).json();
    for (const [k, v] of Object.entries(p)) if (els.profileForm.elements[k]) els.profileForm.elements[k].value = v;
    els.title.textContent = p.assistantName;
    document.title = `${p.assistantName} · Personal AI`;
  } catch { /* backend down: loadStatus already shows it */ }
}

els.profileDialog.addEventListener("close", async () => {
  if (els.profileDialog.returnValue !== "save") return loadProfile(); // discard edits
  await api("/api/profile", Object.fromEntries(new FormData(els.profileForm)), "PUT");
  loadProfile();
});

// ── Reminders ────────────────────────────────────────────────
async function loadReminders() {
  let list = [];
  try { list = await (await fetch("/api/reminders")).json(); } catch { return; }
  els.reminderCount.hidden = list.length === 0;
  els.reminderCount.textContent = list.length;
  els.reminderList.replaceChildren(
    ...(list.length ? list.map((r) =>
      h("li", { class: r.status },
        h("span", { class: "txt" }, r.text),
        h("span", { class: "when" }, fmtTime(r.dueAt)),
        h("button", {
          class: "btn icon-btn", type: "button", "aria-label": `Delete reminder ${r.text}`,
          onclick: async () => { await fetch(`/api/reminders/${r.id}`, { method: "DELETE" }); loadReminders(); },
        }, "×"),
      )) : [h("li", { class: "hint" }, "No reminders yet. Add one below, or ask your AI.")]),
  );
}

els.reminderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(els.reminderForm);
  const res = await api("/api/reminders", { text: f.get("text"), dueAt: new Date(f.get("dueAt")).toISOString() });
  if (!res.ok) { els.notifyHint.textContent = (await res.json()).error; return; }
  els.reminderForm.reset();
  els.notifyHint.textContent = "Reminder added.";
  loadReminders();
});

function updateNotifyHint() {
  const supported = "Notification" in window;
  els.enableNotifications.hidden = !supported || Notification.permission !== "default";
  els.notifyHint.textContent = !supported ? ""
    : Notification.permission === "granted" ? "Desktop pop-ups are on."
    : Notification.permission === "denied" ? "Desktop pop-ups are blocked in your browser settings. Reminders still show in the app and as Windows notifications."
    : "";
}
els.enableNotifications.onclick = async () => { await Notification.requestPermission(); updateNotifyHint(); };
els.openReminders.onclick = () => { loadReminders(); updateNotifyHint(); els.remindersDialog.showModal(); };
els.closeReminders.onclick = () => els.remindersDialog.close();

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch { /* audio blocked until the user interacts with the page */ }
}

const shownToasts = new Set();
function showReminder(r) {
  if (shownToasts.has(r.id)) return;
  shownToasts.add(r.id);
  beep();
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification("Reminder", { body: r.text, tag: r.id });
  }
  const toast = h("div", { class: "toast", role: "alert" },
    h("span", {}, "⏰ ", h("strong", {}, r.text)),
    h("button", {
      class: "btn primary", type: "button",
      onclick: async () => { await api(`/api/reminders/${r.id}/dismiss`); toast.remove(); loadReminders(); },
    }, "Done"),
  );
  els.toasts.append(toast);
  loadReminders();
}

function listenForEvents() {
  const es = new EventSource("/api/events"); // reconnects automatically
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "reminder") showReminder(ev.reminder);
  };
}

// ── Voice typing (like Wispr Flow) ───────────────────────────
// Uses the browser's built-in speech recognition (Chrome / Edge). Then, if ✨
// is on, the AI cleans up the text: removes "um"s and fixes punctuation.
// Tip: on Windows, Win+H gives you voice typing in *any* app.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = { rec: null, before: "", finalText: "" };

function setPolish(on) {
  els.polishBtn.setAttribute("aria-pressed", String(on));
  savePrefs({ polish: on });
}
els.polishBtn.onclick = () => setPolish(els.polishBtn.getAttribute("aria-pressed") !== "true");

function startDictation() {
  if (!Recognition) {
    showStatus(false, "Voice typing needs Chrome or Edge. On Windows you can also press Win+H in any app.");
    return;
  }
  const rec = new Recognition();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  voice.rec = rec;
  voice.before = els.input.value ? els.input.value.replace(/\s*$/, " ") : "";
  voice.finalText = "";

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) voice.finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    els.input.value = voice.before + voice.finalText + interim;
    autoGrow();
  };
  rec.onerror = (e) => {
    const msg = e.error === "not-allowed" ? "Microphone blocked. Allow it in the browser's address bar." : `Voice typing error: ${e.error}`;
    showStatus(false, msg);
  };
  rec.onend = async () => {
    els.micBtn.classList.remove("listening");
    voice.rec = null;
    const spoken = voice.finalText.trim();
    if (!spoken || els.polishBtn.getAttribute("aria-pressed") !== "true") return;
    els.statusDetail.textContent = "✨ Polishing…";
    try {
      const res = await api("/api/polish", { text: spoken, provider: els.providerSelect.value, model: els.modelSelect.value });
      const body = await res.json();
      if (res.ok) els.input.value = voice.before + body.text;
      renderModels(); // restore the status line
    } catch {
      renderModels();
    }
    autoGrow();
    els.input.focus();
  };
  rec.start();
  els.micBtn.classList.add("listening");
}
const toggleDictation = () => (voice.rec ? voice.rec.stop() : startDictation());
els.micBtn.onclick = toggleDictation;
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "Space") { e.preventDefault(); toggleDictation(); }
});

// ── Speaking replies aloud ───────────────────────────────────
// Uses the voices installed in Windows / your browser (speechSynthesis).
// Text is spoken sentence by sentence as it streams in, so it starts quickly.
const speaker = {
  buffer: "",
  queued: 0,
  idleWaiters: [],
  voice() {
    const name = state.prefs.voice;
    return speechSynthesis.getVoices().find((v) => v.name === name) ?? null;
  },
  say(text) {
    const clean = text.replace(/[*_#`>]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(clean);
    const v = this.voice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number(state.prefs.rate ?? 1);
    this.queued++;
    u.onend = u.onerror = () => {
      this.queued = Math.max(0, this.queued - 1);
      if (!this.queued) this.idleWaiters.splice(0).forEach((fn) => fn());
    };
    speechSynthesis.speak(u);
  },
  feed(delta) {
    this.buffer += delta;
    // Speak every complete sentence; keep the unfinished tail for later.
    const re = /[^.!?\n]+[.!?]+["')\]]*\s|[^\n]+\n/g;
    let m, end = 0;
    while ((m = re.exec(this.buffer))) { this.say(m[0]); end = re.lastIndex; }
    this.buffer = this.buffer.slice(end);
  },
  flush() { this.say(this.buffer); this.buffer = ""; },
  cancel() {
    this.buffer = "";
    this.queued = 0;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.idleWaiters.splice(0).forEach((fn) => fn());
  },
  whenIdle() {
    return this.queued ? new Promise((r) => this.idleWaiters.push(r)) : Promise.resolve();
  },
};

function loadVoices() {
  if (!("speechSynthesis" in window)) { els.voiceSelect.disabled = true; return; }
  const voices = speechSynthesis.getVoices();
  els.voiceSelect.replaceChildren(
    new Option("Default voice", ""),
    ...voices.map((v) => new Option(`${v.name} (${v.lang})${v.localService ? "" : " · online"}`, v.name)),
  );
  els.voiceSelect.value = state.prefs.voice ?? "";
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = loadVoices;
els.voiceSelect.onchange = () => savePrefs({ voice: els.voiceSelect.value });
els.rateInput.oninput = () => savePrefs({ rate: Number(els.rateInput.value) });
els.testVoice.onclick = () => { speaker.cancel(); speaker.say(`Hi! I'm ${els.title.textContent}. This is how I sound.`); };

// ── Hands-free conversation ──────────────────────────────────
// Listen → send when you pause → speak the reply → listen again.
// Say "stop listening" or "goodbye", press the 🗣️ button, or Ctrl+Shift+H to stop.
const handsFree = { on: false, rec: null };
const STOP_WORDS = /^(stop listening|stop talking|goodbye|bye|exit|that's all)[.!]?$/i;
const PAUSE_MS = 1300; // how long a pause means "I'm done talking"

function setHandsFreeUi(mode) {
  els.talkBtn.classList.toggle("listening", mode === "listening");
  els.talkBtn.setAttribute("aria-pressed", String(handsFree.on));
  const label = { listening: "🎙️ Listening… (say “stop listening” to end)", thinking: "💭 Thinking…", speaking: "🔊 Speaking… (press 🗣️ to stop)" }[mode];
  if (label) els.statusDetail.textContent = label;
  else renderModels();
}

function listenOnce() {
  return new Promise((resolve) => {
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    handsFree.rec = rec;
    let finalText = "";
    let timer = null;
    const finish = () => { clearTimeout(timer); try { rec.stop(); } catch { /* already stopped */ } };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      els.input.value = (finalText + interim).trim();
      autoGrow();
      clearTimeout(timer);
      timer = setTimeout(finish, PAUSE_MS); // restart the pause timer on every word
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // silence: just listen again
      stopHandsFree();
      showStatus(false, e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone blocked. Allow it in the browser's address bar."
        : e.error === "network" ? "Voice needs internet (the browser's speech service is online)."
        : `Voice error: ${e.error}`);
    };
    rec.onend = () => { handsFree.rec = null; resolve(finalText.trim()); };
    rec.start();
  });
}

async function handsFreeLoop() {
  while (handsFree.on) {
    setHandsFreeUi("listening");
    const heard = await listenOnce();
    if (!handsFree.on) break;
    if (!heard) continue; // silence: just listen again
    if (STOP_WORDS.test(heard)) { els.input.value = ""; autoGrow(); stopHandsFree(); speaker.say("Okay, talk later."); break; }
    els.input.value = "";
    autoGrow();
    setHandsFreeUi("thinking");
    let spoke = false;
    await send(heard, { onText: (t) => { if (!spoke) { spoke = true; setHandsFreeUi("speaking"); } speaker.feed(t); } });
    speaker.flush();
    if (!handsFree.on) break;
    setHandsFreeUi("speaking");
    await speaker.whenIdle();
  }
  setHandsFreeUi(null);
}

function startHandsFree() {
  if (!Recognition) {
    showStatus(false, "Hands-free mode needs Chrome or Edge (speech recognition).");
    return;
  }
  voice.rec?.abort();
  handsFree.on = true;
  handsFreeLoop();
}
function stopHandsFree() {
  handsFree.on = false;
  handsFree.rec?.abort();
  speaker.cancel();
  state.controller?.abort();
  setHandsFreeUi(null);
}
els.talkBtn.onclick = () => (handsFree.on ? stopHandsFree() : startHandsFree());
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "KeyH") { e.preventDefault(); els.talkBtn.click(); }
});

// ── Wiring ───────────────────────────────────────────────────
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.controller) return;
  voice.rec?.abort();
  els.input.value = "";
  autoGrow();
  send(text);
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.composer.requestSubmit(); }
});
function autoGrow() { els.input.style.height = "auto"; els.input.style.height = `${els.input.scrollHeight}px`; }
els.input.addEventListener("input", autoGrow);
els.stopBtn.onclick = () => state.controller?.abort();
els.newChat.onclick = () => { state.activeId = null; saveChats(); render(); els.sidebar.classList.remove("open"); els.input.focus(); };
els.openProfile.onclick = () => els.profileDialog.showModal();
els.toggleSidebar.onclick = () => els.sidebar.classList.toggle("open");
els.providerSelect.onchange = () => { renderModels(); savePrefs(); };
els.modelSelect.onchange = () => savePrefs();

els.polishBtn.setAttribute("aria-pressed", String(state.prefs.polish ?? true));
els.rateInput.value = String(state.prefs.rate ?? 1);
loadVoices();
if (!Recognition) els.micBtn.title = "Voice typing needs Chrome or Edge (or press Win+H)";
render();
loadStatus();
loadProfile();
loadReminders();
listenForEvents();
