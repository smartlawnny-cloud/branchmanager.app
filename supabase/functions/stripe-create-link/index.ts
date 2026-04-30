/**
 * Branch Manager — Auto-create Stripe Payment Link
 *
 * Called once from BM Settings to bootstrap the base Payment Link without
 * the user having to navigate Stripe's dashboard. Creates a $0.01/unit
 * product + price + Payment Link with `adjustable_quantity` enabled, so
 * BM can drive any invoice amount via `prefilled_quantity` (cents trick).
 *
 * Request body:
 *   { secretKey: 'sk_live_...', successUrl?: 'https://branchmanager.app/paid.html' }
 *
 * The secret key is used inline for one set of API calls and never stored
 * anywhere. Returned to the client as { ok, url }.
 *
 * Deploy:
 *   supabase functions deploy stripe-create-link --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bm-admin' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ADMIN_TOKEN = Deno.env.get('BM_ADMIN_TOKEN') ?? '';

// Constant-time compare so the admin-token check isn't timing-leaky.
function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Persist link to tenants.config.stripe_base_link via service role (bypasses
// RLS). BM runs as anon and can't update tenants directly.
async function saveLinkToTenant(tenantId: string, link: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !tenantId) return { ok: false, reason: 'env or no tenantId' };
  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };
  // 1. Read existing config to merge
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=config`, { headers });
  if (!r1.ok) return { ok: false, reason: 'read failed', status: r1.status };
  const data = await r1.json();
  const cfg = (data && data[0] && data[0].config) || {};
  cfg.stripe_base_link = link;
  // 2. Write back
  const r2 = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ config: cfg })
  });
  if (!r2.ok) {
    const t = await r2.text();
    return { ok: false, reason: 'write failed', status: r2.status, body: t.slice(0, 200) };
  }
  return { ok: true };
}

async function stripeForm(path: string, secretKey: string, params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const json = await r.json();
  if (!r.ok) throw new Error('Stripe ' + path + ' ' + r.status + ': ' + (json?.error?.message || JSON.stringify(json)));
  return json;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { secretKey, successUrl, productName, tenantId } = await req.json();

    if (!secretKey || typeof secretKey !== 'string' || !secretKey.startsWith('sk_')) {
      return new Response(JSON.stringify({ ok: false, error: 'secretKey must start with sk_' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const success = successUrl || 'https://branchmanager.app/paid.html';
    const name = productName || 'Service Invoice';

    // 1. Create product
    const product = await stripeForm('/products', secretKey, { name });

    // 2. Create $0.01/unit price
    const price = await stripeForm('/prices', secretKey, {
      product: product.id,
      unit_amount: '1',  // 1 cent
      currency: 'usd'
    });

    // 3. Create Payment Link with adjustable quantity. BM passes
    //    prefilled_quantity = invoice cents to drive the actual amount.
    //    Initial quantity must be >= 50 because Stripe requires every
    //    Checkout Session total to be at least $0.50 USD; at $0.01/unit
    //    that means qty 50 minimum at link creation time.
    const link = await stripeForm('/payment_links', secretKey, {
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '50',
      'line_items[0][adjustable_quantity][enabled]': 'true',
      'line_items[0][adjustable_quantity][minimum]': '50',
      'line_items[0][adjustable_quantity][maximum]': '999999',
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': success,
      'allow_promotion_codes': 'false'
    });

    // Persist link to tenants.config so pay.html (anon, no localStorage)
    // can read it. Service-role write bypasses RLS.
    let saveResult: any = { ok: false, reason: 'no tenantId' };
    if (tenantId) saveResult = await saveLinkToTenant(tenantId, link.url);

    return new Response(JSON.stringify({ ok: true, url: link.url, productId: product.id, priceId: price.id, paymentLinkId: link.id, tenantSave: saveResult }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('stripe-create-link error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
