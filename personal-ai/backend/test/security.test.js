import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startTestApp } from "./helpers.js";

let t, port;
before(async () => { t = await startTestApp(); port = new URL(t.base).port; });
after(() => t.close());

// fetch() won't let us forge Host, so use the raw http module.
function raw({ method = "GET", path = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("DNS rebinding: requests for another host name are refused", async () => {
  assert.equal((await raw({ path: "/api/profile", headers: { Host: `evil.example:${port}` } })).status, 403);
  assert.equal((await raw({ path: "/api/profile", headers: { Host: `localhost:${port}` } })).status, 200);
  assert.equal((await raw({ path: "/api/profile", headers: { Host: `127.0.0.1:${port}` } })).status, 200);
});

test("cross-site POSTs are refused before reaching any route", async () => {
  const evil = await raw({
    method: "POST", path: "/api/actions/x/confirm",
    headers: { Host: `localhost:${port}`, Origin: "https://evil.example", "Content-Type": "text/plain" }, body: "x",
  });
  assert.equal(evil.status, 403);
  const fetchMeta = await raw({
    method: "POST", path: "/api/reminders/x/dismiss",
    headers: { Host: `localhost:${port}`, "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(fetchMeta.status, 403);
  const nullOrigin = await raw({ method: "POST", path: "/api/polish", headers: { Host: `localhost:${port}`, Origin: "null" } });
  assert.equal(nullOrigin.status, 403);
});

test("same-origin POSTs from the app still work", async () => {
  const ok = await raw({
    method: "POST", path: "/api/reminders",
    headers: { Host: `localhost:${port}`, Origin: `http://localhost:${port}`, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
    body: JSON.stringify({ text: "ok", dueAt: "2031-01-01T00:00:00Z" }),
  });
  assert.equal(ok.status, 201);
});

test("security headers are set", async () => {
  const { headers } = await raw({ headers: { Host: `localhost:${port}` } });
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(headers["x-powered-by"], undefined);
});
