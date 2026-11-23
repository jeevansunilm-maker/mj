import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventHub } from "../src/events.js";
import { createReminderStore, parseDueAt, startReminderScheduler } from "../src/reminders.js";
import { createPendingActions } from "../src/pendingActions.js";
import { tempDir } from "./helpers.js";

test("parseDueAt accepts future times and rejects past/garbage", () => {
  const now = new Date("2026-11-23T10:00:00Z");
  assert.equal(parseDueAt("2026-11-23T12:00:00Z", now), "2026-11-23T12:00:00.000Z");
  assert.throws(() => parseDueAt("yesterday", now), /not a valid/);
  assert.throws(() => parseDueAt("2026-11-22T10:00:00Z", now), /past/);
});

test("scheduler fires due reminders once, publishes and notifies", async () => {
  const store = createReminderStore(await tempDir());
  const events = createEventHub();
  const got = [];
  const notified = [];
  events.subscribe((e) => got.push(e));
  await store.add({ text: "Stretch", dueAt: "2026-11-23T10:00:00.000Z" });
  await store.add({ text: "Later", dueAt: "2026-11-23T11:00:00.000Z" });

  let clock = new Date("2026-11-23T10:00:30Z");
  const s = startReminderScheduler({
    store, events, intervalMs: 1e9, now: () => clock,
    notify: async (t, b) => notified.push([t, b]),
  });
  await s.tick();
  await s.tick(); // must not fire twice
  s.stop();

  assert.equal(got.length, 1);
  assert.equal(got[0].reminder.text, "Stretch");
  assert.deepEqual(notified, [["Reminder", "Stretch"]]);
  const list = await store.list();
  assert.deepEqual(list.map((r) => r.status), ["fired", "pending"]);
});

test("reminders persist to disk", async () => {
  const dir = await tempDir();
  await createReminderStore(dir).add({ text: "Persist me", dueAt: "2030-01-01T00:00:00.000Z" });
  const again = await createReminderStore(dir).list();
  assert.equal(again[0].text, "Persist me");
});

test("pending actions need confirmation and expire", async () => {
  let t = 0;
  const pa = createPendingActions({ ttlMs: 1000, now: () => t });
  let ran = 0;
  const id = pa.create("Shut down", async () => { ran++; });
  assert.equal(await pa.confirm(id), "Shut down");
  assert.equal(ran, 1);
  await assert.rejects(pa.confirm(id), /not found/); // can't confirm twice

  const id2 = pa.create("Restart", async () => { ran++; });
  t = 5000;
  await assert.rejects(pa.confirm(id2), /expired/);
  assert.equal(ran, 1);
});
