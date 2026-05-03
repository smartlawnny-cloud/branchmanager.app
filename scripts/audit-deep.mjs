#!/usr/bin/env node
// audit-deep.mjs — every check that would have caught a real bug we hit.
//
// Run: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/audit-deep.mjs
//
// Categories (each independently passes/fails — exits 1 if any fail):
//   1. Public-fn reachability    — HEAD, GET, POST verify-probe shape
//   2. Bundle integrity          — version.json vs BUNDLED_VERSION vs CACHE_NAME
//                                  vs ?v= in script tag vs dist/ file existence
//   3. CSP / connect-src         — every BM-fetched origin in CSP
//   4. Hardcoded SNT UUID scan   — UUID literals outside _shared/tenant.ts
//   5. End-to-end anon write     — actually round-trip through RLS
//   6. verify_jwt consistency    — config.toml ↔ deploy-fn.sh ↔ live function
//   7. Stale data buckets        — quotes/invoices/tasks rotting >threshold
//   8. Email deliverability      — bouncing customers + recent failure ratio
//
// Combine with health-audit.mjs (schema/RLS/orphans/dupes) for full coverage.

import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROJECT_REF = "ltpivkqahvplapyagljt";
const SNT_UUID = "93af4348-8bba-4045-ac3e-5e71ec1cc8c5";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.error("ERROR: SUPABASE_ACCESS_TOKEN env var required.");
  process.exit(2);
}

const ANON_KEY = (() => {
  try {
    const grep = execSync(`grep -rho 'eyJ[A-Za-z0-9_.-]\\{30,\\}' ${ROOT}/src/ | sort -u | head -1`, { encoding: "utf8" });
    return grep.trim();
  } catch (_) { return ""; }
})();

const issues = [];
function fail(category, msg) { issues.push({ category, msg }); }
function pass(category, msg = "ok") { /* noop unless verbose */ }

async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  let body;
  try { body = await r.json(); } catch (_) { body = await r.text().catch(() => ""); }
  return { status: r.status, body };
}

// ── 1. Public function reachability ──────────────────────────────────────────
async function auditPublicFns() {
  console.log("\n┌─ 1. Public-fn reachability (HEAD/GET/POST shape) ───");
  const PUBLIC = [
    "dialpad-webhook", "bouncie-webhook", "stripe-webhook", "resend-webhook",
    "request-notify", "quote-notify", "quote-update", "quote-fetch",
    "invoice-fetch", "portal-auth", "portal-session", "portal-update",
  ];
  for (const fn of PUBLIC) {
    const url = `https://${PROJECT_REF}.supabase.co/functions/v1/${fn}`;
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(e => ({ status: 0, err: e.message }));
    const get  = await fetch(url, { method: "GET",  signal: AbortSignal.timeout(8000) }).catch(e => ({ status: 0, err: e.message }));
    if (head.status !== 200 || get.status !== 200) {
      fail("public-fn-reachability",
        `${fn}: HEAD=${head.status} GET=${get.status} (verify probes need 200, was 405/500 = bug)`);
    }
  }
  console.log(`  ${issues.filter(i => i.category === "public-fn-reachability").length === 0 ? "✅" : "❌"} ${PUBLIC.length} public fns checked`);
}

