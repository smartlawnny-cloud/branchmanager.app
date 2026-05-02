// branchmanager-proxy — Cloudflare Worker source
// Deployed to: branchmanager.app + clients.branchmanager.app
//
// Routes:
//   clients.branchmanager.app/*   → smartlawnny-cloud.github.io/branchmanager.app/portal/*
//   branchmanager.app/*           → smartlawnny-cloud.github.io/branchmanager.app/*
//
// History:
//   Apr 25 2026 — initial proxy created (BM white-label phase 1, v418)
//   May  2 2026 — added cache-bypass for /sw.js and /version.json so each
//                 BM deploy is picked up by browsers immediately. Without this,
//                 GitHub Pages' cache-control: max-age=14400 (4hr) was being
//                 honored by Cloudflare's Worker fetch, so SW updates rolled
//                 out hours late and gave users the "Failed to update SW" error.
//                 The Cloudflare zone-level Cache Rule we added couldn't fix it
//                 because the Worker's internal fetch caches before the zone
//                 rule sees the response.
//
// Deploy:
//   wrangler deploy   (from this directory; requires wrangler.toml)
// or via Cloudflare dashboard: Workers & Pages → branchmanager-proxy → Edit code
//   → paste contents of this file → Deploy.

const BUST_PATHS = new Set([
  '/sw.js',
  '/version.json',
]);

const ORIGIN = 'https://smartlawnny-cloud.github.io/branchmanager.app';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ── Customer portal subdomain ──
    // clients.branchmanager.app/* → /portal/* on the GH Pages origin.
    if (url.hostname === 'clients.branchmanager.app') {
      let path = url.pathname;
      if (path === '/' || path === '') path = '/portal/';
      else if (!path.startsWith('/portal')) path = '/portal' + path;

      const target = ORIGIN + path + url.search;
      const upstreamReq = new Request(target, request);
      upstreamReq.headers.set('Host', 'smartlawnny-cloud.github.io');

      const upstream = await fetch(upstreamReq, { redirect: 'manual' });
      return new Response(upstream.body, upstream);
    }

    // ── Main BM domain ──
    const target = ORIGIN + url.pathname + url.search;
    const upstreamReq = new Request(target, request);
    upstreamReq.headers.set('Host', 'smartlawnny-cloud.github.io');

    const isCacheBust = BUST_PATHS.has(url.pathname);

    // For SW + version metadata, tell Cloudflare's Worker fetch to skip its
    // internal cache. Without this, the Worker would serve a 4hr-old GH Pages
    // response even when the origin had the latest version.
    const fetchOpts = isCacheBust
      ? { redirect: 'manual', cf: { cacheTtl: 0, cacheEverything: false } }
      : { redirect: 'manual' };

    const upstream = await fetch(upstreamReq, fetchOpts);

    if (isCacheBust) {
      // Override response headers so browsers (and any downstream caches)
      // also treat this as no-store. Strips ETag/Last-Modified to prevent
      // 304 Not Modified responses from re-using a cached copy.
      const headers = new Headers(upstream.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      headers.set('Pragma', 'no-cache');
      headers.delete('etag');
      headers.delete('last-modified');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    return new Response(upstream.body, upstream);
  },
};
