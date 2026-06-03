import "./index.css";
import {
  initBv, makeToast, bvApi, type BvToastFn,
  mountShell, statRow, dataTable, card, emptyState, pill, flash, h, skeleton, skeletonCard, openModal,
} from "./bv-init";

/* ------------------------------------------------------------------ interfaces */
interface Rating { average: number | null; count: number; }
interface Override { limit_kind: string; amount: number; expires_in_seconds: number; }
interface Limits {
  daily_limit?: number; monthly_limit?: number; single_limit?: number; withdrawal_limit?: number;
  usage_today?: number; usage_month?: number; active_overrides?: Override[];
}
interface NextTier { documents_needed: number; unlocks_daily_limit: number; }
interface KycRequest {
  id: number; kind: string; status: string; document_type?: string | null; reason?: string | null;
  ai_verdict?: string | null; ai_flags?: string[]; ai_confidence?: number | null; submitted_at?: string | null;
}
interface LimitHistoryRow {
  id: number; limit_kind?: string; amount: number; duration_days?: number; fee?: number;
  status: string; reason?: string; expires_at?: string; created_at?: string;
}
interface Kyc {
  documents_approved: number; approved_document_types?: string[];
  next_tier?: NextTier | null; requests: KycRequest[];
}
interface Reputation {
  standing: string; account_status: string; rating: Rating;
  limits: Limits; kyc: Kyc; next_actions: string[];
}

/* ------------------------------------------------------------------ app state */
const root = document.getElementById("root")!;
let _toast: BvToastFn;
let merchantName = "Merchant";
let currency = "JMD";
let rep: Reputation | null = null;
let available = true;
let shell: ReturnType<typeof mountShell>;

/* ------------------------------------------------------------------ constants */
const STANDING: Record<string, { label: string; tone: string; icon: string }> = {
  good:            { label: "Good standing",   tone: "ok",      icon: "check" },
  review:          { label: "Under review",    tone: "warning", icon: "clock" },
  action_required: { label: "Action required", tone: "bad",     icon: "alert" },
  restricted:      { label: "Restricted",      tone: "bad",     icon: "alert" },
  unverified:      { label: "Unverified",      tone: "warning", icon: "user"  },
  unknown:         { label: "Unknown",         tone: "",        icon: "user"  },
};
const KYC_STATUS: Record<string, string> = {
  pending: "warning", in_review: "primary", approved: "ok", rejected: "bad",
};
const KIND_LABEL: Record<string, string> = {
  document: "Document", bank_account: "Bank account", limit_increase: "Limit increase", other: "Request",
};
const DOC_TYPES: [string, string][] = [
  ["proof_of_identity",          "Proof of identity (ID / passport)"],
  ["picture_of_self",            "Photo of yourself"],
  ["proof_of_address",           "Proof of address"],
  ["proof_of_bank_ownership",    "Proof of bank ownership"],
  ["business_certificate",       "Business certificate"],
  ["articles_of_incorporation",  "Articles of incorporation"],
  ["annual_return",              "Annual return"],
  ["notice_of_directors",        "Notice of directors"],
  ["notice_of_secretary",        "Notice of secretary"],
  ["tax_compliance_certificate", "Tax compliance certificate"],
];
const LIMIT_HIST_TONE: Record<string, string> = {
  approved: "ok", pending: "warning", expired: "", rejected: "bad",
};

/* ================================================================== Bootstrap */
(async () => {
  let session;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has("inkress_session")) {
    const m = await import("./dev-mock"); m.installMockFetch(); session = m.mockSession();
  } else {
    try { session = await initBv(); }
    catch (err: any) { root.innerHTML = ""; root.append(fatal(err?.message)); return; }
  }
  _toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";
  currency = session.merchant.currency_code || "JMD";

  shell = mountShell({
    brandIcon: "check",
    brandLogo: "/logo.svg",
    title: "Account Standing",
    subtitle: `${merchantName} · verification, limits & standing`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "overview",     label: "Overview",     icon: "user",   render: renderOverview },
      { id: "limits",       label: "Limits",       icon: "wallet", render: renderLimits },
      { id: "verification", label: "Verification", icon: "folder", render: renderVerification },
    ],
  });
})();

