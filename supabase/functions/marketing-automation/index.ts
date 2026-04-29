// Supabase Edge Function — Marketing Automation
//
// Triggers:
//   1. Review request email  — 24h after job marked completed
//   2. Quote follow-up email — 7 days after quote sent with no response
//   3. Upsell email          — 30 days after invoice paid
//
// Each trigger is idempotent: checks communications table before sending.
// Logs every send to communications.metadata so duplicates are impossible.
//
// Deploy:
//   supabase functions deploy marketing-automation --no-verify-jwt
//
// Schedule via pg_cron (run once from Supabase SQL editor):
//   select cron.schedule('marketing-automation', '0 */4 * * *',
//     $$select net.http_post(
//       'https://ltpivkqahvplapyagljt.supabase.co/functions/v1/marketing-automation',
//       '{}',
//       'application/json',
//       ARRAY[http_header('Authorization','Bearer <SERVICE_ROLE_KEY>')]
//     )$$);
//
// Env secrets needed:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL (optional)
//
// Manual test from BM Settings → Automations → "Run Now" button:
//   POST /functions/v1/marketing-automation  (with Authorization: Bearer <anon key>)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY     = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL         = Deno.env.get("RESEND_FROM_EMAIL") ?? "Second Nature Tree <onboarding@resend.dev>";
const REPLY_TO           = "info@peekskilltree.com";
const GOOGLE_REVIEW_URL  = "https://g.page/r/CcVkZHV_EKlEEBM/review";
const COMPANY_NAME       = "Second Nature Tree Service";
const COMPANY_PHONE      = "(914) 391-5233";
const OWNER_NAME         = "Doug Brown";

// Toggle individual triggers via Supabase secrets (default: enabled)
const REVIEW_ENABLED        = Deno.env.get("AUTOMATION_REVIEW")        !== "false";
const QUOTE_FOLLOWUP_ENABLED = Deno.env.get("AUTOMATION_QUOTE_FOLLOWUP") !== "false";
const UPSELL_ENABLED        = Deno.env.get("AUTOMATION_UPSELL")        !== "false";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.warn("No RESEND_API_KEY — skipping email to", to); return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: REPLY_TO }),
  });
  if (!r.ok) { console.error("Resend error", r.status, await r.text().catch(() => "")); return false; }
  return true;
}

async function alreadySent(triggerType: string, recordId: string): Promise<boolean> {
  const { data } = await sb
    .from("communications")
    .select("id")
    .eq("channel", "email")
    .eq("direction", "outbound")
    .contains("metadata", { trigger: triggerType, record_id: recordId })
    .limit(1);
  return !!(data && data.length > 0);
}

async function logSend(clientId: string | null, triggerType: string, recordId: string, toEmail: string, subject: string) {
  await sb.from("communications").insert({
    client_id:  clientId || null,
    channel:    "email",
    direction:  "outbound",
    status:     "sent",
    body:       subject,
    metadata:   { trigger: triggerType, record_id: recordId, to: toEmail },
  });
}

