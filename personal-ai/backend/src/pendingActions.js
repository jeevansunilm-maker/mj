// Risky actions (shut down, restart, sleep) are never run directly by the AI.
// The AI only *requests* them; the user must click Confirm in the app within
// 2 minutes, which calls POST /api/actions/:id/confirm.
import { randomUUID } from "node:crypto";

export function createPendingActions({ ttlMs = 120_000, now = () => Date.now() } = {}) {
  const pending = new Map();
  return {
    create(label, run) {
      const id = randomUUID();
      pending.set(id, { label, run, expires: now() + ttlMs });
      return id;
    },
    async confirm(id) {
      const a = pending.get(id);
      pending.delete(id);
      if (!a) throw new Error("This request was not found or was already handled.");
      if (now() > a.expires) throw new Error("This request expired. Ask again.");
      await a.run();
      return a.label;
    },
    cancel(id) {
      return pending.delete(id);
    },
  };
}
