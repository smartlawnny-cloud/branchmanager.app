// portal-auth — send magic-link login email to a client
// POST { email } → finds client by email → creates 7-day session → emails link via Resend
// Deploy: supabase functions deploy portal-auth --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Second Nature Tree <info@peekskilltree.com>";
const PORTAL_BASE = "https://branchmanager.app/portal.html";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function cors(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    },
  });
}

function randomToken(len = 48): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors("", 200);
  if (req.method === "GET" || req.method === "HEAD") return cors("portal-auth ok", 200);
  if (req.method !== "POST") return cors(JSON.stringify({ error: "Method not allowed" }), 405);

  let email: string;
  try {
    const body = await req.json();
    email = (body.email || "").trim().toLowerCase();
  } catch {
    return cors(JSON.stringify({ error: "Invalid JSON" }), 400);
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return cors(JSON.stringify({ error: "Valid email required" }), 400);
  }

  // Look up client by email
  const { data: clients } = await sb
    .from("clients")
    .select("id, name, email")
    .ilike("email", email)
    .limit(1);

  if (!clients || clients.length === 0) {
    // Return success anyway to avoid email enumeration
    return cors(JSON.stringify({ ok: true }));
  }

  const client = clients[0];
  const token = randomToken();

  // Store session
  await sb.from("portal_sessions").insert({
    client_id: client.id,
    token,
    email: client.email || email,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const portalLink = `${PORTAL_BASE}?t=${token}`;
  const firstName = (client.name || "").split(" ")[0] || "there";

  // Send email via Resend
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [client.email || email],
      subject: "Your Second Nature Tree portal link",
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#1d1d1f;">
          <div style="background:#1a3c12;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;margin-bottom:0;">
            <div style="font-size:20px;font-weight:700;">🌳 Second Nature Tree</div>
            <div style="font-size:13px;opacity:.75;margin-top:4px;">Customer Portal</div>
          </div>
          <div style="background:#fff;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 10px 10px;padding:28px 24px;">
            <p style="font-size:16px;margin:0 0 20px;">Hi ${firstName},</p>
            <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
              Here's your secure link to view your quotes, invoices, and job history — and pay any outstanding balance online.
            </p>
            <a href="${portalLink}" style="display:inline-block;background:#1a3c12;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
              Open My Portal →
            </a>
            <p style="font-size:12px;color:#888;margin-top:24px;line-height:1.5;">
              This link is valid for 7 days. If you didn't request this, you can safely ignore this email.
            </p>
          </div>
        </div>
      `,
    }),
  });

  return cors(JSON.stringify({ ok: true }));
});