function esc(s: string): string {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function emailHtml(bodyText: string): string {
  const lines = bodyText.split("\n").map(l => `<p style="margin:0 0 10px;">${esc(l) || "&nbsp;"}</p>`).join("");
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:15px;color:#333;max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#1a3c12;padding:16px 24px;border-radius:8px 8px 0 0;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${esc(COMPANY_NAME)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      ${lines}
    </div>
    <div style="font-size:11px;color:#999;text-align:center;margin-top:16px;">
      ${esc(COMPANY_NAME)} · ${esc(COMPANY_PHONE)} · <a href="mailto:${esc(REPLY_TO)}" style="color:#999;">${esc(REPLY_TO)}</a>
    </div>
  </body></html>`;
}

// ─── Trigger 1: Review request (24h after job completed) ──────────────────────

async function runReviewRequests(): Promise<{ sent: number; skipped: number }> {
  if (!REVIEW_ENABLED) return { sent: 0, skipped: 0 };

  const since = new Date(Date.now() - 28 * 3600_000).toISOString();
  const until = new Date(Date.now() - 20 * 3600_000).toISOString();

  const { data: jobs, error } = await sb
    .from("jobs")
    .select("id, client_id, client_name, job_number, description, total, updated_at")
    .eq("status", "completed")
    .gte("updated_at", since)
    .lte("updated_at", until);

  if (error) { console.error("jobs query error:", error.message); return { sent: 0, skipped: 0 }; }
  if (!jobs || jobs.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const job of jobs) {
    if (await alreadySent("review_request", job.id)) { skipped++; continue; }

    // Get client email
    let email = "";
    let firstName = (job.client_name || "").split(" ")[0] || "there";
    if (job.client_id) {
      const { data: cl } = await sb.from("clients").select("email, name").eq("id", job.client_id).single();
      if (cl?.email) { email = cl.email; firstName = (cl.name || "").split(" ")[0] || firstName; }
    }
    if (!email) { skipped++; continue; }

    const jobNum   = job.job_number ? `#${job.job_number}` : "";
    const jobDesc  = job.description || "your tree service";
    const subject  = "Your tree work is complete — how did we do?";
    const body =
      `Hi ${firstName},\n\n` +
      `We have finished the work at your property! Job ${jobNum} (${jobDesc}) is now complete.\n\n` +
      `We hope everything looks great. If you notice anything that needs attention, please let us know right away and we will take care of it.\n\n` +
      `If you were happy with the service, it would mean a lot if you could leave us a quick Google review. It only takes a minute and really helps our small business:\n\n` +
      `${GOOGLE_REVIEW_URL}\n\n` +
      `Thank you for choosing ${COMPANY_NAME}. We appreciate your business and hope to work with you again!\n\n` +
      `${OWNER_NAME}\n` +
      `${COMPANY_PHONE}`;

    const ok = await sendEmail(email, subject, emailHtml(body));
    if (ok) {
      await logSend(job.client_id, "review_request", job.id, email, subject);
      sent++;
    }
  }

  return { sent, skipped };
}

// ─── Trigger 2: Quote follow-up (7 days after sent, no response) ─────────────

