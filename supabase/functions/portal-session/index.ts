// portal-session — validate a portal token and return client data
// POST { token } → validates session → returns { client, invoices, quotes, jobs }
// Deploy: supabase functions deploy portal-session --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors("", 200);
  if (req.method !== "POST") return cors(JSON.stringify({ error: "Method not allowed" }), 405);

  let token: string;
  try {
    const body = await req.json();
    token = (body.token || "").trim();
  } catch {
    return cors(JSON.stringify({ error: "Invalid JSON" }), 400);
  }

  if (!token) return cors(JSON.stringify({ error: "Token required" }), 400);

  // Validate session
  const { data: session } = await sb
    .from("portal_sessions")
    .select("id, client_id, email, expires_at")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!session) return cors(JSON.stringify({ error: "Invalid or expired session" }), 401);

  // Touch last_used_at
  sb.from("portal_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id).then(() => {});

  const cid = session.client_id;

  // Fetch all client data in parallel
  const [clientRes, invoicesRes, quotesRes, jobsRes, photosRes] = await Promise.all([
    sb.from("clients").select("id,name,email,phone,address,city,state,zip,notes").eq("id", cid).maybeSingle(),
    sb.from("invoices").select("id,number,total,balance,status,due_date,created_at,description,line_items").eq("client_id", cid).order("created_at", { ascending: false }).limit(50),
    sb.from("quotes").select("id,number,total,status,created_at,description,line_items,valid_until").eq("client_id", cid).order("created_at", { ascending: false }).limit(30),
    sb.from("jobs").select("id,title,status,scheduled_date,completed_date,description,notes,crew").eq("client_id", cid).order("scheduled_date", { ascending: false }).limit(30),
    sb.from("photos").select("id,url,caption,job_id,created_at,before_after").eq("client_id", cid).order("created_at", { ascending: false }).limit(40),
  ]);

  return cors(JSON.stringify({
    ok: true,
    client: clientRes.data,
    invoices: invoicesRes.data || [],
    quotes: quotesRes.data || [],
    jobs: jobsRes.data || [],
    photos: photosRes.data || [],
  }));
});
