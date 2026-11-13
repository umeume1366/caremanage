// ケアブル：アプリとして使うための仕組み（サービスワーカー）
// ・画面のファイル（同じサイトのもの）だけを保存し、2回目からはすぐ開けるようにする
// ・利用者の情報（サーバーとのやり取り）は、ここでは一切保存しない
// ・入り口（index.html）はつねに最新を取りに行く。そこに書かれた「?v=番号」付きのファイルは
//   番号が同じあいだは保存したものをそのまま使う（＝速い）。番号が変わると自動で新しいものに入れ替わる
// → 更新するときは index.html の ?v= の番号を変えるだけで大丈夫です（このファイルは直さなくてよい）
const CACHE = 'careble-v1';
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ケアブル</title><body style="font-family:sans-serif;padding:2rem;font-size:20px;line-height:1.7"><h1>電波がつながっていません</h1><p>インターネットにつながってから、もう一度開いてください。</p></body>';

const sameSite = (u) => new URL(u, self.location.href).origin === self.location.origin;
const cacheable = (res) => res && res.ok && res.type === 'basic';

// 入り口を読み、そこに書かれている ?v= 付きのファイルを先に保存しておく
async function precache() {
  const c = await caches.open(CACHE);
  const res = await fetch('./', { cache: 'no-cache' });
  if (!cacheable(res)) return;
  await c.put('./', res.clone());
  const html = await res.text();
  const urls = [...html.matchAll(/(?:href|src)="([^"]+\?v=[^"]+)"/g)].map((m) => m[1]).filter(sameSite);
  await Promise.all(urls.map((u) => fetch(u).then((r) => (cacheable(r) ? c.put(u, r) : null)).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 同じファイルの古い番号（?v=）のものを消す
async function dropOld(c, url) {
  for (const k of await c.keys()) {
    const u = new URL(k.url);
    if (u.pathname === url.pathname && u.search !== url.search && u.searchParams.has('v')) await c.delete(k);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // ほかのサイト（Cloudflare のサーバーなど）へのやり取りには手を出さない
  if (url.origin !== self.location.origin) return;

  // ?v= 付きのファイル：保存したものがあればすぐ返す
  if (url.searchParams.has('v')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (cacheable(res)) { await c.put(req, res.clone()); dropOld(c, url).catch(() => {}); }
      return res;
    })());
    return;
  }

  // 入り口など：つねに最新を取りに行き、取れないときだけ保存しておいたものを使う
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (cacheable(res)) c.put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      const hit = await c.match(req) || (req.mode === 'navigate' ? await c.match('./') : null);
      if (hit) return hit;
      return new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});

// ---------- 新しい連絡の合図（Web Push） ----------
// サーバーから空の合図が届いたら：
// ・ケアブルの画面を見ている → 画面に「最新にして」と伝えるだけ（通知は出さない）
// ・見ていない・閉じている → 「新しい連絡があります」と通知する（名前や本文は出さない）
// 同じ札（tag）を使うので、通知がたまらず、いつも1つだけになる
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'careble:new' }));
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(); } catch { /* 対応していない端末 */ }
    await self.registration.showNotification('ケアブル', {
      body: '新しい連絡があります。開いて確認してください',
      tag: 'careble-new',
      renotify: true,
      requireInteraction: true, // パソコンでは、押すか閉じるまで画面のすみに残す（見落とし防止）
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      lang: 'ja',
    });
  })());
});

// ブラウザの都合で届け先が変わったとき：次に画面を開いたときに登録し直すよう、開いている画面に伝える
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'careble:resub' }))));
});

// 通知を押したら、開いているケアブルの画面を前に出して最新にする（なければ新しく開く）
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { c.postMessage({ type: 'careble:new' }); return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
