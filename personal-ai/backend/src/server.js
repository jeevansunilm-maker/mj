// Entry point: `npm start` runs this file.
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createProfileStore } from "./profileStore.js";
import { createProviders } from "./providers/index.js";

const config = loadConfig();
const providers = createProviders(config);
const app = createApp({ config, providers, profileStore: createProfileStore(config.dataDir) });

app.listen(config.port, config.host, async () => {
  console.log(`\n  Personal AI is running →  http://localhost:${config.port}\n`);
  for (const p of providers.values()) {
    const s = await p.status();
    console.log(`  ${s.available ? "✔" : "✘"} ${p.label.padEnd(16)} ${s.model.padEnd(18)} ${s.detail}`);
  }
  console.log(`\n  Default provider: ${config.defaultProvider}   (change with AI_PROVIDER in .env)\n`);
});