/* ================================================================== Helpers */
const money = (n?: number) => fmt(n ?? 0);
function fmt(n: number): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${currency} ${Math.round(n)}`; }
}
function capitalize(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtRemaining(sec: number): string {
  if (sec <= 0) return "expiring";
  const d = Math.floor(sec / 86400), hr = Math.floor((sec % 86400) / 3600);
  return d >= 1 ? `${d}d ${hr}h` : `${hr}h`;
}
function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(new Error("Couldn't read the file"));
    r.readAsDataURL(f);
  });
}

/* ------------------------------------------------------------------ Skeleton loader */
function renderSkeleton(host: HTMLElement) {
  host.append(
    card({ body: h("div", { class: "rd-skeleton-hero" },
      h("div", { class: "rd-skeleton-left" },
        skeleton("52%", 18), h("div", { style: { height: "8px" } }), skeleton("36%", 13)),
      h("div", { class: "rd-skeleton-right" },
        skeleton("56px", 34), h("div", { style: { height: "6px" } }), skeleton("76px", 12))) }),
    h("div", { class: "rd-skeleton-stats bv-stats" },
      skeletonCard(), skeletonCard(), skeletonCard(), skeletonCard()),
  );
}

/* ------------------------------------------------------------------ Data loader */
async function load(host: HTMLElement): Promise<Reputation | null> {
  if (rep) return rep;
  const ghost = h("div", { class: "rd-loading-ghost" });
  host.append(ghost);
  renderSkeleton(ghost);
  const r = await bvApi<{ reputation: Reputation | null; available: boolean }>("/api/reputation").catch(() => null);
  ghost.remove();
  available = !!r?.available;
  rep = r?.reputation || null;
  return rep;
}

/* ================================================================== Overview */
async function renderOverview(host: HTMLElement) {
  const r = await load(host);
  if (!r) { host.append(unavailable()); return; }

  const st = STANDING[r.standing] || STANDING["unknown"]!;
  const avg = r.rating?.average;
  const count = r.rating?.count || 0;
  const hasRating = count > 0;
  const ratingNumeral = avg != null ? String(avg) : "—";
  const ratingMeta = hasRating ? `${count} rating${count === 1 ? "" : "s"}` : "No ratings yet";

  /* ---- Hero card ---- */
  host.append(card({
    body: h("div", { class: "rd-hero" },

      // Status column
      h("div", { class: "rd-hero-status" },
        h("div", { class: "rd-hero-pill-row" },
          pill(st.label, st.tone || undefined, st.icon)),
        r.account_status
          ? h("div", { class: "rd-acct-status" },
              capitalize(r.account_status.replace(/_/g, " ")))
          : null,
        r.next_actions?.length
          ? h("div", { class: "rd-hero-hint" },
              h("span", { class: "rd-hint-dot" }),
              `${r.next_actions.length} action${r.next_actions.length === 1 ? "" : "s"} recommended`)
          : h("div", { class: "rd-hero-hint is-ok" },
              h("span", { class: "rd-hint-dot is-ok" }),
              "No actions needed")),

      // Rating column
      h("div", { class: "rd-rating-cluster" },
        h("div", { class: "rd-rating-numeral" + (hasRating ? "" : " is-empty") }, ratingNumeral),
        hasRating
          ? h("div", { class: "rd-stars" }, ...ratingStars(avg ?? 0))
          : null,
        h("div", { class: "rd-rating-label" }, ratingMeta)),
    ),
  }));

  /* ---- Next actions ---- */
  const actions = r.next_actions || [];
  host.append(card({
    title: "What to do next",
    body: actions.length
      ? h("ul", { class: "rd-actions" }, ...actions.map((a) =>
          h("li", null,
            h("span", { class: "rd-action-dot" }),
            h("span", null, a))))
      : emptyState({
          icon: "check",
          title: "You're all set",
          text: "No action needed right now. Keep accepting payments — your standing grows over time.",
        }),
  }));
}

function ratingStars(avg: number): HTMLElement[] {
  return [1, 2, 3, 4, 5].map((n) => {
    const fill = Math.min(1, Math.max(0, avg - (n - 1)));
    const cls = fill >= 1 ? "rd-star is-full" : fill > 0 ? "rd-star is-half" : "rd-star is-empty-star";
    return h("span", { class: cls }, "★");
  });
}

/* ================================================================== Limits */
async function renderLimits(host: HTMLElement) {
  const r = await load(host);
  if (!r) { host.append(unavailable()); return; }
  const l = r.limits || {};

  const ovBy: Record<string, number> = {};
  for (const o of l.active_overrides || []) ovBy[o.limit_kind] = (ovBy[o.limit_kind] || 0) + (o.amount || 0);
  const eff = (base: number | undefined, kind: string) => (base || 0) + (ovBy[kind] || 0);
  const dailyEff   = eff(l.daily_limit,   "daily");
  const monthlyEff = eff(l.monthly_limit, "monthly");
  const singleEff  = eff(l.single_limit,  "single");

  host.append(statRow([
    {
      k: "Daily limit", v: money(dailyEff), icon: "wallet",
      d: ovBy["daily"]   ? `${money(l.daily_limit)} base + ${money(ovBy["daily"])} boost`    : "effective today",
      tone: ovBy["daily"] ? "ok" : "accent",
    },
    {
      k: "Monthly limit", v: money(monthlyEff), icon: "calendar",
      d: ovBy["monthly"] ? `${money(l.monthly_limit)} base + ${money(ovBy["monthly"])} boost` : "effective this month",
      tone: ovBy["monthly"] ? "ok" : undefined,
    },
    {
      k: "Per transaction", v: money(singleEff), icon: "tag",
      d: ovBy["single"]  ? `${money(l.single_limit)} base + ${money(ovBy["single"])} boost`  : "max per order",
      tone: ovBy["single"] ? "ok" : undefined,
    },
    { k: "Withdrawal", v: money(l.withdrawal_limit), icon: "cash", d: "per cycle" },
  ]));

  host.append(card({
    title: "Usage vs effective limit",
    body: [
      usageBar("Today",      l.usage_today  ?? 0, dailyEff),
      usageBar("This month", l.usage_month  ?? 0, monthlyEff),
    ],
  }));

  if (l.active_overrides && l.active_overrides.length) {
    host.append(card({
      title: "Active temporary increases",
      body: h("ul", { class: "rd-overrides" }, ...l.active_overrides.map((o) =>
        h("li", { class: "rd-override-item" },
          h("div", { class: "rd-override-left" },
            pill(`+${money(o.amount)}`, "ok", "sparkles"),
            h("span", { class: "rd-override-kind" }, capitalize(o.limit_kind) + " limit")),
          h("div", { class: "rd-override-right" },
            h("span", { class: "rd-override-ttl" }, fmtRemaining(o.expires_in_seconds)),
            h("span", { class: "bv-muted" }, " remaining"))))),
    }));
  } else {
    host.append(card({
      title: "Temporary increases",
      body: h("div", { class: "rd-info-block" },
        h("div", { class: "rd-info-icon" }, "🚀"),
        h("div", null,
          h("div", { class: "rd-info-title" }, "Need more headroom?"),
          h("div", { class: "bv-muted" },
            "Temporary limit increases are available from the Limit Increase app — perfect for sales, events, or seasonal peaks."))),
    }));
  }

  const hist = await bvApi<{ requests: LimitHistoryRow[] }>("/api/limit-history").catch(() => ({ requests: [] }));
  host.append(card({
    title: "Limit changes over time",
    body: dataTable<LimitHistoryRow>({
      columns: [
        { head: "Limit",    cell: (x) => x.limit_kind ? capitalize(x.limit_kind) : "—" },
        { head: "Increase", num: true, cell: (x) => h("span", { class: "rd-amount-pos" }, `+${money(x.amount)}`) },
        { head: "Days",     num: true, cell: (x) => x.duration_days != null ? String(x.duration_days) : "—" },
        { head: "Status",   cell: (x) => pill(capitalize(x.status.replace(/_/g, " ")), LIMIT_HIST_TONE[x.status] ?? "") },
        { head: "Date",     cell: (x) => x.created_at ? new Date(x.created_at).toLocaleDateString() : "—" },
      ],
      rows: hist?.requests || [],
      empty: emptyState({
        icon: "chart",
        title: "No limit changes yet",
        text: "Temporary limit increases you request will appear here as a history.",
      }),
    }),
  }));
}

function usageBar(label: string, used: number, limit: number): HTMLElement {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok";
  const toneLabel = pct >= 90 ? "Critical" : pct >= 70 ? "High usage" : "Healthy";
  return h("div", { class: "rd-usage" },
    h("div", { class: "rd-usage-top" },
      h("div", { class: "rd-usage-meta" },
        h("span", { class: "rd-usage-label" }, label),
        h("span", { class: `rd-usage-badge is-${tone}` }, toneLabel)),
      h("div", { class: "rd-usage-amounts" },
        h("span", { class: "rd-usage-used" }, money(used)),
        h("span", { class: "rd-usage-sep" }, " / "),
        h("span", null, money(limit)),
        h("span", { class: "rd-usage-pct" }, `${pct}%`))),
    h("div", { class: "rd-track" },
      h("div", { class: "rd-fill", dataset: { tone }, style: { width: `${pct}%` } })));
}

/* ================================================================== Verification */
async function renderVerification(host: HTMLElement) {
  const r = await load(host);
  if (!r) { host.append(unavailable()); return; }
  const k = r.kyc || { documents_approved: 0, requests: [] };
  const approved = k.documents_approved || 0;
  const nextTier = k.next_tier;
  const total = nextTier ? approved + nextTier.documents_needed : approved;
  const pct   = total > 0 ? Math.min(100, Math.round((approved / total) * 100)) : 100;

  /* ---- Verification ladder card ---- */
  host.append(card({
    title: "Verification level",
    body: h("div", { class: "rd-ladder" },

      h("div", { class: "rd-ladder-header" },
        h("div", { class: "rd-ladder-docs" },
          h("span", { class: "rd-ladder-count" }, String(approved)),
          h("span", { class: "rd-ladder-unit" }, ` doc${approved === 1 ? "" : "s"} approved`)),
        nextTier
          ? h("div", { class: "rd-ladder-next" },
              h("span", { class: "bv-muted" }, `${nextTier.documents_needed} more unlocks `),
              h("span", { class: "rd-ladder-unlock" }, money(nextTier.unlocks_daily_limit) + "/day"))
          : pill("Top tier reached", "ok", "check")),

      h("div", { class: "rd-track rd-track-ladder" },
        h("div", { class: "rd-fill is-accent-fill", style: { width: `${pct}%` } })),
      h("div", { class: "rd-ladder-pct-row" },
        h("span", { class: "rd-ladder-pct" }, `${pct}% complete`),
        nextTier ? h("span", { class: "bv-muted" }, `${nextTier.documents_needed} more needed`) : null),

      h("div", { class: "rd-tier-steps" },
        ...buildTierSteps(approved)),
    ),
  }));

  /* ---- Upload card ---- */
  host.append(uploadCard());

  /* ---- Requests table ---- */
  host.append(card({
    title: "Verification requests",
    body: dataTable<KycRequest>({
      columns: [
        { head: "Type",      cell: (q) => KIND_LABEL[q.kind] || q.kind },
        { head: "Document",  cell: (q) => q.document_type
            ? h("span", { class: "bv-mono" }, q.document_type.replace(/_/g, " "))
            : h("span", { class: "bv-faint" }, "—") },
        { head: "Status",    cell: (q) => pill(
            capitalize(q.status.replace(/_/g, " ")),
            KYC_STATUS[q.status] || "",
            q.status === "approved" ? "check" : q.status === "rejected" ? "alert" : "clock") },
        { head: "Flags",     cell: (q) => (q.ai_flags && q.ai_flags.length)
            ? pill(`${q.ai_flags.length} flag${q.ai_flags.length === 1 ? "" : "s"}`, "warning", "alert")
            : h("span", { class: "bv-faint" }, "—") },
        { head: "Submitted", cell: (q) => q.submitted_at
            ? new Date(q.submitted_at).toLocaleDateString()
            : h("span", { class: "bv-faint" }, "—") },
      ],
      rows: k.requests || [],
      rowActions: (q) => h("button", { class: "ghost sm", onClick: () => openRequestDetail(q) }, "View"),
      empty: emptyState({
        icon: "folder",
        title: "No verification requests yet",
        text: "Upload a document below. Inkress reviews each submission and updates your limits automatically.",
      }),
    }),
  }));
}

function buildTierSteps(approved: number): HTMLElement[] {
  const tiers = [
    { label: "Unverified", minDocs: 0  },
    { label: "Basic",      minDocs: 1  },
    { label: "Verified",   minDocs: 2  },
    { label: "Advanced",   minDocs: 4  },
  ];
  return tiers.map((t, i) => {
    const done    = approved >= t.minDocs;
    const isLast  = i === tiers.length - 1;
    const current = done && (isLast || approved < (tiers[i + 1]?.minDocs ?? Infinity));
    const cls = done ? (current ? "rd-step is-current" : "rd-step is-done") : "rd-step";
    return h("div", { class: cls },
      h("div", { class: "rd-step-dot" }),
      h("div", { class: "rd-step-label" }, t.label));
  });
}

/* ================================================================== Upload card */
function uploadCard(): HTMLElement {
  let selectedFile: File | null = null;

  const typeSel = h("select", null,
    h("option", { value: "", disabled: true, selected: true }, "Choose document type…"),
    ...DOC_TYPES.map(([v, l]) => h("option", { value: v }, l)),
  ) as HTMLSelectElement;

  const fileNameEl = h("div", { class: "rd-dropzone-name" }, "No file chosen");
  const fileInput = h("input", {
    type: "file",
    accept: ".pdf,.png,.jpg,.jpeg,image/*,application/pdf",
    "aria-hidden": "true",
    tabindex: "-1",
    style: { position: "absolute", inset: "0", opacity: "0", cursor: "pointer", width: "100%", height: "100%", zIndex: "1" },
  }) as HTMLInputElement;

  const dropzone = h("div", { class: "rd-dropzone", tabindex: "0", role: "button", "aria-label": "Choose a document file" },
    h("div", { class: "rd-dropzone-icon" }),
    h("div", { class: "rd-dropzone-prompt" },
      h("span", { class: "rd-dropzone-cta" }, "Click to browse"),
      h("span", { class: "rd-dropzone-or" }, " or drag & drop")),
    h("div", { class: "rd-dropzone-hint" }, "PDF or image · max 15 MB"),
    fileNameEl,
  );
  dropzone.style.position = "relative";
  dropzone.append(fileInput);

  const setFile = (f: File | null) => {
    selectedFile = f;
    if (f) {
      fileNameEl.textContent = f.name;
      fileNameEl.classList.add("has-file");
      dropzone.classList.add("has-file");
    } else {
      fileNameEl.textContent = "No file chosen";
      fileNameEl.classList.remove("has-file");
      dropzone.classList.remove("has-file");
    }
  };

  fileInput.addEventListener("change", () => setFile(fileInput.files?.[0] ?? null));
  dropzone.addEventListener("dragover", (e: DragEvent) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
  dropzone.addEventListener("dragleave",  () => dropzone.classList.remove("is-drag"));
  dropzone.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault(); dropzone.classList.remove("is-drag");
    const f = e.dataTransfer?.files?.[0]; if (f) setFile(f);
  });
  dropzone.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });

  const submitBtn = h("button", { class: "primary" }, "Submit document") as HTMLButtonElement;

  submitBtn.addEventListener("click", async () => {
    const f = selectedFile || fileInput.files?.[0] || null;
    if (!typeSel.value) return flash("Select a document type first", "warning");
    if (!f)             return flash("Choose a file to upload", "warning");
    if (f.size > 15 * 1024 * 1024) return flash("File must be under 15 MB", "warning");
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    dropzone.classList.add("is-uploading");
    try {
      const file_base64 = await fileToBase64(f);
      const result = await bvApi<{ ok?: boolean; error?: string }>("/api/kyc/upload", {
        method: "POST",
        body: JSON.stringify({ document_type: typeSel.value, file_name: f.name, mime: f.type, file_base64 }),
      }).catch((e: any): { ok?: boolean; error?: string } => ({ error: e?.message }));
      if (result?.ok) {
        flash("Document submitted — Inkress will review it shortly.", "success");
        rep = null;
        shell.select("verification");
      } else {
        flash(result?.error || "Upload failed", "error");
      }
    } catch (e: any) {
      flash(e?.message || "Couldn't read the file", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit document";
      dropzone.classList.remove("is-uploading");
    }
  });

  return card({
    title: "Upload a verification document",
    body: [
      h("div", { class: "rd-field" },
        h("label", { class: "bv-label" }, "Document type"), typeSel),
      h("div", { class: "rd-field" },
        h("label", { class: "bv-label" }, "Document file"),
        dropzone),
      h("div", { class: "rd-upload-footer" },
        submitBtn,
        h("p", { class: "bv-muted rd-upload-note" },
          "Inkress reviews each submission. Approved documents automatically raise your limits.")),
    ],
  });
}

/* ================================================================== Request detail modal */
function openRequestDetail(q: KycRequest) {
  const confidencePct = q.ai_confidence != null ? Math.round((q.ai_confidence || 0) * 100) : null;

  const detailRow = (label: string, val: Node | string): HTMLElement =>
    h("div", { class: "rd-detail-row" },
      h("dt", null, label),
      h("dd", null, val instanceof Node ? val : String(val)));

  const rows: HTMLElement[] = [
    detailRow("Type",   KIND_LABEL[q.kind] || q.kind),
    detailRow("Status", pill(capitalize(q.status.replace(/_/g, " ")), KYC_STATUS[q.status] || "")),
  ];
  if (q.document_type) rows.push(detailRow("Document", h("span", { class: "bv-mono" }, q.document_type.replace(/_/g, " "))));
  if (q.ai_verdict)    rows.push(detailRow("AI verdict",
    h("span", { class: `rd-verdict is-${q.ai_verdict === "pass" ? "ok" : "bad"}` }, capitalize(q.ai_verdict))));
  if (confidencePct != null) rows.push(detailRow("Confidence", confBar(confidencePct)));
  if (q.reason)        rows.push(detailRow("Reason", q.reason));
  if (q.submitted_at)  rows.push(detailRow("Submitted", new Date(q.submitted_at).toLocaleString()));

  const flagsBlock = (q.ai_flags && q.ai_flags.length)
    ? h("div", { class: "rd-flags-section" },
        h("div", { class: "bv-label", style: { marginBottom: "8px" } }, "AI Flags"),
        h("ul", { class: "rd-flags" },
          ...q.ai_flags.map((f) =>
            h("li", null,
              pill(f, "warning", "alert")))))
    : null;

  openModal({
    title: `Request #${q.id}`,
    body: h("div", { class: "rd-modal-content" },
      h("dl", { class: "rd-detail-list" }, ...rows),
      flagsBlock || h("span")),
  });
}

function confBar(pct: number): HTMLElement {
  const tone = pct >= 80 ? "ok" : pct >= 50 ? "warn" : "bad";
  return h("div", { class: "rd-conf-wrap" },
    h("div", { class: "rd-track rd-conf-track" },
      h("div", { class: "rd-fill", dataset: { tone }, style: { width: `${pct}%` } })),
    h("span", { class: "rd-conf-pct" }, `${pct}%`));
}

/* ================================================================== Shared */
function unavailable(): HTMLElement {
  return emptyState({
    icon: "alert",
    title: "Standing data unavailable",
    text: available
      ? "We couldn't load your account standing right now. Please try again."
      : "This account hasn't been set up for standing data yet.",
    action: h("button", { class: "primary", onClick: () => { rep = null; shell.select("overview"); } }, "Retry"),
  });
}

function fatal(msg?: string): HTMLElement {
  return h("div", { class: "bv-fatal" },
    h("div", { class: "box" },
      h("h2", null, "Couldn't start"),
      h("p", { class: "bv-muted" }, msg || "Unable to initialize the app.")));
}