async function runQuoteFollowups(): Promise<{ sent: number; skipped: number }> {
  if (!QUOTE_FOLLOWUP_ENABLED) return { sent: 0, skipped: 0 };

  const since = new Date(Date.now() - 8 * 86400_000).toISOString();
  const until = new Date(Date.now() - 6 * 86400_000).toISOString();

  const { data: quotes, error } = await sb
    .from("quotes")
    .select("id, client_id, client_name, quote_number, description, total, updated_at, expiry_date")
    .eq("status", "sent")
    .gte("updated_at", since)
    .lte("updated_at", until);

  if (error) { console.error("quotes query error:", error.message); return { sent: 0, skipped: 0 }; }
  if (!quotes || quotes.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const q of quotes) {
    if (await alreadySent("quote_followup_7d", q.id)) { skipped++; continue; }

    let email = "";
    let firstName = (q.client_name || "").split(" ")[0] || "there";
    if (q.client_id) {
      const { data: cl } = await sb.from("clients").select("email, name").eq("id", q.client_id).single();
      if (cl?.email) { email = cl.email; firstName = (cl.name || "").split(" ")[0] || firstName; }
    }
    if (!email) { skipped++; continue; }

    const quoteNum  = q.quote_number ? `#${q.quote_number}` : "";
    const total     = q.total ? `$${Number(q.total).toLocaleString("en-US", { minimumFractionDigits: 0 })}` : "";
    const jobDesc   = q.description || "your tree service";
    const sentDate  = new Date(q.updated_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const subject   = `Following up on your tree service quote ${quoteNum}`;
    const body =
      `Hi ${firstName},\n\n` +
      `I wanted to follow up on the estimate we put together for you on ${sentDate} for ${jobDesc}.\n\n` +
      `Your quote (${quoteNum}) came to ${total}. If you have any questions about the scope of work or pricing, I am happy to walk through it with you.\n\n` +
      `We have availability coming up soon and would love to get you on the schedule. Just reply to this email or give us a call at ${COMPANY_PHONE} to get started.\n\n` +
      `Thanks,\n` +
      `${OWNER_NAME}\n` +
      `${COMPANY_NAME}\n` +
      `${COMPANY_PHONE}`;

    const ok = await sendEmail(email, subject, emailHtml(body));
    if (ok) {
      await logSend(q.client_id, "quote_followup_7d", q.id, email, subject);
      sent++;
    }
  }

  return { sent, skipped };
}

// ─── Trigger 3: Upsell (30 days after invoice paid) ──────────────────────────

async function runUpsells(): Promise<{ sent: number; skipped: number }> {
  if (!UPSELL_ENABLED) return { sent: 0, skipped: 0 };

  const since = new Date(Date.now() - 31 * 86400_000).toISOString();
  const until = new Date(Date.now() - 29 * 86400_000).toISOString();

  // Try paid_date first, fall back to updated_at for invoices without it
  const { data: invoices, error } = await sb
    .from("invoices")
    .select("id, client_id, client_name, invoice_number, total, paid_date, updated_at")
    .eq("status", "paid")
    .or(`paid_date.gte.${since},and(paid_date.is.null,updated_at.gte.${since})`)
    .or(`paid_date.lte.${until},and(paid_date.is.null,updated_at.lte.${until})`);

  if (error) { console.error("invoices query error:", error.message); return { sent: 0, skipped: 0 }; }
  if (!invoices || invoices.length === 0) return { sent: 0, skipped: 0 };

  let sent = 0, skipped = 0;

  for (const inv of invoices) {
    if (await alreadySent("upsell_30d", inv.id)) { skipped++; continue; }

    let email = "";
    let firstName = (inv.client_name || "").split(" ")[0] || "there";
    if (inv.client_id) {
      const { data: cl } = await sb.from("clients").select("email, name").eq("id", inv.client_id).single();
      if (cl?.email) { email = cl.email; firstName = (cl.name || "").split(" ")[0] || firstName; }
    }
    if (!email) { skipped++; continue; }

    const invoiceNum = inv.invoice_number ? `#${inv.invoice_number}` : "";
    const subject    = `Ready for your next tree service, ${firstName}?`;
    const body =
      `Hi ${firstName},\n\n` +
      `It has been about a month since we completed your job (invoice ${invoiceNum}). Hope everything at your property is looking great!\n\n` +
      `Spring and summer are our busiest seasons — if you have been thinking about any additional tree work (pruning, removal, stump grinding, cleanups), now is a great time to get on the schedule before the calendar fills up.\n\n` +
      `Just reply to this email or give us a call at ${COMPANY_PHONE} and we can get you a quick estimate.\n\n` +
      `And if you know anyone who needs tree work, we appreciate the referral — word of mouth is how we have built our business.\n\n` +
      `Thanks again,\n` +
      `${OWNER_NAME}\n` +
      `${COMPANY_NAME}\n` +
      `${COMPANY_PHONE}`;

    const ok = await sendEmail(email, subject, emailHtml(body));
    if (ok) {
      await logSend(inv.client_id, "upsell_30d", inv.id, email, subject);
      sent++;
    }
  }

  return { sent, skipped };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const startMs = Date.now();
  console.log("marketing-automation: starting run at", new Date().toISOString());

  const [review, followup, upsell] = await Promise.all([
    runReviewRequests(),
    runQuoteFollowups(),
    runUpsells(),
  ]);

  const result = {
    ran_at:   new Date().toISOString(),
    duration: Date.now() - startMs,
    review_requests:   review,
    quote_followups:   followup,
    upsells:           upsell,
    total_sent: review.sent + followup.sent + upsell.sent,
  };

  console.log("marketing-automation: done", JSON.stringify(result));

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
