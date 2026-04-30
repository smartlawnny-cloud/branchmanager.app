// Dialpad webhook receiver — logs inbound calls, SMS, voicemails into Supabase.
//
// Deploy:
//   supabase functions deploy dialpad-webhook --no-verify-jwt
//
// Then in Dialpad admin → Automations → Webhooks, add:
//   https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/dialpad-webhook
//   Events: call.ringing, call.completed, sms.received, voicemail.created
//   Secret: (set as DIALPAD_WEBHOOK_SECRET env var in Supabase)
//
// Table expected:
//   CREATE TABLE communications (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
//     channel text NOT NULL,         -- 'call' | 'sms' | 'voicemail'
//     direction text NOT NULL,        -- 'inbound' | 'outbound'
//     from_number text,
//     to_number text,
//     duration_seconds int,
//     body text,                      -- sms body or voicemail transcript
//     recording_url text,
//     status text,                    -- 'ringing' | 'completed' | 'missed' etc.
//     dialpad_id text UNIQUE,
//     metadata jsonb,
//     created_at timestamptz DEFAULT now()
//   );
//   CREATE INDEX idx_comms_client ON communications(client_id);
//   CREATE INDEX idx_comms_created ON communications(created_at DESC);

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("DIALPAD_WEBHOOK_SECRET") || "";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function normPhone(n?: string): string {
  if (!n) return "";
  return String(n).replace(/\D/g, "").slice(-10);
}

