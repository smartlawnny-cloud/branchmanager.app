// Supabase Edge Function — Resend Email Proxy
// Solves CORS: browser → this function → Resend API
//
// v372: migrated SendGrid → Resend (SendGrid trial ends May 22, 2026; Resend
// is free at our volume and request-notify already uses it successfully).
// Old `apiKey` parameter is still accepted for backwards-compat but ignored —
// Resend key lives only as a server-side secret.
//
// Deploy: supabase functions deploy send-email --no-verify-jwt
// Secret: supabase secrets set RESEND_API_KEY=re_...

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response('send-email ok', { status: 200, headers: CORS_HEADERS })
  }

  try {
    const { to, subject, html, text, from, replyTo } = await req.json()

    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, html or text' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'No Resend API key configured (set RESEND_API_KEY secret)' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Default from-address resolution order:
    //   1. Caller-supplied `from` (if it has an @)
    //   2. RESEND_FROM_EMAIL env var (set post-Resend-verification: `supabase secrets set RESEND_FROM_EMAIL="..."`)
    //   3. onboarding@resend.dev sandbox sender (works without verified domain)
    const defaultFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Second Nature Tree <onboarding@resend.dev>'
    const fromAddr = from && from.includes('@') ? from : defaultFrom
    const recipients = Array.isArray(to) ? to : [to]

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: recipients,
        subject,
        text: text || undefined,
        html: html || undefined,
        reply_to: replyTo || 'info@peekskilltree.com',
      }),
    })

    if (r.ok) {
      const d = await r.json().catch(() => ({}))
      return new Response(JSON.stringify({ success: true, status: r.status, id: d?.id }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const errText = await r.text()
    return new Response(JSON.stringify({ error: 'Resend error', status: r.status, details: errText.slice(0, 500) }), {
      status: r.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
