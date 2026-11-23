import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createTokenProvider, loadServiceAccount } from "../src/google/serviceAccount.js";
import { createSheetsClient, parseSpreadsheetId } from "../src/google/sheets.js";
import { chat, startFakeGoogle, startTestApp, tempDir } from "./helpers.js";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`;
const call = (name, args) => ({ function: { name, arguments: args } });

async function setup(turns, shared = [ID]) {
  const google = await startFakeGoogle({ shared });
  const sheets = createSheetsClient({
    getToken: createTokenProvider(google.account),
    clientEmail: google.account.clientEmail,
    baseUrl: `${google.base}/v4/spreadsheets`,
  });
  const app = await startTestApp({ sheets, ollamaOptions: { turns } });
  return { google, app, close: async () => { await app.close(); await google.close(); } };
}

test("parseSpreadsheetId accepts links and IDs, rejects junk", () => {
  assert.equal(parseSpreadsheetId(LINK), ID);
  assert.equal(parseSpreadsheetId(ID), ID);
  assert.throws(() => parseSpreadsheetId("my budget"), /link or ID/);
});

test("service-account key: loads, rejects wrong files, missing file = off", async () => {
  const dir = await tempDir();
  assert.equal(await loadServiceAccount(path.join(dir, "nope.json")), null);
  await fs.writeFile(path.join(dir, "bad.json"), JSON.stringify({ type: "authorized_user" }));
  await assert.rejects(loadServiceAccount(path.join(dir, "bad.json")), /service-account key/);
  await fs.writeFile(path.join(dir, "ok.json"), JSON.stringify({ type: "service_account", client_email: "a@b", private_key: "k" }));
  assert.equal((await loadServiceAccount(path.join(dir, "ok.json"))).tokenUri, "https://oauth2.googleapis.com/token");
});

test("token: signed JWT accepted by fake Google and cached", async () => {
  const google = await startFakeGoogle();
  try {
    const getToken = createTokenProvider(google.account);
    assert.equal(await getToken(), "tok-123");
    assert.equal(await getToken(), "tok-123");
    assert.equal(google.requests.filter((r) => r.path === "/token").length, 1);
    const other = await startFakeGoogle(); // a different key pair
    await other.close();
    const bad = createTokenProvider({ ...google.account, privateKey: other.account.privateKey });
    await assert.rejects(bad(), /Google login failed \(Invalid JWT Signature/);
  } finally { await google.close(); }
});

test("AI reads a sheet and adds a row", async () => {
  const t = await setup([
    { tool_calls: [call("sheets_read", { spreadsheet: LINK, range: "Sheet1" })] },
    { tool_calls: [call("sheets_append_rows", { spreadsheet: LINK, tab: "Sheet1", rows: [["2026-11-23", "Lunch", 450]] })] },
    { content: "Added your ₹450 lunch." },
  ]);
  try {
    const r = await chat(t.app.base, { messages: [{ role: "user", content: `add lunch 450 to ${LINK}` }] });
    const cards = r.events.filter((e) => e.type === "tool");
    assert.deepEqual(cards.map((c) => c.isError), [false, false]);
    assert.match(cards[0].display.text, /Read Sheet1!A1:C2 \(2 rows\)/);
    assert.match(cards[1].display.text, /Added 1 row\(s\) to Sheet1!A3:C3/);
    assert.deepEqual(t.google.grid.Sheet1.at(-1), ["2026-11-23", "Lunch", "450"]); // number coerced to text; Sheets parses it
    const append = t.google.requests.find((x) => x.path.endsWith(":append"));
    assert.equal(append.query.valueInputOption, "USER_ENTERED");
    // The model saw the sheet contents on its next turn.
    const toolMsg = t.app.ollama.requests.filter((x) => x.url === "/api/chat")[1].body.messages.at(-1);
    assert.match(toolMsg.content, /Rent/);
  } finally { await t.close(); }
});

test("overwriting cells needs Confirm", async () => {
  const t = await setup([
    { tool_calls: [call("sheets_update_cells", { spreadsheet: ID, range: "Sheet1!C2", values: [["16000"]] })] },
    { content: "Click Confirm to update the rent." },
  ]);
  try {
    const r = await chat(t.app.base, { messages: [{ role: "user", content: "rent is 16000 now" }] });
    const card = r.events.find((e) => e.type === "tool").display;
    assert.equal(card.kind, "confirm");
    assert.equal(t.google.grid.Sheet1[1][2], "15000", "unchanged before Confirm");
    const res = await fetch(`${t.app.base}/api/actions/${card.id}/confirm`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(t.google.grid.Sheet1[1][2], "16000");
  } finally { await t.close(); }
});

test("sheet not shared -> tells the user which email to share with", async () => {
  const t = await setup([{ tool_calls: [call("sheets_info", { spreadsheet: LINK })] }, { content: "Please share it." }], []);
  try {
    const r = await chat(t.app.base, { messages: [{ role: "user", content: "open my sheet" }] });
    const card = r.events.find((e) => e.type === "tool");
    assert.equal(card.isError, true);
    assert.match(card.display.text, /Share and add my-ai@demo\.iam\.gserviceaccount\.com as an Editor/);
  } finally { await t.close(); }
});

test("status reports the Sheets connection; tools hidden when not set up", async () => {
  const t = await setup([{ content: "hi" }]);
  try {
    const s = await (await fetch(t.app.base + "/api/status")).json();
    assert.deepEqual(s.integrations.googleSheets, { connected: true, email: "my-ai@demo.iam.gserviceaccount.com" });
    assert.ok(s.tools.includes("sheets_append_rows"));
  } finally { await t.close(); }
  const plain = await startTestApp();
  try {
    const s = await (await fetch(plain.base + "/api/status")).json();
    assert.ok(!s.tools.some((x) => x.startsWith("sheets_")));
  } finally { await plain.close(); }
});
