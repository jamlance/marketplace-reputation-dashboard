import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore, inkressApi } from "@inkress/apps-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[reputation-dashboard] Missing env: ${k}`); process.exit(1); }
}

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID,
  clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE,
  frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

// Read-only account standing + KYC visibility (scope: reputation:read). Pure
// passthrough of the merchant-self-scoped composite — never the ledger.
app.get("/api/reputation", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, "merchants/reputation");
    const data = r?.result || r?.data || r || {};
    res.json({ reputation: data, available: true });
  } catch (err) {
    res.json({ reputation: null, available: false, reason: err?.message });
  }
});

// KYC document upload (kyc:write). Mirrors exactly what the dashboard does:
// (1) POST the binary to /v1/files/pubload (kind=50, record=merchants) — that
// endpoint is exempt from the resource scope plug, so any valid token works;
// (2) create a legal_requests kind=1 referencing the returned file id. The new
// pending submission then shows up in the reputation summary's kyc.requests.
async function uploadKycFile(token, merchantId, { documentType, fileName, base64, mime }) {
  const buf = Buffer.from(base64, "base64");
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime || "application/octet-stream" }), fileName || "document");
  form.append("kind", "50");
  form.append("record", "merchants");
  form.append("record_id", String(merchantId));
  form.append("name", documentType);
  form.append("data.type", documentType);
  const base = (process.env.INKRESS_API_BASE || "").replace(/\/$/, "");
  const r = await fetch(`${base}/files/pubload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const j = await r.json().catch(() => null);
  return j?.result || null;
}

const KYC_DOC_TYPES = new Set([
  "picture_of_self", "proof_of_identity", "proof_of_address", "proof_of_bank_ownership",
  "business_certificate", "articles_of_incorporation", "annual_return",
  "notice_of_directors", "notice_of_secretary", "tax_compliance_certificate",
]);

app.post("/api/kyc/upload", core.requireSession, express.json({ limit: "16mb" }), async (req, res) => {
  const { document_type, file_name, file_base64, mime } = req.body || {};
  if (!document_type || !KYC_DOC_TYPES.has(document_type)) return res.status(400).json({ error: "valid document_type required" });
  if (!file_base64) return res.status(400).json({ error: "file required" });
  try {
    const file = await uploadKycFile(req.session.accessToken, req.session.merchantId, { documentType: document_type, fileName: file_name, base64: file_base64, mime });
    if (!file?.id) return res.status(502).json({ error: "file_upload_failed" });
    const body = { merchant_id: req.session.merchantId, kind: 1, data: { document_type, file_id: file.id, file_name: file_name || file.file_name || document_type, __status: "pending" } };
    const lr = await inkressApi(core.cfg, req.session.accessToken, "legal_requests", { method: "POST", body: JSON.stringify(body) });
    if (lr?.state === "ok" || lr?.result?.id) return res.json({ ok: true, request: lr.result });
    res.status(422).json({ error: typeof lr?.result === "string" ? lr.result : "Could not record submission" });
  } catch (err) { res.status(502).json({ error: err?.message || "kyc_upload_failed" }); }
});

// Limit-increase request + approval history (reputation:read) — powers the
// "limit changes over time" view.
app.get("/api/limit-history", core.requireSession, async (req, res) => {
  try {
    const r = await inkressApi(core.cfg, req.session.accessToken, "merchants/limit-increase-requests");
    const rows = r?.result || r?.data || [];
    res.json({ requests: Array.isArray(rows) ? rows : [] });
  } catch (err) {
    res.json({ requests: [], reason: err?.message });
  }
});

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[reputation-dashboard] listening on ${HOST}:${PORT}`));
