// Checks the exact Windows commands we would run, without needing Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWindowsSystem } from "../src/system/windows.js";
import { loadApps } from "../src/system/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { tempDir } from "./helpers.js";

function fakeExec(stdout = "{}") {
  const calls = [];
  const exec = (file, args, opts, cb) => { calls.push({ file, args, env: opts.env }); cb(null, stdout, ""); };
  return { calls, exec };
}
function fakeSpawn() {
  const calls = [];
  const spawnImpl = (file, args) => {
    calls.push({ file, args });
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  return { calls, spawnImpl };
}

test("volume runs PowerShell with values only in env vars", async () => {
  const { calls, exec } = fakeExec('{"volume":35,"muted":false}');
  const sys = createWindowsSystem({ exec });
  assert.deepEqual(await sys.volume("set", 35.4), { volume: 35, muted: false });
  assert.equal(calls[0].file, "powershell.exe");
  assert.equal(calls[0].env.PAI_ACTION, "set");
  assert.equal(calls[0].env.PAI_LEVEL, "35");
  assert.match(calls[0].args.at(-1), /SetMasterVolumeLevelScalar/);
  await sys.volume("set", 900);
  assert.equal(calls[1].env.PAI_LEVEL, "100"); // clamped
  assert.equal(calls[0].args.at(-1), calls[1].args.at(-1)); // value never baked into the script
  await assert.rejects(sys.volume("explode"), /Unknown volume action/);
});

test("power uses shutdown.exe with a 30 s delay", async () => {
  const { calls, exec } = fakeExec("");
  const sys = createWindowsSystem({ exec });
  await sys.power("shutdown");
  await sys.power("cancel_shutdown");
  await sys.power("lock");
  assert.deepEqual(calls[0].args.slice(0, 3), ["/s", "/t", "30"]);
  assert.deepEqual(calls[1], { ...calls[1], file: "shutdown.exe", args: ["/a"] });
  assert.deepEqual([calls[2].file, calls[2].args], ["rundll32.exe", ["user32.dll,LockWorkStation"]]);
  await assert.rejects(sys.power("format_c"), /Unknown power action/);
});

test("launch: links via rundll32, programs directly, no shell", async () => {
  const { calls, spawnImpl } = fakeSpawn();
  const sys = createWindowsSystem({ spawnImpl });
  await sys.launch("ms-settings:sound");
  await sys.launch("https://example.com/?a=1&b=2");
  await sys.launch("notepad.exe");
  await sys.launch("C:\\Program Files\\App\\app.exe");
  assert.deepEqual(calls, [
    { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", "ms-settings:sound"] },
    { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", "https://example.com/?a=1&b=2"] },
    { file: "notepad.exe", args: [] },
    { file: "C:\\Program Files\\App\\app.exe", args: [] },
  ]);
});

test("notification text goes through env vars (no script injection)", async () => {
  const { calls, exec } = fakeExec("");
  await createWindowsSystem({ exec }).notify("Reminder", "'; Remove-Item C:\\ -Recurse #");
  assert.equal(calls[0].env.PAI_BODY, "'; Remove-Item C:\\ -Recurse #");
  assert.doesNotMatch(calls[0].args.at(-1), /Remove-Item/);
});

test("apps.json adds and removes apps", async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, "apps.json"), JSON.stringify({ "VS Code": "C:\\code.exe", paint: null }));
  const apps = await loadApps(dir, { paint: "mspaint.exe", notepad: "notepad.exe" });
  assert.deepEqual(apps, { notepad: "notepad.exe", "vs code": "C:\\code.exe" });
});
