/**
 * Branch Manager — New Request Notification
 * Supabase Edge Function
 *
 * Called by book.html after a customer submits a service request.
 * Sends:
 *   1. SMS alert to Doug (914) 391-5233 via Twilio
 *   2. Email notification to info@peekskilltree.com via Resend
 *   3. Confirmation email to customer (if email provided)
 *
 * Deploy:
 *   supabase functions deploy request-notify --no-verify-jwt
 *
 * Set secrets:
 *   supabase secrets set RESEND_API_KEY=re_...
 *   supabase secrets set TWILIO_ACCOUNT_SID=AC...
 *   supabase secrets set TWILIO_AUTH_TOKEN=...
 *   supabase secrets set TWILIO_FROM=+1XXXXXXXXXX
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Resend is the email provider. SendGrid fallback removed v349 (free tier suits volume,
// cleaner API, Resend trial expires May 22 2026 and we've verified Resend works).
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')     ?? '';
const TWILIO_SID        = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_TOKEN      = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';
const TWILIO_FROM       = Deno.env.get('TWILIO_FROM')        ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')       ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const DEFAULT_TENANT_ID = '93af4348-8bba-4045-ac3e-5e71ec1cc8c5'; // Second Nature
const NOTIFY_PHONE      = '+19143915233'; // Doug
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

// ── DB insert via PostgREST (service-role bypasses RLS) ────────────────────
async function insertRequest(row: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.warn('Supabase env missing; skipping DB insert');
    return { ok: false, reason: 'env' };
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!r.ok) {
    const t = await r.text();
    console.warn('requests insert failed (' + r.status + '):', t.slice(0, 300));
    return { ok: false, reason: 'insert', status: r.status, body: t.slice(0, 300) };
  }
  const d = await r.json();
  return { ok: true, id: Array.isArray(d) ? d[0]?.id : d?.id };
}

// ── SMS via Twilio ─────────────────────────────────────────────────────────
async function sendSMS(to: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;
  const creds = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const form = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
}

// ── Email — Resend ─────────────────────────────────────────────────────────
async function sendEmail(to: string, _toName: string, subject: string, text: string, html?: string) {
  if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set; skipping email'); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      // RESEND_FROM_EMAIL env var lets us flip the From address without redeploy.
      // Default = onboarding@resend.dev (shared sandbox sender, works without
      // domain verification). After GoDaddy transfer + Cloudflare DNS + Resend
      // domain verification (Apr 25 2026 plan), run:
      //   supabase secrets set RESEND_FROM_EMAIL="Second Nature Tree <info@peekskilltree.com>"
      from: Deno.env.get('RESEND_FROM_EMAIL') ?? 'Second Nature Tree <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html: html || undefined,
      reply_to: 'info@peekskilltree.com'
    })
  });
  if (!r.ok) {
    const errTxt = await r.text();
    console.warn('Resend failed (' + r.status + '):', errTxt.slice(0, 200));
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const data = await req.json();
    const { name, phone, email, address, service, details, source } = data;
    const firstName = (name || '').split(' ')[0] || 'Someone';

    // 0. Persist to `requests` table FIRST (service-role bypasses RLS).
    //    Column map — real schema: client_name, client_phone, email, property,
    //    source, status, notes, title, tenant_id, priority, created_at, updated_at.
    //    Service type lives in `title` (no `service` column). Message lives in `notes`.
    const nowIso = new Date().toISOString();
    const insertResult = await insertRequest({
      client_name: name || 'Unknown',
      client_phone: phone || null,
      phone: phone || null,
      email: email || null,
      property: address || null,
      title: service || 'Service request',
      notes: details || null,
      source: source || 'Website form',
      status: 'new',
      priority: 'normal',
      tenant_id: DEFAULT_TENANT_ID,
      created_at: nowIso,
      updated_at: nowIso
    });

    // 1. SMS to Doug
    const smsBody = `🌳 New request!\n${name || '—'} · ${service || 'Tree service'}\n📍 ${address || '—'}\n📞 ${phone || '—'}\nOpen BM: peekskilltree.com/branchmanager/`;
    await sendSMS(NOTIFY_PHONE, smsBody);

    // 2. Email alert to team
    const teamSubject = `🌳 New request — ${service || 'Service'} — ${name}`;
    const teamBody = `New service request submitted via website.\n\nName:    ${name || '—'}\nPhone:   ${phone || '—'}\nEmail:   ${email || '—'}\nAddress: ${address || '—'}\nService: ${service || '—'}\nDetails: ${details || '—'}\n\nView in Branch Manager:\nhttps://peekskilltree.com/branchmanager/`;
    await sendEmail('info@peekskilltree.com', 'Team', teamSubject, teamBody);

    // 3. Confirmation email to customer
    if (email) {
      const custSubject = 'We received your request — Second Nature Tree Service';
      const custText = `Hi ${firstName},\n\nThanks for reaching out! We received your request for ${service || 'tree service'} at ${address || 'your property'}.\n\nWe typically respond within 2 hours during business hours. We'll call or text you at ${phone || 'the number you provided'} to set up a free estimate.\n\nQuestions? Reply to this email or call/text (914) 391-5233.\n\n— Doug & Catherine\nSecond Nature Tree Service\nPeekskill, NY · Licensed & Insured · WC-32079 / PC-50644\npeekskilltree.com`;

      const custHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;">
  <div style="background:#1a3c12;padding:24px 28px;border-radius:10px 10px 0 0;">
    <div style="color:#fff;font-size:22px;font-weight:800;">🌳 Second Nature Tree Service</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">Peekskill, NY · (914) 391-5233</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e8e8e8;border-radius:0 0 10px 10px;">
    <h2 style="color:#1a3c12;font-size:20px;margin:0 0 12px;">Request Received! ✅</h2>
    <p style="color:#444;font-size:15px;line-height:1.6;">Hi ${firstName},</p>
    <p style="color:#444;font-size:15px;line-height:1.6;">Thanks for reaching out! We got your request for <strong>${service || 'tree service'}</strong> at <strong>${address || 'your property'}</strong>.</p>
    <div style="background:#f0f7f0;border-left:3px solid #1a3c12;border-radius:0 8px 8px 0;padding:14px 16px;margin:16px 0;font-size:14px;color:#333;">
      We typically respond within <strong>2 hours</strong> during business hours.<br>
      We'll reach out at <strong>${phone || 'the number you provided'}</strong> to schedule your free estimate.
    </div>
    <p style="color:#444;font-size:15px;line-height:1.6;">Questions? Reply to this email or call/text us directly:</p>
    <a href="tel:9143915233" style="display:inline-block;background:#1a3c12;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-top:4px;">📞 (914) 391-5233</a>
    <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">Second Nature Tree Service · Peekskill, NY · Licensed & Insured · WC-32079 / PC-50644</p>
  </div>
</div>`;

      await sendEmail(email, firstName, custSubject, custText, custHtml);
    }

    return new Response(JSON.stringify({ ok: true, inserted: insertResult }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('request-notify error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
