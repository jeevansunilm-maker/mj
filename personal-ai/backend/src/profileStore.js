// Stores "who you are" and "who the assistant is" in data/profile.json.
// This is the "personal" part of the personal AI.
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROFILE = Object.freeze({
  userName: "",
  aboutMe: "",
  assistantName: "Nova",
  personality: "Friendly, concise and practical. Explains things simply.",
});

const LIMITS = { userName: 100, aboutMe: 5000, assistantName: 50, personality: 1000 };

export function sanitizeProfile(input = {}) {
  const out = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const v = typeof input[key] === "string" ? input[key].trim().slice(0, max) : "";
    out[key] = v || (key === "assistantName" || key === "personality" ? DEFAULT_PROFILE[key] : "");
  }
  return out;
}

export function createProfileStore(dataDir) {
  const file = path.join(dataDir, "profile.json");
  return {
    async get() {
      try {
        return sanitizeProfile({ ...DEFAULT_PROFILE, ...JSON.parse(await fs.readFile(file, "utf8")) });
      } catch {
        return { ...DEFAULT_PROFILE };
      }
    },
    async save(input) {
      const profile = sanitizeProfile(input);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(profile, null, 2));
      return profile;
    },
  };
}
