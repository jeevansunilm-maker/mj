// A small Google Sheets API v4 client (plain fetch).
// Docs: https://developers.google.com/sheets/api/reference/rest
const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Accepts a full Google Sheets link or a bare spreadsheet ID. */
export function parseSpreadsheetId(input) {
  const s = String(input ?? "").trim();
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new Error("That doesn't look like a Google Sheets link or ID. Paste the sheet's link from the address bar.");
}

export const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export function createSheetsClient({ getToken, clientEmail, fetchImpl = fetch, baseUrl = API }) {
  async function call(method, path, { query, body } = {}) {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${await getToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Couldn't reach Google Sheets. Check your internet connection.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const msg = data.error?.message ?? res.statusText;
    if (res.status === 403) {
      throw new Error(`Your AI can't open this sheet. In Google Sheets click Share and add ${clientEmail} as an Editor.`);
    }
    if (res.status === 404) throw new Error("Spreadsheet not found. Check the link.");
    if (res.status === 400) throw new Error(`Google Sheets rejected the request: ${msg}`);
    throw new Error(`Google Sheets error ${res.status}: ${msg}`);
  }
  const enc = (range) => encodeURIComponent(range);

  return {
    clientEmail,
    /** Title and tab names (with sizes). */
    async info(id) {
      const d = await call("GET", `/${id}`, { query: { fields: "properties.title,sheets.properties(title,gridProperties)" } });
      return {
        title: d.properties?.title,
        tabs: (d.sheets ?? []).map((s) => ({
          name: s.properties.title,
          rows: s.properties.gridProperties?.rowCount,
          columns: s.properties.gridProperties?.columnCount,
        })),
      };
    },
    async read(id, range) {
      const d = await call("GET", `/${id}/values/${enc(range)}`, { query: { valueRenderOption: "FORMATTED_VALUE" } });
      return { range: d.range, values: d.values ?? [] };
    },
    /** Adds rows after the last row of the table in `range` (e.g. "Sheet1"). */
    async append(id, range, rows) {
      const d = await call("POST", `/${id}/values/${enc(range)}:append`, {
        query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
        body: { values: rows },
      });
      return { updatedRange: d.updates?.updatedRange, updatedRows: d.updates?.updatedRows ?? rows.length };
    },
    /** Overwrites cells in `range` (e.g. "Sheet1!B2:C3"). */
    async update(id, range, values) {
      const d = await call("PUT", `/${id}/values/${enc(range)}`, {
        query: { valueInputOption: "USER_ENTERED" },
        body: { values },
      });
      return { updatedRange: d.updatedRange, updatedCells: d.updatedCells };
    },
  };
}
