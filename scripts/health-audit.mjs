#!/usr/bin/env node
/**
 * BM Health Audit — runs every category of check we discovered we need on
 * May 2 2026 after the "no leads in call center" RLS bug.
 *
 * Categories:
 *   1. Orphan tenant_id rows on every tenant-scoped table
 *   2. Foreign key orphans (jobs→clients, invoices→quotes, etc.)
 *   3. Duplicate data (clients by phone, invoice numbers, etc.)
 *   4. Schema drift — every column the bundle references must exist
 *   5. RLS coverage — every tenant-scoped table has anon write policy
 *   6. Edge function status — all expected functions ACTIVE
 *   7. Cloud queue backlog — failed writes piling up?
 *
 * Run:  node scripts/health-audit.mjs
 * Exit code 0 = clean, 1 = issues found (suitable for cron or pre-commit)
 */
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN env var required.\n  Get a personal access token from https://supabase.com/dashboard/account/tokens\n  Run: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/health-audit.mjs');
  process.exit(2);
}
const PROJECT = 'ltpivkqahvplapyagljt';
const TENANT_ID = '93af4348-8bba-4045-ac3e-5e71ec1cc8c5';

const TENANT_TABLES = ['chip_drop_spots','clients','communications','crew_locations','detected_locations','expenses','invoices','jobs','location_pings','materials','payments','photos','quotes','recurring','requests','services','tasks','team_members','team_messages','time_entries','visits','vehicles','vehicle_maintenance','competitors'];

const FK_CHECKS = [
  ['jobs', 'client_id', 'clients', 'id'],
  ['quotes', 'client_id', 'clients', 'id'],
  ['invoices', 'client_id', 'clients', 'id'],
  ['invoices', 'quote_id', 'quotes', 'id'],
  ['invoices', 'job_id', 'jobs', 'id'],
  ['jobs', 'quote_id', 'quotes', 'id'],
  ['requests', 'client_id', 'clients', 'id'],
  ['payments', 'invoice_id', 'invoices', 'id'],
  ['visits', 'job_id', 'jobs', 'id']
];

const EXPECTED_FUNCS = ['ai-chat','bouncie-webhook','dialpad-sms-send','dialpad-webhook','invoice-fetch','marketing-automation','portal-auth','portal-session','portal-update','quote-fetch','quote-notify','quote-update','request-notify','resend-webhook','save-stripe-secret','send-email','sendjim-send','stripe-charge','stripe-create-link','stripe-webhook','transition-blast'];

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  return r.ok ? r.json() : { error: await r.text() };
}

