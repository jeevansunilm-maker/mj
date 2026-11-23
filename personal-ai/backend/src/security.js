// Protects the local server from other websites open in your browser.
//
// 1. Host check (blocks "DNS rebinding"): a malicious site can point its own
//    domain at 127.0.0.1 and then talk to this app as if it were the same site.
//    We only answer requests addressed to localhost / 127.0.0.1 / [::1].
// 2. Origin check (blocks cross-site requests): another site can send a POST to
//    localhost. Browsers label those with Origin / Sec-Fetch-Site; we refuse them.
// 3. Security headers: no framing (stops tricking you into clicking Confirm in
//    a hidden frame), strict Content-Security-Policy, no MIME sniffing.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(hostHeader = "") {
  // "localhost:3000" -> "localhost", "[::1]:3000" -> "[::1]"
  const m = hostHeader.toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(:\d+)?$/);
  return m ? m[1] : "";
}

export function securityMiddleware({ extraHosts = [] } = {}) {
  const allowed = new Set([...LOCAL_HOSTS, ...extraHosts.map((h) => h.toLowerCase())]);

  return function security(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );

    if (!allowed.has(hostname(req.headers.host))) {
      return res.status(403).type("text").send("Forbidden: open this app at http://localhost");
    }

    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (unsafe) {
      const site = req.headers["sec-fetch-site"];
      if (site && site !== "same-origin" && site !== "none") {
        return res.status(403).json({ error: "Cross-site request blocked" });
      }
      const origin = req.headers.origin;
      if (origin && origin !== "null") {
        let ok = false;
        try {
          const u = new URL(origin);
          ok = allowed.has(hostname(u.host)) && u.host === req.headers.host?.toLowerCase();
        } catch { /* malformed origin */ }
        if (!ok) return res.status(403).json({ error: "Cross-site request blocked" });
      } else if (origin === "null") {
        return res.status(403).json({ error: "Cross-site request blocked" });
      }
    }
    next();
  };
}
