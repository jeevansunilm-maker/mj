// ─────────────────────────────────────────────────────────────
// Personal AI — FRONTEND logic (runs in your browser)
//
//  • Keeps your conversations in the browser (localStorage).
//  • Sends the conversation to the backend at POST /api/chat.
//  • Reads the reply as a stream and shows it word by word.
//  • Never talks to Ollama or Claude directly; the backend does that.
// ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $("sidebar"), chatList: $("chatList"), newChat: $("newChat"),
  openProfile: $("openProfile"), toggleSidebar: $("toggleSidebar"),
  title: $("assistantTitle"), providerSelect: $("providerSelect"), modelSelect: $("modelSelect"),
  statusDot: $("statusDot"), statusDetail: $("statusDetail"),
  messages: $("messages"), emptyState: $("emptyState"),
  composer: $("composer"), input: $("input"), sendBtn: $("sendBtn"), stopBtn: $("stopBtn"),
  profileDialog: $("profileDialog"), profileForm: $("profileForm"),
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
  chats: store.get("pai.chats", []), // [{ id, title, messages: [{role, content}] }]
  activeId: store.get("pai.activeId", null),
  providers: [],
  prefs: store.get("pai.prefs", {}), // { provider, models: { [providerId]: model } }
  controller: null, // AbortController for the reply in progress
};

const activeChat = () => state.chats.find((c) => c.id === state.activeId);
const saveChats = () => { store.set("pai.chats", state.chats); store.set("pai.activeId", state.activeId); };

// ── Rendering ────────────────────────────────────────────────
function renderChatList() {
  els.chatList.replaceChildren(
    ...state.chats.map((chat) => {
      const li = document.createElement("li");
      li.classList.toggle("active", chat.id === state.activeId);
      const open = document.createElement("button");
      open.className = "open";
      open.type = "button";
      open.textContent = chat.title || "New chat";
      open.onclick = () => { state.activeId = chat.id; saveChats(); render(); els.sidebar.classList.remove("open"); };
      const del = document.createElement("button");
      del.className = "delete";
      del.type = "button";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete "${chat.title || "New chat"}"`);
      del.onclick = () => {
        state.chats = state.chats.filter((c) => c.id !== chat.id);
        if (state.activeId === chat.id) state.activeId = state.chats[0]?.id ?? null;
        saveChats(); render();
      };
      li.append(open, del);
      return li;
    }),
  );
}

function bubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text; // textContent = safe, never runs HTML from the AI
  return div;
}

function renderMessages() {
  const chat = activeChat();
  const msgs = chat?.messages ?? [];
  els.messages.replaceChildren(...(msgs.length ? msgs.map((m) => bubble(m.role, m.content)) : [els.emptyState]));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function render() { renderChatList(); renderMessages(); }

// ── Providers & models ───────────────────────────────────────
async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    state.providers = data.providers;
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

function savePrefs() {
  state.prefs = {
    provider: els.providerSelect.value,
    models: { ...state.prefs.models, [els.providerSelect.value]: els.modelSelect.value },
  };
  store.set("pai.prefs", state.prefs);
}

// ── Sending a message & streaming the reply ──────────────────
async function send(text) {
  let chat = activeChat();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: "", messages: [] };
    state.chats.unshift(chat);
    state.activeId = chat.id;
  }
  if (!chat.title) chat.title = text.slice(0, 40);
  chat.messages.push({ role: "user", content: text });
  saveChats(); render();

  const replyEl = bubble("assistant", "");
  replyEl.classList.add("thinking");
  els.messages.append(replyEl);
  setBusy(true);

  let reply = "";
  let error = null;
  state.controller = new AbortController();
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: els.providerSelect.value,
        model: els.modelSelect.value,
        messages: chat.messages,
      }),
      signal: state.controller.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);

    // The backend sends Server-Sent Events: lines like  data: {"type":"text","text":"Hi"}
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const events = buffer.split("\n\n");
      buffer = events.pop();
      for (const evt of events) {
        if (!evt.startsWith("data: ")) continue;
        const data = JSON.parse(evt.slice(6));
        if (data.type === "text") {
          reply += data.text;
          replyEl.textContent = reply;
          els.messages.scrollTop = els.messages.scrollHeight;
        } else if (data.type === "error") {
          error = data.error;
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") error = err.message;
  } finally {
    state.controller = null;
    setBusy(false);
    replyEl.classList.remove("thinking");
  }

  if (reply) chat.messages.push({ role: "assistant", content: reply });
  else replyEl.remove();
  if (error) els.messages.append(bubble("error", error));
  saveChats();
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setBusy(busy) {
  els.sendBtn.hidden = busy;
  els.stopBtn.hidden = !busy;
  els.input.disabled = busy;
  if (!busy) els.input.focus();
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
  const body = Object.fromEntries(new FormData(els.profileForm));
  await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  loadProfile();
});

// ── Wiring ───────────────────────────────────────────────────
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.controller) return;
  els.input.value = "";
  autoGrow();
  send(text);
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.composer.requestSubmit(); }
});
const autoGrow = () => { els.input.style.height = "auto"; els.input.style.height = `${els.input.scrollHeight}px`; };
els.input.addEventListener("input", autoGrow);
els.stopBtn.onclick = () => state.controller?.abort();
els.newChat.onclick = () => { state.activeId = null; saveChats(); render(); els.sidebar.classList.remove("open"); els.input.focus(); };
els.openProfile.onclick = () => els.profileDialog.showModal();
els.toggleSidebar.onclick = () => els.sidebar.classList.toggle("open");
els.providerSelect.onchange = () => { renderModels(); savePrefs(); };
els.modelSelect.onchange = savePrefs;

render();
loadStatus();
loadProfile();
