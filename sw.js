/* FlagNest service worker — AppNest rules:
   per-file caching (no atomic addAll), navigation = network-first with timeout -> cache -> friendly offline page,
   redirect-clean responses (Cloudflare 308 on .html), cross-origin = pass-through, skipWaiting on install. */
const VERSION = 'flagnest-v4';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './privacy_policy.html'];

async function clean(res) {                       // never serve a "redirected" response for a navigation
  if (!res || !res.redirected) return res;
  const body = await res.clone().blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: res.headers });
}
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(async u => { const r = await fetch(u, { cache: 'reload' }); if (r.ok) await c.put(u, await clean(r)); }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
const OFFLINE = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlagNest</title><body style="margin:0;background:#000;color:#f5edd6;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center">
<div><div style="font-size:48px">🚩</div><h2 style="color:#d4af37">אין חיבור כרגע</h2><p>FlagNest ייטען ברגע שהחיבור יחזור.<br>No connection — FlagNest will load once you are back online.</p>
<button onclick="location.reload()" style="background:#d4af37;color:#000;border:0;border-radius:12px;padding:12px 22px;font-weight:800;font-size:16px">נסה שוב · Retry</button></div></body></html>`;
function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;      // pass-through (fonts/CDN)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await Promise.race([fetch(req.url, { cache: 'no-store', credentials: 'same-origin', redirect: 'follow' }), timeout(4000)]);
        if (net && net.ok) { const c = await caches.open(VERSION); const cl = await clean(net.clone()); c.put('./index.html', cl.clone()).catch(() => {}); return await clean(net); }
        throw new Error('bad');
      } catch (err) {
        const hit = (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
        if (hit) return await clean(hit);
        return new Response(OFFLINE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  e.respondWith((async () => {                    // same-origin assets: cache first, refresh in background
    const c = await caches.open(VERSION), hit = await c.match(req);
    const net = fetch(req).then(async r => { if (r && r.ok) await c.put(req, await clean(r.clone())); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net; return r || new Response('', { status: 504 });
  })());
});