async function findClientByPhone(phone: string): Promise<string | null> {
  const p = normPhone(phone);
  if (p.length < 7) return null;
  // Try last-10-digits match against clients.phone
  const { data } = await sb
    .from("clients")
    .select("id, phone")
    .ilike("phone", `%${p}%`)
    .limit(1);
  return data && data.length ? data[0].id : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Shared-secret check. Was using .includes() which let any header with the
  // secret embedded ("prefix-SECRET-suffix") pass auth — exact match now.
  // Strip "Bearer " prefix on Authorization header before comparing.
  if (WEBHOOK_SECRET) {
    const raw = req.headers.get("x-dialpad-signature") || req.headers.get("authorization") || "";
    const got = raw.replace(/^Bearer\s+/i, "").trim();
    if (got !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const event: string = payload.event_type || payload.event || "unknown";
  const data = payload.data || payload;

  // Normalize across Dialpad event shapes
  let row: any = {
    channel: "call",
    direction: "inbound",
    from_number: data.from_number || data.external_number || data.from || null,
    to_number: data.to_number || data.internal_number || data.to || null,
    duration_seconds: data.duration || null,
    body: null,
    recording_url: data.recording_url || null,
    status: data.state || event,
    dialpad_id: String(data.call_id || data.id || data.uuid || `${event}-${Date.now()}`),
    metadata: payload,
  };

  if (event.startsWith("sms")) {
    row.channel = "sms";
    row.direction = data.direction === "outbound" ? "outbound" : "inbound";
    row.body = data.text || data.message || data.body || null;
  } else if (event.startsWith("voicemail")) {
    row.channel = "voicemail";
    row.body = data.transcription || data.transcript || null;
  } else if (event.startsWith("call")) {
    row.channel = "call";
    row.direction = data.direction === "outbound" ? "outbound" : "inbound";
  }

  // Try to auto-link to a client by phone number
  const lookupPhone = row.direction === "inbound" ? row.from_number : row.to_number;
  if (lookupPhone) {
    row.client_id = await findClientByPhone(lookupPhone);
  }

  // ── TCPA opt-out keyword handling for inbound SMS.
  // STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT → opt out
  // START/UNSTOP/YES → opt back in
  // HELP/INFO → help reply
  // Always still log the inbound message; just stamp metadata.note + try to
  // patch clients.sms_opt_out when sender matches a known client.
  if (row.channel === "sms" && row.direction === "inbound") {
    const TENANT_ID = "93af4348-8bba-4045-ac3e-5e71ec1cc8c5"; // Second Nature Tree
    const raw = (row.body || "").trim().toUpperCase();
    var keyword = "";
    if (raw === "STOP" || raw === "STOPALL" || raw === "UNSUBSCRIBE" || raw === "CANCEL" || raw === "END" || raw === "QUIT") {
      keyword = "STOP";
    } else if (raw === "START" || raw === "UNSTOP" || raw === "YES") {
      keyword = "START";
    } else if (raw === "HELP" || raw === "INFO") {
      keyword = "HELP";
    }

    if (keyword) {
      var autoReply = "";
      if (keyword === "STOP") {
        autoReply = "You're unsubscribed. Reply START to opt back in.";
      } else if (keyword === "START") {
        autoReply = "You're opted back in. Reply STOP to unsubscribe.";
      } else if (keyword === "HELP") {
        autoReply = "Second Nature Tree Service. Reply STOP to unsubscribe. Standard msg/data rates may apply. Call (914) 391-5233.";
      }

      // Patch clients.sms_opt_out for matched client (by last-10 phone)
      if (keyword === "STOP" || keyword === "START") {
        const last10 = normPhone(row.from_number);
        if (last10.length >= 10) {
          const optOut = keyword === "STOP";
          const patchUrl = `${SUPABASE_URL}/rest/v1/clients?phone=ilike.*${last10}*&tenant_id=eq.${TENANT_ID}`;
          try {
            await fetch(patchUrl, {
              method: "PATCH",
              headers: {
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
              },
              body: JSON.stringify({
                sms_opt_out: optOut,
                sms_opt_out_at: optOut ? new Date().toISOString() : null,
              }),
            });
          } catch (e) {
            console.warn("sms_opt_out patch failed:", e);
          }
        }
      }

      // Stamp note into metadata so it surfaces in Doug's comms log
      row.metadata = Object.assign({}, row.metadata || {}, {
        note: keyword + " keyword",
        auto_reply_pending: autoReply,
      });

      // TODO: Wire actual outbound auto-reply via Dialpad SMS API
      // (dialpad-sms-send function). For now we log the intended reply text
      // in metadata.auto_reply_pending so it's auditable.
      console.log("TCPA keyword:", keyword, "from", row.from_number, "would auto-reply with:", autoReply);
    }
  }

  // Upsert (idempotent on dialpad_id)
  const { error } = await sb
    .from("communications")
    .upsert(row, { onConflict: "dialpad_id" });

  if (error) {
    console.error("dialpad-webhook insert failed:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // ── Auto-create a BM request for inbound voicemails or missed inbound calls.
  // This surfaces phone leads in the Requests page without manual entry.
  let requestId: string | null = null;
  const isMissedInbound = row.direction === "inbound" && (
    row.channel === "voicemail" ||
    (row.channel === "call" && (row.status === "missed" || row.status === "no-answer" || row.status === "voicemail"))
  );
  if (isMissedInbound) {
    const TENANT_ID = "93af4348-8bba-4045-ac3e-5e71ec1cc8c5"; // Second Nature Tree
    const callerName = data.from_name || data.contact_name || data.caller_name || "Phone caller";
    const transcript = row.body || "";
    const noteParts: string[] = [];
    if (transcript) noteParts.push("Voicemail transcript:\n" + transcript);
    if (row.recording_url) noteParts.push("Recording: " + row.recording_url);
    noteParts.push(`Source: Dialpad ${row.channel} on ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
    const reqRow: Record<string, unknown> = {
      tenant_id: TENANT_ID,
      client_id: row.client_id || null,
      client_name: callerName,
      client_phone: row.from_number,
      title: row.channel === "voicemail" ? "Voicemail from " + callerName : "Missed call from " + callerName,
      notes: noteParts.join("\n\n"),
      status: "new",
      source: "Phone (Dialpad)",
    };
    const { data: insData, error: insErr } = await sb
      .from("requests")
      .insert(reqRow)
      .select("id")
      .single();
    if (insErr) {
      console.warn("auto-request insert failed:", insErr.message);
    } else {
      requestId = insData?.id || null;
    }
  }

  // ── Doug-alert email on every inbound ────────────────────────────────
  // Doug previously had zero notification when calls/SMS came in. Fires a
  // Resend email to info@peekskilltree.com summarizing the inbound + linking
  // to BM. Cheap (~free at this volume), works even when BM is closed.
  // SMS alert via Dialpad outbound is deferred until DIALPAD_API_TOKEN is set.
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    if (RESEND_API_KEY) {
      const labelMap: Record<string, string> = {
        call: row.status === "missed" || row.status === "no_answer" ? "📵 Missed call" : "📞 Inbound call",
        voicemail: "📭 Voicemail",
        sms: "💬 SMS received",
        email: "✉️ Email",
      };
      const label = labelMap[row.channel] || "📞 Inbound";
      const callerName = data.from_name || data.contact_name || data.caller_name || row.from_number || "Unknown";
      const phoneFmt = row.from_number ? row.from_number.replace(/^\+?1?(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "";
      const bodyLine = (row.body || "").slice(0, 280);
      const subject = `${label} — ${callerName}${phoneFmt ? " · " + phoneFmt : ""}`;
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;">
  <div style="background:#1a3c12;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;">
    <div style="font-size:16px;font-weight:700;">${label}</div>
    <div style="font-size:13px;opacity:.85;margin-top:2px;">${callerName}${phoneFmt ? " · " + phoneFmt : ""}</div>
  </div>
  <div style="background:#fff;padding:20px 22px;border:1px solid #e8e8e8;border-radius:0 0 10px 10px;font-size:14px;line-height:1.5;color:#333;">
    ${bodyLine ? `<p style="background:#f8faf8;border-left:3px solid #1a3c12;padding:10px 14px;border-radius:0 8px 8px 0;margin:0 0 14px;white-space:pre-wrap;">${bodyLine.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` : ""}
    <p style="margin:0 0 6px;color:#666;font-size:12px;">${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
    <a href="https://branchmanager.app/" style="display:inline-block;background:#1a3c12;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin-top:8px;">Open Branch Manager</a>
  </div>
</div>`;
      const text = `${label}\n${callerName}${phoneFmt ? " · " + phoneFmt : ""}\n\n${bodyLine}\n\nOpen BM: https://branchmanager.app/`;
      // Fire-and-forget so a Resend hiccup doesn't 500 the webhook (Dialpad would retry).
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM_EMAIL") ?? "Second Nature Tree <onboarding@resend.dev>",
          to: ["info@peekskilltree.com"],
          subject,
          text,
          html,
          reply_to: "info@peekskilltree.com",
        }),
      }).catch((e) => console.warn("doug-alert email failed:", e));
    }
  } catch (e) {
    console.warn("doug-alert wrap failed:", e);
  }

  return new Response(JSON.stringify({ ok: true, matched_client: !!row.client_id, request_id: requestId }), {
    headers: { "content-type": "application/json" },
  });
});
