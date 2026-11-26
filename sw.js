// App-shell service worker. Never caches Supabase or Gemini traffic (auth + private data).
const V = 'budget-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'js/store.js', 'js/model.js', 'js/charts.js', 'js/tips.js', 'js/export.js', 'js/defaults.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/supabase\.(co|in)|googleapis\.com\/v1|generativelanguage/.test(u.host + u.pathname)) return; // private / live data: network only
  const sameOrigin = u.origin === location.origin;
  const isStaticCdn = /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdn\.sheetjs\.com/.test(u.host);
  if (!sameOrigin && !isStaticCdn) return;
  // network-first for our own files (fresh updates), cache fallback offline; cache-first for CDN assets
  if (sameOrigin) e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  else e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return res; })));
});
