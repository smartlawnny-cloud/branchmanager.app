// Shared tenant resolver — Phase 2 multi-tenant support.
//
// All edge functions used to hardcode SNT's tenant_id
// '93af4348-8bba-4045-ac3e-5e71ec1cc8c5'. That worked with one tenant but
// would have stamped every other tenant's data into SNT's bucket.
//
// New flow:
//   1. Caller (BM client OR Cloudflare Worker for subdomain traffic) sets
//      the `X-Tenant-ID` request header. BM's supabase.js stamps it on every
//      Supabase client call; the Worker injects it from the subdomain map.
//   2. Edge functions call resolveTenantId(req) to extract it.
//   3. If absent or invalid (not a UUID), we fall back to SNT for backwards
//      compatibility during the rollout. Once every BM build + Worker route
//      sends X-Tenant-ID reliably, the fallback can be removed.
//
// Webhook receivers (dialpad-webhook, stripe-webhook, bouncie-webhook,
// resend-webhook) get tenant from the *event payload* instead — by
// looking up the receiver phone/account/customer in tenants.config and
// matching. They should NOT use this helper directly; see resolveTenantFromEvent.

const SNT_TENANT_ID = "93af4348-8bba-4045-ac3e-5e71ec1cc8c5";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve tenant_id from an HTTP request. Reads X-Tenant-ID header,
 * validates UUID shape, falls back to SNT.
 *
 * @param req incoming Request
 * @param opts.requireHeader if true, throws when header missing/invalid
 *   (use for new functions during cutover; defaults false = SNT fallback)
 */
export function resolveTenantId(
  req: Request,
  opts: { requireHeader?: boolean } = {},
): string {
  const raw = req.headers.get("x-tenant-id") || req.headers.get("X-Tenant-ID") || "";
  const trimmed = raw.trim().toLowerCase();
  if (UUID_RE.test(trimmed)) return trimmed;
  if (opts.requireHeader) {
    throw new Error("X-Tenant-ID header required");
  }
  // Backwards-compat fallback during Phase 2 rollout.
  return SNT_TENANT_ID;
}

/**
 * For webhook receivers — look up tenant from a known field in the event
 * payload. We carry tenant routing keys in `tenants.config`:
 *   - sms_from_number  → matched against Dialpad's to_number
 *   - stripe_account_id → matched against Stripe webhook account.id
 *   - bouncie_account → matched against Bouncie account hash
 *   - resend_audience → matched against Resend webhook audience id
 *
 * @param sb Supabase client (service-role)
 * @param key the kind of routing key
 * @param value the value to match
 * @returns tenant_id, or SNT fallback if not found
 */
export async function resolveTenantFromEvent(
  // deno-lint-ignore no-explicit-any
  sb: any,
  key: "sms_from_number" | "stripe_account_id" | "bouncie_account" | "resend_audience",
  value: string,
): Promise<string> {
  if (!value) return SNT_TENANT_ID;
  try {
    const { data, error } = await sb
      .from("tenants")
      .select("id, config")
      .filter(`config->>${key}`, "eq", value)
      .limit(1);
    if (error || !data || data.length === 0) return SNT_TENANT_ID;
    return data[0].id;
  } catch (_e) {
    return SNT_TENANT_ID;
  }
}

export const SNT_TENANT_ID_CONST = SNT_TENANT_ID;
