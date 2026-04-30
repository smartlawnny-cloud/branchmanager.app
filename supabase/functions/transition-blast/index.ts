// Branch Manager — One-time customer transition blast
// Sends a "we've moved to a new portal" email to every active client with a
// valid email address. Personalized with first name.
//
// SAFETY: defaults to dry_run mode. Caller must explicitly pass {dry_run:false}
// to actually send. Returns full report (attempted, sent, errors).
//
// Deploy:
//   supabase functions deploy transition-blast --no-verify-jwt
//
// Dry run (preview):
//   curl -X POST https://ltpivkqahvplapyagljt.supabase.co/functions/v1/transition-blast \
//     -H "Content-Type: application/json" -d '{"dry_run": true}'
//
// Real send:
//   curl -X POST https://ltpivkqahvplapyagljt.supabase.co/functions/v1/transition-blast \
//     -H "Content-Type: application/json" -d '{"dry_run": false, "confirm": "send-it"}'
//
// The `confirm: "send-it"` gate is a second seatbelt so a stray request
// can't fire 285 emails. Both flags must be set to actually send.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ADMIN_TOKEN    = Deno.env.get('BM_ADMIN_TOKEN') ?? '';
const TENANT_ID      = '93af4348-8bba-4045-ac3e-5e71ec1cc8c5'; // Second Nature
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-bm-admin' };

// Constant-time compare so admin-token check isn't timing-leaky.
function safeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function buildEmail(firstName: string) {
  const text = `Hi ${firstName},

Just a quick note from Doug at Second Nature Tree — we've moved to a new client portal at:

https://branchmanager.app/

Your history — past quotes, invoices, appointments, and property photos — is already there. Future quotes and invoices will come from this address and link you to the new portal directly.

Older emails with "clienthub.getjobber.com" links will still work for a short transition period, but please use branchmanager.app going forward.

To request new work, you can still call or text (914) 391-5233, or use the website form at:
https://branchmanager.app/book.html

Thanks for your continued trust.

— Doug & Catherine
Second Nature Tree Service
(914) 391-5233
peekskilltree.com`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#222;">
  <div style="background:#1a3c12;padding:24px 28px;border-radius:10px 10px 0 0;">
    <div style="color:#fff;font-size:20px;font-weight:800;">Second Nature Tree Service</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Peekskill, NY · (914) 391-5233</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e8e8e8;border-radius:0 0 10px 10px;line-height:1.6;font-size:15px;">
    <p>Hi ${firstName},</p>
    <p>Just a quick note from Doug — we've <strong>moved to a new client portal</strong>:</p>
    <p style="text-align:center;margin:18px 0;">
      <a href="https://branchmanager.app/" style="display:inline-block;background:#1a3c12;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Open my portal</a>
    </p>
    <p>Your history — past quotes, invoices, appointments, and property photos — is already there. Future quotes and invoices will come from this address and link you in directly.</p>
    <p>Older emails with <code>clienthub.getjobber.com</code> links will still work for a short transition period, but please use the new portal going forward.</p>
    <p>To request new work, you can still call or text us at <a href="tel:9143915233" style="color:#1a3c12;font-weight:600;">(914) 391-5233</a>, or use the <a href="https://branchmanager.app/book.html" style="color:#1a3c12;">website form</a>.</p>
    <p>Thanks for your continued trust.</p>
    <p style="margin-top:20px;">— Doug &amp; Catherine<br>Second Nature Tree Service</p>
    <p style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:14px;margin-top:24px;">Licensed &amp; Insured · WC-32079 / PC-50644</p>
  </div>
</div>`;

  return { text, html };
}

async function sendOne(to: string, firstName: string) {
  const { text, html } = buildEmail(firstName);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // RESEND_FROM_EMAIL secret to flip post-Resend-verification:
      //   supabase secrets set RESEND_FROM_EMAIL="Second Nature Tree <info@peekskilltree.com>"
      from: Deno.env.get('RESEND_FROM_EMAIL') ?? 'Second Nature Tree <onboarding@resend.dev>',
      to: [to],
      subject: 'A quick heads-up — Second Nature Tree has a new client portal',
      text,
      html,
      reply_to: 'info@peekskilltree.com'
    })
  });
  if (r.ok) return { ok: true, id: (await r.json()).id };
  return { ok: false, status: r.status, error: (await r.text()).slice(0, 200) };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

  try {
    // Admin gate — was previously gated only on a public "send-it" string. Anyone
    // with the URL could fire 285+ emails. Now requires an x-bm-admin header that
    // matches BM_ADMIN_TOKEN secret. Set via:
    //   supabase secrets set BM_ADMIN_TOKEN=<long-random-string> --project-ref ltpivkqahvplapyagljt
    if (!ADMIN_TOKEN) {
      return json(503, { ok: false, error: 'Server misconfigured: BM_ADMIN_TOKEN env var not set' });
    }
    if (!safeEq(req.headers.get('x-bm-admin') || '', ADMIN_TOKEN)) {
      return json(401, { ok: false, error: 'Unauthorized — missing or invalid x-bm-admin header' });
    }

    const body = await req.json().catch(() => ({}));
    const dry  = body?.dry_run !== false;
    const confirmed = body?.confirm === 'send-it';

    if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: 'Missing env (RESEND_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }
    if (!dry && !confirmed) {
      return json(400, { ok: false, error: 'To send for real, pass both {dry_run:false, confirm:"send-it"}' });
    }

    // Pull eligible clients — has email, not archived, current tenant
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=id,name,first_name,email,archived&tenant_id=eq.${TENANT_ID}&email=neq.&archived=is.false&limit=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (!r.ok) return json(500, { ok: false, error: 'clients fetch ' + r.status });
    const clients = (await r.json()) as Array<{ id: string; name?: string; first_name?: string; email?: string }>;

    // Validate + dedupe by email
    const seen = new Set<string>();
    const eligible = clients
      .filter(c => c.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email!))
      .filter(c => { const k = c.email!.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map(c => ({
        id: c.id,
        email: c.email!,
        firstName: (c.first_name || (c.name || '').split(' ')[0] || 'there').trim()
      }));

    if (dry) {
      return json(200, {
        ok: true,
        dry_run: true,
        eligible_count: eligible.length,
        first_3_previews: eligible.slice(0, 3).map(e => ({
          to: e.email,
          subject: 'A quick heads-up — Second Nature Tree has a new client portal',
          first_line: `Hi ${e.firstName},`
        })),
        next_step: 'Re-call with {dry_run:false, confirm:"send-it"} to actually send.'
      });
    }

    // Real send — sequential with a 250ms gap to stay polite to Resend's rate limit
    const sent: string[] = [];
    const errs: Array<{ email: string; err: string }> = [];
    for (const c of eligible) {
      const res = await sendOne(c.email, c.firstName);
      if (res.ok) sent.push(c.email);
      else errs.push({ email: c.email, err: `${res.status || ''} ${res.error || ''}`.trim() });
      await new Promise(r => setTimeout(r, 250));
    }

    return json(200, {
      ok: true,
      dry_run: false,
      attempted: eligible.length,
      sent: sent.length,
      failed: errs.length,
      errors: errs.slice(0, 20)
    });
  } catch (e) {
    return json(500, { ok: false, error: String((e as Error).message || e) });
  }
});
