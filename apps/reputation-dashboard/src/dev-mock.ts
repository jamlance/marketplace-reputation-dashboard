/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const u = new URL(url, location.origin);
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 80));

    if (u.pathname === "/api/reputation") {
      return json({
        available: true,
        reputation: {
          standing: "good",
          account_status: "account active",
          rating: { average: 4.7, count: 32 },
          limits: {
            daily_limit: 45000, monthly_limit: 350000, single_limit: 20000, withdrawal_limit: 100000,
            usage_today: 38200, usage_month: 192400, active_overrides: [],
          },
          kyc: {
            documents_approved: 4,
            approved_document_types: ["national_id", "proof_of_address", "business_registration", "bank_statement"],
            next_tier: { documents_needed: 1, unlocks_daily_limit: 45000 },
            requests: [
              { id: 5, kind: "document", status: "approved", ai_verdict: "auto_approve", ai_flags: [], ai_confidence: 0.94, submitted_at: new Date(Date.now() - 12 * 86400000).toISOString() },
              { id: 7, kind: "limit_increase", status: "in_review", ai_verdict: "needs_human", ai_flags: ["velocity_spike"], ai_confidence: 0.62, submitted_at: new Date(Date.now() - 2 * 86400000).toISOString() },
              { id: 9, kind: "bank_account", status: "pending", ai_verdict: null, ai_flags: [], ai_confidence: null, submitted_at: new Date(Date.now() - 1 * 86400000).toISOString() },
            ],
          },
          next_actions: [
            "Submit 1 more verification document to raise your daily limit to $45,000.",
            "A verification request is under review.",
            "You're close to your daily limit — a temporary increase is available.",
          ],
        },
      });
    }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "bookerva-jackjack", name: "Jack Jack Barbershop", currency_code: "USD", email: "jack@example.com", logo: null },
    user: { id: 90, name: "Front Desk", email: "desk@jackjack.com" },
    scopes: ["reputation:read"],
  };
}
