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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

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
    const { secretKey, successUrl, productName } = await req.json();

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

    // 3. Create Payment Link with adjustable quantity (BM passes
    //    prefilled_quantity = invoice cents to drive total amount)
    const link = await stripeForm('/payment_links', secretKey, {
      'line_items[0][price]': price.id,
      'line_items[0][quantity]': '1',
      'line_items[0][adjustable_quantity][enabled]': 'true',
      'line_items[0][adjustable_quantity][minimum]': '1',
      'line_items[0][adjustable_quantity][maximum]': '999999',
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': success,
      'allow_promotion_codes': 'false'
    });

    return new Response(JSON.stringify({ ok: true, url: link.url, productId: product.id, priceId: price.id, paymentLinkId: link.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('stripe-create-link error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