// ── 2. Bundle integrity ──────────────────────────────────────────────────────
function auditBundle() {
  console.log("\n┌─ 2. Bundle integrity ──────────────────────────────");
  const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
  const versionJson = JSON.parse(readFileSync(join(ROOT, "version.json"), "utf8"));
  const swJs = existsSync(join(ROOT, "sw.js")) ? readFileSync(join(ROOT, "sw.js"), "utf8") : "";

  const bundledMatch = indexHtml.match(/var\s+BUNDLED_VERSION\s*=\s*(\d+)/);
  const bundledVer = bundledMatch ? parseInt(bundledMatch[1], 10) : null;
  const cacheNameMatch = swJs.match(/branch-manager-v(\d+)/);
  const cacheVer = cacheNameMatch ? parseInt(cacheNameMatch[1], 10) : null;
  const scriptTagMatch = indexHtml.match(/dist\/bm\.bundle\.v(\d+)\.min\.js/);
  const scriptTagVer = scriptTagMatch ? parseInt(scriptTagMatch[1], 10) : null;

  console.log(`  version.json:     ${versionJson.version}`);
  console.log(`  BUNDLED_VERSION:  ${bundledVer}`);
  console.log(`  sw.js CACHE:      ${cacheVer ?? "(no sw.js)"}`);
  console.log(`  <script src=…vN>: ${scriptTagVer}`);

  const all = new Set([versionJson.version, bundledVer, scriptTagVer, cacheVer].filter(v => v != null));
  if (all.size !== 1) {
    fail("bundle-integrity", `Version drift: version.json=${versionJson.version} BUNDLED=${bundledVer} CACHE=${cacheVer} script=${scriptTagVer} — all 4 must match. Run ./scripts/bump.sh.`);
  }

  const expectedBundle = `dist/bm.bundle.v${versionJson.version}.min.js`;
  if (!existsSync(join(ROOT, expectedBundle))) {
    fail("bundle-integrity", `MISSING BUNDLE FILE: ${expectedBundle} — app would 404 at boot. Run ./scripts/bump.sh ${versionJson.version} or rebuild.`);
  } else {
    console.log(`  ${expectedBundle}: exists`);
  }
}

// ── 3. CSP / connect-src ─────────────────────────────────────────────────────
function auditCSP() {
  console.log("\n┌─ 3. CSP connect-src vs known origins ──────────────");
  const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");
  const cspMatch = indexHtml.match(/Content-Security-Policy[\s\S]*?content="([\s\S]*?)"/);
  if (!cspMatch) { fail("csp", "No CSP meta tag found in index.html"); return; }
  const csp = cspMatch[1].replace(/\s+/g, " ");
  // BM is known to call these origins; CSP must allow them in connect-src or script-src.
  const REQUIRED_CONNECT = [
    "*.supabase.co", "wss://*.supabase.co",
    "api.anthropic.com", "api.stripe.com", "api.open-meteo.com",
    "nominatim.openstreetmap.org", "my-api.plantnet.org", "dialpad.com",
    "*.ingest.us.sentry.io", "*.sentry.io",
  ];
  for (const origin of REQUIRED_CONNECT) {
    if (!csp.includes(origin)) {
      fail("csp", `CSP missing connect-src origin: ${origin} (BM calls this — would cause silent CSP block in console)`);
    }
  }
  // script-src
  const REQUIRED_SCRIPT = [
    "https://js.stripe.com", "https://unpkg.com",
    "https://js.sentry-cdn.com",
  ];
  for (const origin of REQUIRED_SCRIPT) {
    if (!csp.includes(origin.replace(/https:\/\//, ""))) {
      fail("csp", `CSP missing script-src origin: ${origin}`);
    }
  }
  console.log(`  CSP includes ${REQUIRED_CONNECT.length + REQUIRED_SCRIPT.length} required origins`);
}

// ── 4. Hardcoded SNT UUID scan ───────────────────────────────────────────────
function auditHardcodedUuids() {
  console.log("\n┌─ 4. Hardcoded SNT UUID scan ────────────────────────");
  const out = spawnSync("grep", [
    "-rln",
    SNT_UUID,
    join(ROOT, "src"),
    join(ROOT, "supabase", "functions"),
    join(ROOT, "index.html"),
    join(ROOT, "cloudflare-worker"),
  ], { encoding: "utf8" });
  const lines = (out.stdout || "").split("\n").filter(Boolean);
  // Allowed locations — fallbacks during Phase 2 rollout
  const ALLOWED = [
    /\/_shared\/tenant\.ts$/,           // SNT_TENANT_ID_CONST + fallback
    /\/src\/supabase\.js$/,             // resolveTenantHeader fallback (single source of truth)
    /\/scripts\/.*\.(mjs|sh|sql)$/,     // audit + seed scripts may reference
    /\/audit-deep\.mjs$/,               // this file
    /\/MULTI-TENANT-PHASE-2\.md$/,
    /\/seed-tenant\.sql$/,
    /\/cloudflare-worker\/index\.js$/,  // tenant comment in TENANT_BY_SUBDOMAIN
  ];
  const offenders = lines.filter(f => !ALLOWED.some(re => re.test(f)));
  if (offenders.length > 0) {
    fail("hardcoded-uuid", `${offenders.length} files still reference SNT UUID outside the resolver:\n      ${offenders.join("\n      ")}`);
  }
  console.log(`  ${offenders.length === 0 ? "✅" : "❌"} ${lines.length} total references, ${offenders.length} unauthorized`);
}

// ── 5. End-to-end anon write ─────────────────────────────────────────────────
async function auditAnonWrite() {
  console.log("\n┌─ 5. End-to-end anon write through RLS ──────────────");
  if (!ANON_KEY) { fail("anon-write", "Could not extract anon key from src/"); return; }
  const url = `https://${PROJECT_REF}.supabase.co/rest/v1/clients`;
  const headers = {
    "apikey": ANON_KEY,
    "Authorization": `Bearer ${ANON_KEY}`,
    "X-Tenant-ID": SNT_UUID,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };
  const testName = `AUDIT_${Date.now()}`;
  const ins = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ name: testName, phone: "5550000000" }),
    signal: AbortSignal.timeout(10000),
  }).catch(e => ({ ok: false, status: 0, _err: e.message }));
  if (!ins.ok) {
    fail("anon-write", `INSERT failed status=${ins.status} (RLS may be blocking — was the May 2 silent-write bug)`);
    return;
  }
  const row = (await ins.json())[0];
  // Cleanup
  await fetch(`${url}?id=eq.${row.id}`, { method: "DELETE", headers, signal: AbortSignal.timeout(8000) });
  console.log(`  ✅ INSERT + DELETE round-trip works (id=${row.id.slice(0, 8)}...)`);
}

