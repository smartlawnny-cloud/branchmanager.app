// Diagnostic-only edge function — May 2 2026.
// Calls Dialpad's API with the project's DIALPAD_API_KEY and returns the
// current webhook + subscription state. Doug's BM messaging center has
// 0 inbound SMS today, but Dialpad's UI shows dozens of inbound msgs —
// this function tells us why dialpad-webhook isn't being hit.
//
// Auth: requires X-Admin-Token header matching DIAG_ADMIN_TOKEN secret.
// Will be deleted once diagnosis is done.

const ADMIN_TOKEN = Deno.env.get('DIAG_ADMIN_TOKEN') || '';
const DIALPAD_API_KEY = Deno.env.get('DIALPAD_API_KEY') || '';
const DIALPAD_WEBHOOK_SECRET = Deno.env.get('DIALPAD_WEBHOOK_SECRET') || '';
const DIALPAD_FROM_NUMBER = Deno.env.get('DIALPAD_FROM_NUMBER') || '';

async function dialpadGET(path: string) {
  const r = await fetch('https://dialpad.com/api/v2' + path, {
    headers: { 'Authorization': 'Bearer ' + DIALPAD_API_KEY },
  });
  return { status: r.status, body: await r.text() };
}
async function dialpadJSON(method: string, path: string, body?: unknown) {
  const r = await fetch('https://dialpad.com/api/v2' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + DIALPAD_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.text() };
}

Deno.serve(async (req) => {
  if (req.headers.get('X-Admin-Token') !== ADMIN_TOKEN || !ADMIN_TOKEN) {
    return new Response('forbidden', { status: 403 });
  }
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'status';
  const out: Record<string, unknown> = { action };

  if (action === 'status') {
    out.secrets_present = {
      DIALPAD_API_KEY_len: DIALPAD_API_KEY.length,
      DIALPAD_WEBHOOK_SECRET_len: DIALPAD_WEBHOOK_SECRET.length,
      DIALPAD_FROM_NUMBER,
    };
    out.webhooks = await dialpadGET('/webhooks');
    out.sms_subscriptions = await dialpadGET('/subscriptions/sms');
    out.call_subscriptions = await dialpadGET('/subscriptions/call');
  } else if (action === 'recreate-sms-sub') {
    // Delete existing SMS subscription, create a fresh one. Dialpad
    // auto-disables a subscription's `status` when the webhook returns
    // errors several times in a row — recreating resets that flag.
    const list = await dialpadGET('/subscriptions/sms');
    out.list_before = list;
    try {
      const items = JSON.parse(list.body).items || [];
      for (const it of items) {
        const del = await dialpadJSON('DELETE', `/subscriptions/sms/${it.id}`);
        out[`deleted_${it.id}`] = del;
      }
    } catch (e) { out.delete_err = String(e); }
    // Get webhook id
    const wh = await dialpadGET('/webhooks');
    let webhookId = '';
    try {
      const items = JSON.parse(wh.body).items || [];
      webhookId = items[0]?.id || '';
    } catch (e) { /* */ }
    out.webhookId = webhookId;
    if (webhookId) {
      const created = await dialpadJSON('POST', '/subscriptions/sms', {
        webhook_id: webhookId,
        direction: 'all',
        enabled: true,
      });
      out.created = created;
    }
    out.list_after = await dialpadGET('/subscriptions/sms');
  } else if (action === 'recreate-webhook') {
    // Nuke webhook + all subscriptions, recreate from scratch using the
    // exact secret that's already in DIALPAD_WEBHOOK_SECRET.
    const sub = await dialpadGET('/subscriptions/sms');
    const callSub = await dialpadGET('/subscriptions/call');
    const wh = await dialpadGET('/webhooks');
    out.before = { sub, callSub, wh };
    // Delete subs first (they reference the webhook)
    try {
      const items = JSON.parse(sub.body).items || [];
      for (const it of items) {
        await dialpadJSON('DELETE', `/subscriptions/sms/${it.id}`);
      }
    } catch (_) { /* */ }
    try {
      const items = JSON.parse(callSub.body).items || [];
      for (const it of items) {
        await dialpadJSON('DELETE', `/subscriptions/call/${it.id}`);
      }
    } catch (_) { /* */ }
    // Delete webhooks
    try {
      const items = JSON.parse(wh.body).items || [];
      for (const it of items) {
        const del = await dialpadJSON('DELETE', `/webhooks/${it.id}`);
        out[`deleted_wh_${it.id}`] = del;
      }
    } catch (_) { /* */ }
    // Create fresh webhook
    const newWh = await dialpadJSON('POST', '/webhooks', {
      hook_url: 'https://ltpivkqahvplapyagljt.supabase.co/functions/v1/dialpad-webhook',
      secret: DIALPAD_WEBHOOK_SECRET,
    });
    out.new_webhook = newWh;
    let newWhId = '';
    try { newWhId = JSON.parse(newWh.body).id || ''; } catch (_) { /* */ }
    if (newWhId) {
      out.new_sms_sub = await dialpadJSON('POST', '/subscriptions/sms', {
        webhook_id: newWhId,
        direction: 'all',
        enabled: true,
      });
      out.new_call_sub = await dialpadJSON('POST', '/subscriptions/call', {
        webhook_id: newWhId,
        call_states: ['ringing', 'hangup', 'missed', 'voicemail'],
        enabled: true,
      });
    }
  } else if (action === 'probe') {
    // Probe a bunch of Dialpad endpoints to find any SMS-list one
    const paths = [
      '/sms', '/messages', '/sms/history',
      '/users', '/numbers', '/contacts', '/callcenters',
      '/stats', '/events', '/activity',
    ];
    for (const p of paths) {
      try { out[p] = await dialpadGET(p); } catch (e) { out[p] = String(e); }
    }
  } else if (action === 'list-users') {
    out.users = await dialpadGET('/users?limit=10');
  } else if (action === 'user-messages') {
    const uid = url.searchParams.get('uid') || '';
    out.messages = await dialpadGET(`/users/${uid}/sms?limit=50`);
    out.alt = await dialpadGET(`/users/${uid}/messages?limit=50`);
  } else if (action === 'sms-history') {
    // List recent SMS via Dialpad API to confirm they exist on Dialpad's end.
    out.history = await dialpadGET('/sms?limit=10');
  } else if (action === 'webhook-events') {
    // Some Dialpad accounts expose webhook delivery history.
    out.events = await dialpadGET(`/webhooks/${url.searchParams.get('id')||''}/events?limit=30`);
  } else if (action === 'webhook-attempts') {
    // Try alternate endpoint shape
    out.attempts = await dialpadGET(`/webhooks/${url.searchParams.get('id')||''}/attempts`);
  } else if (action === 'send-test') {
    // Send a test SMS to ourselves to confirm outbound API key works.
    const target = url.searchParams.get('to') || '';
    const text = url.searchParams.get('text') || 'BM debug ping';
    if (!target) {
      out.error = 'pass ?to=+19145551234';
    } else {
      out.send = await dialpadJSON('POST', '/sms', {
        to_numbers: [target],
        from_number: DIALPAD_FROM_NUMBER,
        text,
        infer_country_code: true,
      });
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
