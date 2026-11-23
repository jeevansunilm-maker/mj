// Picks the computer-control module for this operating system.
// Only Windows is implemented. On other systems, the PC-control tools are hidden.
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_WINDOWS_APPS, createWindowsSystem } from "./windows.js";

export function createSystem(platform = process.platform) {
  if (platform === "win32") return createWindowsSystem();
  return { supported: false, os: platform, notify: async () => {} };
}

/**
 * The apps the AI may open: the defaults plus anything in data/apps.json, e.g.
 *   { "vs code": "C:\\Users\\you\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" }
 * Set a name to null in apps.json to remove a default.
 */
export async function loadApps(dataDir, defaults = DEFAULT_WINDOWS_APPS) {
  let custom = {};
  try {
    custom = JSON.parse(await fs.readFile(path.join(dataDir, "apps.json"), "utf8"));
  } catch { /* no custom apps */ }
  const apps = { ...defaults };
  for (const [name, target] of Object.entries(custom)) {
    const key = name.toLowerCase().trim();
    if (target === null) delete apps[key];
    else if (typeof target === "string" && target.trim()) apps[key] = target.trim();
  }
  return apps;
}