// ── 6. verify_jwt consistency ────────────────────────────────────────────────
async function auditVerifyJwt() {
  console.log("\n┌─ 6. verify_jwt consistency (config.toml ↔ live) ────");
  const tomlText = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
  const tomlConfigured = [...tomlText.matchAll(/\[functions\.([a-z0-9-]+)\]\nverify_jwt = false/g)].map(m => m[1]);
  const deployText = readFileSync(join(ROOT, "scripts", "deploy-fn.sh"), "utf8");
  const deployListMatch = deployText.match(/PUBLIC_FNS=\(\n([\s\S]*?)\n\)/);
  const deployList = deployListMatch ? deployListMatch[1].trim().split(/\s+/) : [];

  // 1) every fn in deploy-fn.sh PUBLIC_FNS must be in config.toml
  const missing1 = deployList.filter(fn => !tomlConfigured.includes(fn));
  if (missing1.length) fail("verify-jwt", `Functions in deploy-fn.sh PUBLIC_FNS but missing from config.toml: ${missing1.join(", ")}`);

  // 2) every fn in config.toml should appear in deploy-fn.sh too
  const missing2 = tomlConfigured.filter(fn => !deployList.includes(fn));
  if (missing2.length) fail("verify-jwt", `Functions in config.toml but missing from deploy-fn.sh PUBLIC_FNS: ${missing2.join(", ")}`);

  // 3) live verify_jwt status matches
  for (const fn of tomlConfigured) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${fn}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!r || !r.ok) { fail("verify-jwt", `Could not query ${fn} state`); continue; }
    const j = await r.json();
    if (j.verify_jwt !== false) {
      fail("verify-jwt", `${fn}: verify_jwt is ${j.verify_jwt} but config.toml says false (LIVE STATE WRONG)`);
    }
  }
  console.log(`  ${tomlConfigured.length} public fns configured; deploy-fn.sh ↔ config.toml ↔ live cross-checked`);
}

