/**
 * Branch Manager — Save Stripe secret key to tenant config
 *
 * Lightweight write-only endpoint. Validates the key format, optionally
 * pings Stripe to verify it's real, then saves to tenants.config.stripe_secret_key
 * via service-role (bypasses RLS).
 *
 * Request:
 *   POST { tenantId, secretKey, verify?: true }
 *
 * Response:
 *   { ok, verified? }
 *
 * Deploy:
 *   supabase functions deploy save-stripe-secret --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const { tenantId, secretKey, verify } = await req.json();
    if (!tenantId || !secretKey) {
      return new Response(JSON.stringify({ ok: false, error: 'tenantId and secretKey required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    if (!secretKey.startsWith('sk_')) {
      return new Response(JSON.stringify({ ok: false, error: 'secretKey must start with sk_' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    let verified: boolean | undefined;
    if (verify) {
      // Ping Stripe to verify the key is real
      const r = await fetch('https://api.stripe.com/v1/balance', {
        headers: { 'Authorization': 'Bearer ' + secretKey }
      });
      verified = r.ok;
      if (!r.ok) {
        return new Response(JSON.stringify({ ok: false, error: 'Stripe rejected key (HTTP ' + r.status + ')' }), {
          status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
        });
      }
    }

    // Read existing config, merge, write back
    const headers = {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
      'Content-Type': 'application/json'
    };
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}&select=config`, { headers });
    if (!r1.ok) throw new Error('tenant read failed: ' + r1.status);
    const data = await r1.json();
    const cfg = (data && data[0] && data[0].config) || {};
    cfg.stripe_secret_key = secretKey;
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/tenants?id=eq.${tenantId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ config: cfg })
    });
    if (!r2.ok) throw new Error('tenant write failed: ' + r2.status);

    return new Response(JSON.stringify({ ok: true, verified }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('save-stripe-secret error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
