// Entry point: `npm start` runs this file.
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createEventHub } from "./events.js";
import { createPendingActions } from "./pendingActions.js";
import { createProfileStore } from "./profileStore.js";
import { createProviders } from "./providers/index.js";
import { createReminderStore, startReminderScheduler } from "./reminders.js";
import { createSystem, loadApps } from "./system/index.js";
import { createTools } from "./tools/index.js";

const config = loadConfig();
const providers = createProviders(config);
const events = createEventHub();
const reminders = createReminderStore(config.dataDir);
const pendingActions = createPendingActions();
const system = createSystem();
const apps = system.supported ? await loadApps(config.dataDir) : {};
const tools = createTools({ reminders, system, apps, pendingActions });

startReminderScheduler({ store: reminders, events, notify: (t, b) => system.notify(t, b) });

const app = createApp({
  config,
  providers,
  profileStore: createProfileStore(config.dataDir),
  tools,
  reminders,
  events,
  pendingActions,
});

app.listen(config.port, config.host, async () => {
  console.log(`\n  Personal AI is running →  http://localhost:${config.port}\n`);
  for (const p of providers.values()) {
    const s = await p.status();
    console.log(`  ${s.available ? "✔" : "✘"} ${p.label.padEnd(16)} ${s.model.padEnd(18)} ${s.detail}`);
  }
  console.log(`\n  Actions: ${tools.map((t) => t.name).join(", ")}`);
  if (!system.supported) console.log(`  (PC controls are Windows-only; this is ${system.os})`);
  console.log(`  Default provider: ${config.defaultProvider}   (change with AI_PROVIDER in .env)\n`);
});