// ── 7. Stale data buckets ────────────────────────────────────────────────────
async function auditStale() {
  console.log("\n┌─ 7. Stale data buckets ────────────────────────────");
  if (!ANON_KEY) return;
  const headers = { "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}`, "X-Tenant-ID": SNT_UUID, "Prefer": "count=exact" };

  // Quotes "sent" >90d — should be archived/expired
  const since90 = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  const r1 = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/quotes?status=eq.sent&sent_at=lt.${since90}&select=id`, {
    method: "HEAD", headers, signal: AbortSignal.timeout(8000),
  });
  const cr1 = r1.headers.get("content-range") || "";
  const stale1 = parseInt(cr1.split("/")[1] || "0", 10);
  if (stale1 > 0) fail("stale-quotes", `${stale1} quotes still in 'sent' status with sent_at >90d ago — bulk-archive candidates`);

  // Invoices unpaid >180d — likely write-off candidates
  const since180 = new Date(Date.now() - 180 * 86400 * 1000).toISOString();
  const r2 = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/invoices?status=eq.unpaid&created_at=lt.${since180}&select=id`, {
    method: "HEAD", headers, signal: AbortSignal.timeout(8000),
  });
  const cr2 = r2.headers.get("content-range") || "";
  const stale2 = parseInt(cr2.split("/")[1] || "0", 10);
  if (stale2 > 0) fail("stale-invoices", `${stale2} invoices unpaid for >180d — write-off review needed`);

  console.log(`  ${stale1} stale-sent quotes, ${stale2} unpaid invoices >180d`);
}

// ── 8. Email deliverability ──────────────────────────────────────────────────
async function auditEmail() {
  console.log("\n┌─ 8. Email deliverability ───────────────────────────");
  if (!ANON_KEY) return;
  const headers = { "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}`, "X-Tenant-ID": SNT_UUID, "Prefer": "count=exact" };

  // Bouncing clients
  const r1 = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/clients?email_status=eq.bounced&select=id,email,name`, {
    headers, signal: AbortSignal.timeout(8000),
  });
  const bouncers = await r1.json().catch(() => []);
  if (bouncers.length > 0) {
    console.log(`  ⚠️  ${bouncers.length} bouncing email customers:`);
    bouncers.slice(0, 5).forEach(b => console.log(`     ${b.email} (${b.name})`));
    if (bouncers.length > 5) console.log(`     ...and ${bouncers.length - 5} more`);
  } else {
    console.log(`  ✅ no bouncing email customers`);
  }

  // Bounce events last 7d
  const since7 = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const r2 = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/communications?channel=eq.email&status=eq.hard_bounce&created_at=gte.${since7}&select=id`, {
    method: "HEAD", headers, signal: AbortSignal.timeout(8000),
  });
  const cr2 = r2.headers.get("content-range") || "";
  const recent = parseInt(cr2.split("/")[1] || "0", 10);
  if (recent > 0) console.log(`  ⚠️  ${recent} hard-bounce events in last 7d`);
}

// ── 9. Speed audit ───────────────────────────────────────────────────────────
async function auditSpeed() {
  console.log("\n┌─ 9. Speed audit (latency to key endpoints) ─────────");
  const versionJson = JSON.parse(readFileSync(join(ROOT, "version.json"), "utf8"));
  const v = versionJson.version;
  const ENDPOINTS = [
    { name: `BM bundle (v${v})`, url: `https://branchmanager.app/dist/bm.bundle.v${v}.min.js`, budget_ms: 2000 },
    { name: "version.json",     url: `https://branchmanager.app/version.json`,                budget_ms: 800 },
    { name: "marketing site",   url: `https://peekskilltree.com/`,                            budget_ms: 1500 },
    { name: "REST clients HEAD",url: `https://${PROJECT_REF}.supabase.co/rest/v1/clients?limit=1`, budget_ms: 1500, headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "X-Tenant-ID": SNT_UUID, Prefer: "count=exact" }, method: "HEAD" },
    { name: "Edge dialpad-webhook",  url: `https://${PROJECT_REF}.supabase.co/functions/v1/dialpad-webhook`, budget_ms: 1500 },
    { name: "Edge request-notify",   url: `https://${PROJECT_REF}.supabase.co/functions/v1/request-notify`,  budget_ms: 1500 },
  ];
  for (const e of ENDPOINTS) {
    const t0 = Date.now();
    try {
      await fetch(e.url, { method: e.method || "GET", headers: e.headers || {}, signal: AbortSignal.timeout(8000) });
      const ms = Date.now() - t0;
      const ok = ms < e.budget_ms;
      console.log(`  ${ok ? "✅" : "⚠️ "} ${e.name.padEnd(24)} ${ms}ms (budget ${e.budget_ms}ms)`);
      if (!ok) fail("speed", `${e.name} took ${ms}ms (budget ${e.budget_ms}ms)`);
    } catch (err) {
      fail("speed", `${e.name}: ${err.message}`);
    }
  }
}

