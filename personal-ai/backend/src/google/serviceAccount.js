// Google service-account login, done by hand with Node's crypto (no extra packages).
//
// A service account is a "robot" Google account. You download its key file
// (JSON) from Google Cloud, and the app uses it to get short-lived access
// tokens. The robot can only open spreadsheets you share with its email.
// Docs: https://developers.google.com/identity/protocols/oauth2/service-account#httprest
import { createSign } from "node:crypto";
import fs from "node:fs/promises";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Reads the key file. Returns null if it doesn't exist (Sheets is then off). */
export async function loadServiceAccount(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  const key = JSON.parse(raw);
  if (key.type !== "service_account" || !key.client_email || !key.private_key) {
    throw new Error(`${file} is not a Google service-account key (JSON with "type": "service_account").`);
  }
  return { clientEmail: key.client_email, privateKey: key.private_key, tokenUri: key.token_uri ?? "https://oauth2.googleapis.com/token" };
}

const b64url = (data) => Buffer.from(data).toString("base64url");

/** Builds the signed JWT that we trade for an access token. */
export function signJwt({ clientEmail, privateKey, tokenUri, scope = SHEETS_SCOPE, nowSec }) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope, aud: tokenUri, iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(privateKey).toString("base64url")}`;
}

/** Returns getToken(): a cached access token, refreshed shortly before it expires. */
export function createTokenProvider(account, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let cached = null;
  return async function getToken() {
    if (cached && now() < cached.expiresAt - 60_000) return cached.token;
    const assertion = signJwt({ ...account, nowSec: Math.floor(now() / 1000) });
    let res;
    try {
      res = await fetchImpl(account.tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      });
    } catch {
      throw new Error("Couldn't reach Google. Check your internet connection.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`Google login failed (${body.error_description ?? body.error ?? res.status}). Check data/google-service-account.json.`);
    }
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}
