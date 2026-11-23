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
import { createTokenProvider, loadServiceAccount } from "./google/serviceAccount.js";
import { createSheetsClient } from "./google/sheets.js";
import { createChatEngine } from "./chatEngine.js";
import { createVoiceStudio } from "./voice/voiceStudio.js";
import { startTelegramBot } from "./bots/telegram.js";
import { startDiscordBot } from "./bots/discord.js";

const config = loadConfig();
const providers = createProviders(config);
const events = createEventHub();
const reminders = createReminderStore(config.dataDir);
const pendingActions = createPendingActions();
const system = createSystem();
const apps = system.supported ? await loadApps(config.dataDir) : {};
let sheets = null;
let sheetsProblem = "";
try {
  const account = await loadServiceAccount(config.googleKeyFile);
  if (account) sheets = createSheetsClient({ getToken: createTokenProvider(account), clientEmail: account.clientEmail });
} catch (err) {
  sheetsProblem = err.message;
}
const tools = createTools({ reminders, system, apps, pendingActions, sheets });

startReminderScheduler({ store: reminders, events, notify: (t, b) => system.notify(t, b) });

const profileStore = createProfileStore(config.dataDir);
const engine = createChatEngine({ config, providers, profileStore, tools });
const voiceStudio = createVoiceStudio(config.voiceStudio);
const voiceStudioUp = voiceStudio ? await voiceStudio.health() : false;

// Chat-app bots start only when their token is set in .env.
const bots = [];
if (config.telegram.token) {
  bots.push(startTelegramBot({ ...config.telegram, engine, pendingActions }));
}
if (config.discord.token) {
  bots.push(startDiscordBot({ ...config.discord, engine, pendingActions }));
}

const app = createApp({
  config,
  providers,
  profileStore,
  tools,
  reminders,
  events,
  pendingActions,
  engine,
  voiceStudio,
  integrations: {
    googleSheets: sheets ? { connected: true, email: sheets.clientEmail } : { connected: false, problem: sheetsProblem },
    voiceStudio: { connected: Boolean(voiceStudio), url: voiceStudio?.url },
    telegram: { connected: Boolean(config.telegram.token), allowedUsers: config.telegram.allowedUsers.length },
    discord: { connected: Boolean(config.discord.token), allowedUsers: config.discord.allowedUsers.length },
  },
});

app.listen(config.port, config.host, async () => {
  console.log(`\n  Personal AI is running →  http://localhost:${config.port}\n`);
  for (const p of providers.values()) {
    const s = await p.status();
    console.log(`  ${s.available ? "✔" : "✘"} ${p.label.padEnd(16)} ${s.model.padEnd(18)} ${s.detail}`);
  }
  console.log(`\n  Actions: ${tools.map((t) => t.name).join(", ")}`);
  console.log(
    sheets
      ? `  ✔ Google Sheets: share your sheets with ${sheets.clientEmail}`
      : `  ✘ Google Sheets: ${sheetsProblem || "not set up (see README → Google Sheets)"}`,
  );
  if (voiceStudio) {
    console.log(voiceStudioUp
      ? `  ✔ VoiceStudio found at ${voiceStudio.url}: its voices are in Profile → Spoken voice`
      : `  ⚠ VoiceStudio not running at ${voiceStudio.url}: open the app to use its voices`);
  }
  for (const [name, c] of [["Telegram", config.telegram], ["Discord", config.discord]]) {
    if (!c.token) console.log(`  ✘ ${name} bot: not set up (see README)`);
    else if (!c.allowedUsers.length) console.log(`  ⚠ ${name} bot: running, but nobody is allowed yet. Message it to get your user ID.`);
    else console.log(`  ✔ ${name} bot: ${c.allowedUsers.length} allowed user(s)`);
  }
  if (!system.supported) console.log(`  (PC controls are Windows-only; this is ${system.os})`);
  console.log(`  Default provider: ${config.defaultProvider}   (change with AI_PROVIDER in .env)\n`);
});