// ── 10. Code audit (dead routes, console.errors, TODO density) ──────────────
function auditCode() {
  console.log("\n┌─ 10. Code audit (dead routes, console noise, TODO) ─");
  // Dead loadPage routes: grep for loadPage('xxx') calls and verify the
  // page module exists in src/pages/. Bug pattern: "loadPage('fleet')"
  // failed because there was no src/pages/fleet.js handler; today we caught
  // it manually but no audit existed.
  const grepOut = spawnSync("grep", ["-rn", "-E", "loadPage\\(['\"][a-z]+['\"]\\)", join(ROOT, "src"), join(ROOT, "index.html")], { encoding: "utf8" });
  const pageRefs = new Set();
  for (const line of (grepOut.stdout || "").split("\n").filter(Boolean)) {
    const m = line.match(/loadPage\(['"]([a-z]+)['"]\)/);
    if (m) pageRefs.add(m[1]);
  }
  // Cross-check: loadPage('xxx') maps to either src/pages/xxx.js OR a hub case
  // in index.html. We can't easily prove the latter, so just count refs.
  const pageFiles = execSync(`ls ${ROOT}/src/pages/ 2>/dev/null`, { encoding: "utf8" }).split("\n").filter(Boolean).map(f => f.replace(/\.js$/, ""));
  const orphanRefs = [...pageRefs].filter(r => !pageFiles.includes(r));
  // The hub names (operations, dispatch, etc.) won't have files; not all are bugs.
  // We just print the LIST so a human can scan.
  console.log(`  ${pageRefs.size} loadPage() targets found, ${pageFiles.length} src/pages/*.js files`);
  if (orphanRefs.length > 0) {
    console.log(`     refs without page files: ${orphanRefs.slice(0, 10).join(", ")}`);
  }

  // TODO/FIXME density — too many = stale debt
  const todoOut = spawnSync("grep", ["-rln", "-E", "TODO|FIXME|XXX|HACK", join(ROOT, "src"), join(ROOT, "supabase", "functions")], { encoding: "utf8" });
  const todoLines = (todoOut.stdout || "").split("\n").filter(Boolean).length;
  console.log(`  ${todoLines} files with TODO/FIXME/HACK markers`);
  if (todoLines > 50) {
    fail("code-quality", `${todoLines} files with TODO/FIXME — review and burn down`);
  }

  // console.error count — high values mean noisy logs / production-error spam
  const errOut = spawnSync("grep", ["-rln", "console.error", join(ROOT, "src"), join(ROOT, "supabase", "functions")], { encoding: "utf8" });
  const errLines = (errOut.stdout || "").split("\n").filter(Boolean).length;
  console.log(`  ${errLines} files with console.error calls`);
}

// ── 11. Security headers audit (live URL) ────────────────────────────────────
async function auditSecurityHeaders() {
  console.log("\n┌─ 11. Security headers (live URL response) ──────────");
  const REQUIRED_HEADERS = [
    "strict-transport-security", "x-frame-options",
    "x-content-type-options", "referrer-policy",
    "permissions-policy", "content-security-policy",
  ];
  const r = await fetch("https://branchmanager.app/", { signal: AbortSignal.timeout(8000) });
  const haveHeaders = new Set([...r.headers.keys()].map(k => k.toLowerCase()));
  for (const h of REQUIRED_HEADERS) {
    if (!haveHeaders.has(h)) fail("security-headers", `Live response missing: ${h}`);
  }
  console.log(`  ${REQUIRED_HEADERS.length} required headers checked on live response`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log("─".repeat(60));
console.log("  BM Deep Audit — every check that would have caught a real bug");
console.log("─".repeat(60));

await auditPublicFns();
auditBundle();
auditCSP();
auditHardcodedUuids();
await auditAnonWrite();
await auditVerifyJwt();
await auditStale();
await auditEmail();
await auditSpeed();
auditCode();
await auditSecurityHeaders();

console.log("\n" + "─".repeat(60));
if (issues.length === 0) {
  console.log("🟢  DEEP-HEALTHY — 0 issues across 11 categories.");
  process.exit(0);
} else {
  console.log(`🔴  ${issues.length} issue(s) found:\n`);
  for (const i of issues) {
    console.log(`  [${i.category}] ${i.msg}\n`);
  }
  process.exit(1);
}
