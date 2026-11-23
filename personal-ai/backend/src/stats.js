// Live computer readouts for the HUD: CPU %, memory, uptime.
// Uses only Node's built-in `os` module.
import os from "node:os";

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === "idle") idle += v; }
  }
  return { idle, total };
}

export function createStats() {
  let last = cpuTimes();
  return function read() {
    const now = cpuTimes();
    const dTotal = now.total - last.total;
    const cpu = dTotal > 0 ? Math.round(100 * (1 - (now.idle - last.idle) / dTotal)) : 0;
    last = now;
    const total = os.totalmem();
    const free = os.freemem();
    return {
      cpu: Math.max(0, Math.min(100, cpu)),
      cpuName: os.cpus()[0]?.model?.trim() ?? "",
      cores: os.cpus().length,
      memUsedGb: +((total - free) / 1e9).toFixed(1),
      memTotalGb: +(total / 1e9).toFixed(1),
      memPct: Math.round(100 * (1 - free / total)),
      uptimeSec: Math.round(os.uptime()),
      host: os.hostname(),
    };
  };
}
