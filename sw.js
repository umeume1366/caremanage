// ケアつなぎ：アプリとして使うための仕組み（サービスワーカー）
// ・画面のファイル（同じサイトのもの）だけを保存し、電波が弱いときも画面を開けるようにする
// ・利用者の情報（サーバーとのやり取り）は、ここでは一切保存しない
// ・つねに最新を取りに行き、取れないときだけ保存しておいた画面を使う（古い画面が残りにくい）
const CACHE = 'caretsunagi-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // ほかのサイト（Cloudflare のサーバーなど）へのやり取りには手を出さない
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const hit = await caches.match(req) || (req.mode === 'navigate' ? await caches.match('./') : null);
      if (hit) return hit;
      return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ケアつなぎ</title><body style="font-family:sans-serif;padding:2rem;font-size:20px;line-height:1.7"><h1>電波がつながっていません</h1><p>インターネットにつながってから、もう一度開いてください。</p></body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