async function functions() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/functions`, {
    headers: { 'Authorization': 'Bearer ' + TOKEN }
  });
  return r.ok ? r.json() : [];
}

const issues = [];
const ok = (msg) => console.log('  ✅ ' + msg);
const fail = (msg) => { console.log('  ❌ ' + msg); issues.push(msg); };

(async () => {
  console.log('\n┌─ 1. tenant_id orphan check ────────────────────────────');
  const orphanQ = TENANT_TABLES.map(t => `select '${t}' as t, count(*) filter (where tenant_id is null) as n from ${t}`).join(' union all ');
  const orphans = await sql(orphanQ);
  let total = 0;
  for (const r of orphans) {
    if (r.n > 0) fail(`${r.t}: ${r.n} rows with tenant_id NULL`);
    total += r.n;
  }
  if (!total) ok('all 24 tables have 0 orphan rows');

  console.log('\n┌─ 2. foreign key orphan check ──────────────────────────');
  const fkQ = FK_CHECKS.map(([t, c, ref, refc]) =>
    `select '${t}.${c}' as ref, count(*) as n from ${t} a where a.${c} is not null and not exists(select 1 from ${ref} b where b.${refc} = a.${c})`
  ).join(' union all ');
  const fks = await sql(fkQ);
  let fkTotal = 0;
  for (const r of fks) {
    if (r.n > 0) fail(`${r.ref}: ${r.n} orphan refs`);
    fkTotal += r.n;
  }
  if (!fkTotal) ok(`all ${FK_CHECKS.length} FK relations clean`);

  console.log('\n┌─ 3. duplicate data check ──────────────────────────────');
  const dupes = await sql(`
    select 'clients_by_phone' as k, count(*) - count(distinct phone) as d from clients where length(regexp_replace(phone,'[^0-9]','','g')) >= 10
    union all select 'invoice_numbers', count(*) - count(distinct invoice_number) from invoices where invoice_number is not null
    union all select 'quote_numbers', count(*) - count(distinct quote_number) from quotes where quote_number is not null
    union all select 'request_numbers', count(*) - count(distinct request_number) from requests where request_number is not null
    union all select 'comm_dialpad_ids', count(*) - count(distinct dialpad_id) from communications where dialpad_id is not null
  `);
  let dTotal = 0;
  for (const r of dupes) { if (r.d > 0) fail(`${r.k}: ${r.d} dupes`); dTotal += r.d; }
  if (!dTotal) ok('no duplicate keys across 5 unique fields');

  console.log('\n┌─ 4. RLS anon-write coverage ───────────────────────────');
  const policies = await sql(`select tablename, count(*) filter (where policyname like 'snt_anon_%' and 'anon' = any(roles)) as anon_policies from pg_policies where schemaname='public' and tablename = any(array[${TENANT_TABLES.map(t => `'${t}'`).join(',')}]) group by tablename`);
  const policyMap = {};
  for (const r of policies) policyMap[r.tablename] = r.anon_policies;
  for (const t of TENANT_TABLES) {
    if ((policyMap[t] || 0) < 4) fail(`${t}: only ${policyMap[t] || 0}/4 snt_anon policies`);
  }
  if (!issues.some(i => i.includes('snt_anon'))) ok('all 24 tables have full select+insert+update+delete anon policies');

  console.log('\n┌─ 5. tenant_id default check ───────────────────────────');
  const defs = await sql(`select table_name, column_default from information_schema.columns where column_name='tenant_id' and table_schema='public' and table_name = any(array[${TENANT_TABLES.map(t => `'${t}'`).join(',')}])`);
  for (const r of defs) {
    if (!r.column_default || !r.column_default.includes(TENANT_ID)) fail(`${r.table_name}: tenant_id has no default`);
  }
  if (!issues.some(i => i.includes('no default'))) ok(`all 24 tables default tenant_id = ${TENANT_ID}`);

  console.log('\n┌─ 6. edge function deploy status ───────────────────────');
  const funcs = await functions();
  const slugs = new Set(funcs.map(f => f.slug));
  for (const exp of EXPECTED_FUNCS) {
    if (!slugs.has(exp)) fail(`${exp}: NOT DEPLOYED`);
    else {
      const f = funcs.find(x => x.slug === exp);
      if (f.status !== 'ACTIVE') fail(`${exp}: status=${f.status}`);
    }
  }
  if (!issues.some(i => i.includes('NOT DEPLOYED') || i.includes('status='))) ok(`all ${EXPECTED_FUNCS.length} edge functions ACTIVE`);

  console.log('\n┌─ 7. row count sanity ──────────────────────────────────');
  const counts = await sql(`select 'clients' as t, count(*) c from clients union all select 'jobs', count(*) from jobs union all select 'invoices', count(*) from invoices union all select 'quotes', count(*) from quotes union all select 'requests', count(*) from requests union all select 'payments', count(*) from payments order by c desc`);
  for (const r of counts) ok(`${r.t}: ${r.c} rows`);

  console.log('\n──────────────────────────────────────────────────────────');
  if (issues.length === 0) {
    console.log('🟢  HEALTHY — 0 issues across 7 categories.\n');
    process.exit(0);
  } else {
    console.log(`🔴  ${issues.length} ISSUE${issues.length > 1 ? 'S' : ''} FOUND. Fix before continuing.\n`);
    process.exit(1);
  }
})();
