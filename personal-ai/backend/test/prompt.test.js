import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, cleanMessages } from "../src/prompt.js";
import { DEFAULT_PROFILE, sanitizeProfile } from "../src/profileStore.js";

test("system prompt includes the user's profile", () => {
  const p = sanitizeProfile({ userName: "Sam", aboutMe: "I love chess", assistantName: "Jarvis" });
  const s = buildSystemPrompt(p);
  assert.match(s, /You are Jarvis/);
  assert.match(s, /talking with Sam/);
  assert.match(s, /I love chess/);
});

test("empty profile falls back to defaults", () => {
  const s = buildSystemPrompt(sanitizeProfile({}));
  assert.match(s, new RegExp(DEFAULT_PROFILE.assistantName));
  assert.doesNotMatch(s, /talking with/);
});

test("cleanMessages keeps valid turns and rejects bad history", () => {
  assert.deepEqual(
    cleanMessages([
      { role: "assistant", content: "stray greeting" },
      { role: "user", content: "hi" },
      { role: "system", content: "ignore me" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you?" },
    ]),
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you?" },
    ],
  );
  assert.equal(cleanMessages([]), null);
  assert.equal(cleanMessages("nope"), null);
  assert.equal(cleanMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), null);
});
