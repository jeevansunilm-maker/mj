// Reminders saved in data/reminders.json, plus a scheduler that checks every
// few seconds and fires the ones that are due.
//
// Life of a reminder:  pending ──(due time)──▶ fired ──(user clicks Done)──▶ dismissed
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function createReminderStore(dataDir) {
  const file = path.join(dataDir, "reminders.json");
  let cache = null;
  let writing = Promise.resolve();

  async function load() {
    if (!cache) {
      try { cache = JSON.parse(await fs.readFile(file, "utf8")); } catch { cache = []; }
    }
    return cache;
  }
  function persist() {
    // Serialise writes so two quick changes can't corrupt the file.
    writing = writing.then(async () => {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(cache, null, 2));
    });
    return writing;
  }

  return {
    async list({ includeDismissed = false } = {}) {
      const all = await load();
      return all
        .filter((r) => includeDismissed || r.status !== "dismissed")
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    },
    async add({ text, dueAt }) {
      const reminder = { id: randomUUID().slice(0, 8), text, dueAt, status: "pending", createdAt: new Date().toISOString() };
      (await load()).push(reminder);
      await persist();
      return reminder;
    },
    async remove(id) {
      const all = await load();
      const i = all.findIndex((r) => r.id === id);
      if (i === -1) return null;
      const [removed] = all.splice(i, 1);
      await persist();
      return removed;
    },
    async setStatus(id, status) {
      const r = (await load()).find((x) => x.id === id);
      if (!r) return null;
      r.status = status;
      await persist();
      return r;
    },
    /** Marks every pending reminder that is due as "fired" and returns them. */
    async takeDue(now = new Date()) {
      const due = (await load()).filter((r) => r.status === "pending" && new Date(r.dueAt) <= now);
      if (!due.length) return [];
      for (const r of due) r.status = "fired";
      await persist();
      return due;
    },
  };
}

/** Parses a date/time from the AI or the form; returns an ISO string or throws. */
export function parseDueAt(value, now = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`"${value}" is not a valid date/time. Use ISO format like 2026-11-23T18:30:00`);
  if (d.getTime() < now.getTime() - 60_000) throw new Error("That time is in the past.");
  return d.toISOString();
}

export function startReminderScheduler({ store, events, notify, intervalMs = 5000, now = () => new Date() }) {
  async function tick() {
    try {
      for (const r of await store.takeDue(now())) {
        events.publish({ type: "reminder", reminder: r });
        notify?.("Reminder", r.text).catch((err) => console.error("[notify]", err.message));
      }
    } catch (err) {
      console.error("[reminders]", err);
    }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
