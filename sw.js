// オフラインでも開けるようにするしくみ(サービスワーカー)
// アプリのファイル: まずネットから最新を取りに行き、つながらないときは保存しておいたものを使う
// Three.js(CDN): 一度読んだら保存しておいたものを使う(バージョン固定なので変わらない)
const CACHE = 'room-layout-v2';
const APP_FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/data.js', 'js/geom.js', 'js/plan2d.js', 'js/view3d.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url === CDN) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
});
