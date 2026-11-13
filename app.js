// ケアブル フロントエンド（ビルド不要・外部ライブラリなし）
(() => {
  'use strict';

  // ほかのサイトの中に埋め込まれているときは動かさない（config.js で判定）
  if (window.APP_CONFIG && window.APP_CONFIG.BLOCKED) return;

  const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE || '').replace(/\/+$/, '');
  const app = document.getElementById('app');
  const IDLE_LOGOUT_MS = 30 * 60 * 1000;
  // プレビュー（埋め込み表示）用：URLのハッシュを使わずに画面を切り替える
  const MEM = !!(window.APP_CONFIG && window.APP_CONFIG.MEMORY_ROUTER);
  let memHash = '#/';
  if (MEM) window.appLogout = () => { try { fetch(API + '/api/logout', { method: 'POST' }); } catch { /* 無視 */ } logoutLocal(''); };
  const curHash = () => (MEM ? memHash : location.hash);

  // ---------- 状態 ----------
  const S = {
    token: safeGet(sessionStorage, 'token'),
    user: null,
    timers: [],
    lastActive: Date.now(),
  };

  function safeGet(store, k) { try { return store.getItem(k); } catch { return null; } }
  function safeSet(store, k, v) { try { v == null ? store.removeItem(k) : store.setItem(k, v); } catch { /* 無視 */ } }

  // ---------- 文字サイズ ----------
  // 押すたびに 通常 → 大 → 特大 → 通常… と切り替わる。ログインしている人ごとにサーバーへ保存し、次回もその大きさで開く
  const SIZES = [['normal', '通常'], ['large', '大'], ['xlarge', '特大']];
  const sizeOk = (v) => SIZES.some(([k]) => k === v);
  function applySize(s) {
    if (!sizeOk(s)) s = 'large';
    document.documentElement.dataset.size = s; safeSet(localStorage, 'size', s);
    document.querySelectorAll('.sizebtn .cur').forEach((x) => { x.textContent = sizeLabel(); });
    document.querySelectorAll('.sizebtn').forEach((x) => { x.setAttribute('aria-label', `文字の大きさ（いまは${sizeLabel()}。押すと切り替わります）`); });
  }
  function sizeLabel() { return (SIZES.find(([k]) => k === document.documentElement.dataset.size) || SIZES[1])[1]; }
  applySize(safeGet(localStorage, 'size') || 'large');
  // ログインした人の設定を画面に反映
  function useUserSize(u) { if (u && sizeOk(u.font_size)) applySize(u.font_size); }

  // ---------- アプリとして使う（PWA：ホーム画面に追加） ----------
  // ・Android（Chrome など）：ボタンを押すと、その場で「インストール」の確認が出る
  //   ※ Chrome の決まりで、ページを開いてから30秒ほどたたないと確認を出せない。そのあいだは「準備中」と表示して待つ
  // ・iPhone / iPad：Apple の決まりで、ボタンから直接は追加できない。共有ボタンからの3つの手順を、使っているブラウザに合わせて案内する
  // ・LINE などの「アプリの中の画面」：ホーム画面に追加できないので、Chrome / Safari で開き直す案内を出す
  let installEvent = null;
  const installWaiters = new Set();
  const UA = navigator.userAgent;
  const isApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/i.test(UA);
  function inAppName() {
    if (/\bLine\//i.test(UA)) return 'LINE';
    if (/FBAN|FBAV|FB_IAB/.test(UA)) return 'Facebook';
    if (/Instagram/i.test(UA)) return 'Instagram';
    if (/MicroMessenger|KAKAOTALK|Twitter/i.test(UA)) return 'アプリ';
    if (isAndroid() && /; wv\)/.test(UA)) return 'アプリ';
    if (isIOS() && !/Safari\//.test(UA)) return 'アプリ';
    return '';
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; installWaiters.forEach((fn) => fn()); });
  addEventListener('appinstalled', () => { installEvent = null; document.querySelectorAll('.overlay.install').forEach((o) => o.remove()); toast('ホーム画面に追加しました'); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくても画面は動く */ }); });
  }
  // その場で「インストール」の確認を出す
  async function promptInstall() {
    const ev = installEvent; installEvent = null;
    if (!ev) return;
    try {
      ev.prompt();
      const choice = await ev.userChoice;
      if (choice && choice.outcome === 'dismissed') toast('追加をやめました。もう一度押すと追加できます');
    } catch { /* 無視 */ }
  }
  const stepList = (steps) => h('ol', { class: 'steps' }, steps.map((t) => h('li', null, t)));
  const shareIcon = () => h('span', { class: 'ico-share', role: 'img', 'aria-label': '共有ボタン（四角から上向きの矢印が出ているマーク）' });
  function pageUrl() { return location.href.split('#')[0]; }
  function urlBox() {
    const box = h('input', { type: 'text', readonly: true, class: 'urlbox', value: pageUrl(), 'aria-label': 'このページのアドレス', onfocus: (e) => e.target.select() });
    const btn = h('button', { type: 'button', class: 'btn secondary block', onclick: async () => {
      try { await navigator.clipboard.writeText(pageUrl()); toast('アドレスをコピーしました'); } catch { box.focus(); box.select(); toast('アドレスを長押ししてコピーしてください'); }
    } }, 'アドレスをコピーする');
    return h('div', { class: 'urlrow' }, box, btn);
  }
  function installDialog(body, actions) {
    const close = dialog('ホーム画面に追加', body, actions);
    const ov = [...document.querySelectorAll('.overlay')].pop();
    if (ov) ov.classList.add('install');
    return close;
  }

  function installApp() {
    // 1) すぐに追加できる状態（Android の Chrome・パソコンの Chrome / Edge など）
    if (installEvent) return promptInstall();

    // 2) LINE などのアプリの中で開いている
    const inApp = inAppName();
    if (inApp) {
      const name = inApp === 'アプリ' ? 'ほかのアプリ' : inApp;
      const target = isIOS() ? 'Safari' : 'Chrome';
      const u = pageUrl();
      const open = inApp === 'LINE'
        ? h('a', { class: 'btn block', href: u + (u.includes('?') ? '&' : '?') + 'openExternalBrowser=1' }, `${target} などのブラウザで開く`)
        : isAndroid()
          ? h('a', { class: 'btn block', href: 'intent://' + u.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end' }, 'Chrome で開く')
          : null;
      return installDialog(h('div', null,
        h('p', null, `いまは ${name} の中の画面で開いています。このままでは、ホーム画面に追加できません。`),
        h('p', null, h('b', null, `${target} で開き直すと、追加できます。`)),
        open ? h('p', null, open) : null,
        h('p', { class: 'hint' }, open ? 'うまく開かないときは、下のアドレスをコピーして、' + target + ' のアドレス欄に貼り付けてください。' : `下のアドレスをコピーして、${target} のアドレス欄に貼り付けてください。画面のすみのメニューに「${target} で開く」「ブラウザで開く」があれば、それでも開けます。`),
        urlBox()),
      (close) => [h('button', { class: 'btn secondary', onclick: close }, '閉じる')]);
    }

    // 3) iPhone / iPad（Apple の決まりで、ボタンからは直接追加できない）
    if (isIOS()) {
      const chrome = /CriOS|EdgiOS/.test(UA);
      const other = /FxiOS|OPiOS|DuckDuckGo/.test(UA);
      const steps = chrome
        ? [['アドレス欄の右はしにある ', shareIcon(), ' を押します。'], ['出てきたメニューを下へ動かして「ホーム画面に追加」を押します。'], ['右上の「追加」を押します。']]
        : [['画面の下にある ', shareIcon(), ' を押します。', h('span', { class: 'hint' }, '（見当たらないときは「…」を押すと出てきます。iPad は画面の上にあります）')], ['出てきたメニューを下へ動かして「ホーム画面に追加」を押します。'], ['右上の「追加」を押します。']];
      return installDialog(h('div', null,
        h('p', null, 'iPhone・iPad は、次の3つの手順でホーム画面に追加できます。'),
        other ? h('p', { class: 'testnote' }, 'このブラウザでは追加できないことがあります。Safari で開くと確実です。') : null,
        stepList(steps),
        h('p', { class: 'hint' }, 'ホーム画面に「ケアブル」のアイコンができ、次からはアプリのように開けます。'),
        other ? urlBox() : null),
      (close) => [h('button', { class: 'btn', onclick: close }, 'わかりました')]);
    }

    // 4) Android・パソコン：準備ができしだい、ボタンが押せるようになる
    const status = h('p', { class: 'installwait', role: 'status' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), '準備しています… 30秒ほどで下のボタンが押せるようになります。');
    const addBtn = h('button', { type: 'button', class: 'btn block', disabled: true }, 'ホーム画面に追加する');
    const ready = () => {
      if (!addBtn.isConnected) { installWaiters.delete(ready); return; }
      status.className = 'installwait ok'; status.textContent = '✓ 準備ができました。下のボタンを押してください。';
      addBtn.disabled = false; addBtn.focus();
    };
    const manual = isAndroid()
      ? ['画面の右上（または右下）の「︙」を押します。', '「ホーム画面に追加」または「アプリをインストール」を押します。', '「インストール」または「追加」を押します。']
      : ['アドレス欄の右はしにあるインストールのマーク（パソコンに↓の絵）を押します。', '見当たらないときは、右上の「︙」→「キャスト、保存、共有」→「ページをアプリとしてインストール」を押します。', '「インストール」を押します。'];
    const closeDlg = installDialog(h('div', null,
      status, h('p', null, addBtn),
      h('details', { class: 'installhelp' },
        h('summary', null, 'ボタンが押せるようにならないとき'),
        h('p', { class: 'hint' }, 'すでに追加してある場合は、ボタンは押せるようになりません。ホーム画面の「ケアブル」のアイコンから開いてください。'),
        h('p', { class: 'hint' }, 'まだ追加していない場合は、次の手順でも追加できます。'),
        stepList(manual))),
    (close) => [h('button', { class: 'btn secondary', onclick: () => { installWaiters.delete(ready); close(); } }, '閉じる')]);
    addBtn.addEventListener('click', async () => { installWaiters.delete(ready); closeDlg(); await promptInstall(); });
    installWaiters.add(ready);
  }

  // ---------- DOM ヘルパー（textContent のみ使用：画面への不正なHTML挿入を防ぐ） ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function fill(el, ...nodes) { el.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false)); }
  function mount(...nodes) { fill(app, ...nodes); }
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = ''; }, 3200);
  }
  function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; S.refresh = null; }

  // ログインID：全角で入力された英数字（１２３４ など）を半角に直し、前後の空白を取る
  const normId = (v) => String(v || '').normalize('NFKC').replace(/\s+/g, '');

  // ---------- 日時 ----------
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(ms) { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtDay(ms) {
    const d = new Date(ms);
    const w = '日月火水木金土'[d.getDay()];
    return `${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
  }
  function fmtShort(ms) {
    const d = new Date(ms), n = new Date();
    if (d.toDateString() === n.toDateString()) return fmtTime(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function fmtFull(ms) { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ms)}`; }

  // ---------- API ----------
  // passive: 合図を受けて自動で取り直す通信。サーバーは「人が操作した」とは見なさない（自動ログアウトの時間が延びない）
  //   画面が見えているときは「2」（本人が見た）、裏にあるときは「1」（まだ見ていない＝通知のまとめを続ける）
  async function api(method, path, body, { passive } = {}) {
    let res;
    P.last = Date.now();
    const pv = passive ? (document.visibilityState === 'visible' ? '2' : '1') : '';
    try {
      res = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(pv ? { 'X-Careble-Passive': pv } : {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new Error('通信できませんでした。電波の状態を確認してください');
    }
    let data = {};
    try { data = await res.json(); } catch { /* 空 */ }
    if (res.status === 401 && S.token) {
      logoutLocal(data.error || 'ログインしてください');
      throw new Error(data.error || 'ログインしてください');
    }
    if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
    return data;
  }

  function logoutLocal(msg) {
    clearTimers();
    S.token = null; S.user = null; S.q = ''; S.svc = 'all'; S.clientDraft = null;
    blobCache.clear(); dropUrls();
    P.synced = false; P.on = false; setTitle(0);
    // 開いたままの写真・PDF・ダイアログを画面から消す（ログアウト後に利用者の情報が残らないように）
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    app.style.height = '';
    safeSet(sessionStorage, 'token', null);
    if (MEM) memHash = '#/';
    else if (location.hash) history.replaceState(null, '', location.pathname);
    renderLogin(msg);
  }

  // 無操作で自動ログアウト（共有端末での覗き見対策）
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true }));
  function idleCheck() {
    if (S.token && Date.now() - S.lastActive > IDLE_LOGOUT_MS) {
      api('POST', '/api/logout').catch(() => {});
      logoutLocal('30分間操作がなかったため、自動でログアウトしました');
    }
  }
  setInterval(idleCheck, 30 * 1000);
  // スリープや別アプリから戻ってきたときは、すぐに確認する（タイマーが止まっていても見逃さない）
  document.addEventListener('visibilitychange', () => { if (!document.hidden) idleCheck(); });

  // ---------- 新しい連絡の受け取り方 ----------
  // 考え方：画面からサーバーへ「新しい連絡はある？」と定期的に聞きに行くのは、やめました。
  // ・連絡が書かれた瞬間に、サーバーがこの端末へ「合図」を1回だけ送ります（Web Push）。
  //   合図の待ち受けはブラウザ自身が行うので、待っているあいだ、ケアブルのサーバーとの通信はゼロです
  // ・合図には中身がありません。利用者の名前も本文も、途中の配達所には渡りません
  // ・合図が届いたとき：画面を見ている → 画面だけを最新にする（通知は出さない）
  //                    見ていない・タブを閉じている → 「新しい連絡があります」と通知する
  // ・サーバーに確認に行くのは「合図が来たとき」「この画面に戻ってきたとき」「自分で操作したとき」だけ
  // ・合図を受け取れないとき（通知をオフ・対応していないブラウザ）だけ、画面を見ているあいだ、ゆっくり確認します
  const APP_TITLE = 'ケアブル';
  const SAFETY_MS = 10 * 60 * 1000; // 合図を受け取れる端末でも、念のため10分に1回は確認する（画面を見ているときだけ）
  const P = { on: false, synced: false, busy: false, at: 0, last: 0 };
  function setTitle(n) {
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${APP_TITLE}` : APP_TITLE;
    // ホーム画面に追加して使っているときは、アイコンにも数を出す（対応している端末のみ）
    try { if (navigator.setAppBadge) (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch { /* 無視 */ }
  }
  const DEMO = API === 'demo';
  const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const notifyKey = () => 'notify:' + (S.user ? S.user.id : '');
  const wantsPush = () => safeGet(localStorage, notifyKey()) === '1';
  function u8(b64) {
    const t = String(b64).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function sameKey(sub, key) {
    try {
      const a = new Uint8Array(sub.options.applicationServerKey), b = u8(key);
      return a.length === b.length && a.every((x, i) => x === b[i]);
    } catch { return false; }
  }
  function swReady() {
    return Promise.race([navigator.serviceWorker.ready, new Promise((_, ng) => setTimeout(() => ng(new Error('準備ができませんでした。ページを再読み込みしてください')), 8000))]);
  }
  // この端末を「合図の届け先」にする。すでに登録済みで変わりがなければ、通信はしない
  async function pushOn(key) {
    if (DEMO) { await api('POST', '/api/push/subscribe', { endpoint: 'demo' }); P.on = true; return; }
    const reg = await swReady();
    let sub = await reg.pushManager.getSubscription();
    key = key || S.pushKey || (await api('GET', '/api/push/key')).key;
    S.pushKey = key;
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) {
      try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) }); } catch { throw new Error('このブラウザでは通知を登録できませんでした'); }
    }
    const mark = `${S.user.id}|${sub.endpoint}`;
    if (safeGet(localStorage, 'push_ep') !== mark) {
      await api('POST', '/api/push/subscribe', { endpoint: sub.endpoint });
      safeSet(localStorage, 'push_ep', mark);
    }
    P.on = true;
  }
  // この端末への合図をやめる（ログアウトしたとき・通知をオフにしたとき）
  async function pushOff() {
    P.on = false;
    safeSet(localStorage, 'push_ep', null);
    if (DEMO) { await api('POST', '/api/push/unsubscribe', { endpoint: 'demo' }).catch(() => {}); return; }
    if (!pushSupported()) return;
    try {
      const reg = await swReady();
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    } catch { /* 無視 */ }
  }
  // ログインした直後・画面に戻ってきたとき：通知をオンにしている人なら、届け先が生きているかを確かめる（ふだんは通信なし）
  async function syncPush() {
    if (!S.user || S.user.must_change_pw || !wantsPush()) { P.on = false; return; }
    if (!DEMO && (!pushSupported() || Notification.permission !== 'granted')) { P.on = false; return; }
    try { await pushOn(S.pushKey); } catch { P.on = false; }
  }
  async function checkUnread(force) {
    if (!S.token || !S.user || S.user.must_change_pw || P.busy) return;
    if (!force && Date.now() - P.at < 10000) return; // 画面を切り替えるたびに聞きすぎない
    P.busy = true; P.at = Date.now();
    try {
      const r = await api('GET', '/api/unread', null, { passive: true });
      if (S.token) setTitle(r.unread);
    } catch { /* 取れなくても画面はそのまま使える */ } finally { P.busy = false; }
  }
  // 合図が届いた／画面に戻ってきた：未読の数と、いま開いている画面を1回だけ取り直す
  function refreshNow() {
    if (!S.token || !S.user) return;
    checkUnread(true);
    if (S.refresh) S.refresh(true);
  }
  // 画面の自動更新の予備。合図を受け取れる端末では10分に1回まで、受け取れない端末では plainMs ごと（どちらも画面を見ているときだけ）
  function watch(plainMs, fn) {
    S.timers.push(setInterval(() => {
      if (document.hidden) return;
      const gap = Date.now() - P.last;
      if (P.on ? gap >= SAFETY_MS : gap >= plainMs - 500) fn(true);
    }, Math.min(plainMs, 20000)));
  }
  // サービスワーカーから「合図が届いた」と知らせが来たら
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const t = e.data && e.data.type;
      if (t === 'careble:new') refreshNow();
      if (t === 'careble:resub') { safeSet(localStorage, 'push_ep', null); syncPush(); }
    });
  }
  // デモ：サーバーの代わりに、ブラウザの中で合図をまねする
  function localNotice(body) {
    try { const nt = new Notification(APP_TITLE, { body, tag: 'careble-new', icon: 'icon-192.png' }); nt.onclick = () => { window.focus(); nt.close(); }; } catch { /* 無視 */ }
  }
  addEventListener('careble-signal', () => {
    if (!P.on) return;
    if ((document.hidden || !document.hasFocus()) && 'Notification' in window && Notification.permission === 'granted') localNotice('新しい連絡があります。開いて確認してください');
    refreshNow();
  });
  // ほかのタブ・ほかのソフトから戻ってきたら、すぐに数と画面を最新にする
  addEventListener('focus', () => { if (S.token && Date.now() - P.last > 3000) refreshNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !S.token) return;
    refreshNow();
    syncPush();
  });

  // 通知のオン・オフ（メニュー・一覧の案内から）
  function blockedHelp() {
    dialog('通知がブロックされています', h('div', null,
      h('p', null, 'このブラウザで、ケアブルの通知が「ブロック」になっています。次の手順で「許可」に変えると、使えるようになります。'),
      h('ol', { class: 'steps' },
        h('li', null, 'アドレス欄の左はしにあるマーク（鍵や設定の絵）を押します。'),
        h('li', null, '「通知」を「許可」に変えます。'),
        h('li', null, 'このページを再読み込みして、もう一度このボタンを押します。'))),
    (close) => [h('button', { class: 'btn', onclick: close }, 'わかりました')]);
  }
  async function toggleNotify() {
    if (!DEMO && !pushSupported()) {
      dialog('このブラウザは通知に対応していません', h('p', null, 'パソコンの Chrome・Edge・Firefox・Safari でケアブルを開くと、通知を受け取れます。'),
        (close) => [h('button', { class: 'btn', onclick: close }, 'わかりました')]);
      return;
    }
    if ('Notification' in window && Notification.permission === 'denied') { blockedHelp(); return; }
    if (P.on) {
      safeSet(localStorage, notifyKey(), null);
      await pushOff();
      toast('このパソコンへの通知をオフにしました'); route(); return;
    }
    let perm = 'Notification' in window ? Notification.permission : 'default';
    if (perm !== 'granted' && 'Notification' in window) { try { perm = await Notification.requestPermission(); } catch { perm = 'default'; } }
    if (perm !== 'granted' && !DEMO) { if (perm === 'denied') blockedHelp(); else toast('通知が許可されませんでした', true); route(); return; }
    try { await pushOn(); } catch (ex) { toast(ex.message, true); route(); return; }
    safeSet(localStorage, notifyKey(), '1');
    toast('通知をオンにしました。ケアブルを閉じていても届きます');
    route();
  }
  function notifyHint() {
    if (!DEMO && !pushSupported()) return 'このブラウザは対応していません（パソコンの Chrome・Edge・Firefox・Safari で使えます）';
    if ('Notification' in window && Notification.permission === 'denied') return 'ブラウザでブロックされています。押すと直し方が出ます';
    if (P.on) return 'ケアブルを閉じていても、ブラウザが起動していれば届きます。ログアウトすると、このパソコンには届かなくなります。押すとオフ';
    return '押すとオンにできます。ほかの作業中やケアブルを閉じているときも、新しい連絡に気づけます';
  }
  // 一覧の上に出す案内（通知をまだオンにしていない人だけ。「あとで」を押したら7日間出さない）
  function notifyInvite() {
    if (P.on || (!DEMO && !pushSupported()) || ('Notification' in window && Notification.permission === 'denied')) return null;
    if (Number(safeGet(localStorage, 'notify_later') || 0) > Date.now()) return null;
    const box = h('div', { class: 'invite', role: 'note' },
      h('div', { class: 'invite-text' }, h('b', null, '🔔 新しい連絡を、通知で受け取れます'), h('br'),
        h('span', null, 'ケアブルを閉じていても、連絡が届いた瞬間にパソコンの画面のすみでお知らせします。')),
      h('div', { class: 'invite-btns' },
        h('button', { class: 'btn', type: 'button', onclick: toggleNotify }, 'オンにする'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => { safeSet(localStorage, 'notify_later', String(Date.now() + 7 * 864e5)); box.remove(); } }, 'あとで')));
    return box;
  }

  // ---------- 画面共通 ----------
  function topbar(title, { back, sub, right, dog } = {}) {
    return h('header', { class: 'topbar' },
      back ? h('button', { class: 'iconbtn', 'aria-label': '戻る', onclick: back }, '＜ 戻る') : null,
      dog ? h('span', { class: 'dog small', 'aria-hidden': 'true' }) : null,
      h('h1', null, title, sub ? h('span', { class: 'sub' }, sub) : null),
      h('div', { class: 'top-right' }, sizeButton(), right || null),
    );
  }
  function menuButton() { return h('button', { class: 'iconbtn', 'aria-label': 'メニュー', onclick: () => go('#/menu') }, '☰ メニュー'); }
  function initial(name) { return (name || '？').trim().charAt(0); }

  function dialog(title, body, actions) {
    const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const opener = document.activeElement;
    const esc = (e) => { if (e.key === 'Escape' && ov === [...document.querySelectorAll('.overlay')].pop()) close(); };
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); if (opener && opener.isConnected) opener.focus(); };
    ov.append(h('div', { class: 'dialog' }, h('h2', null, title), body, h('div', { class: 'actions' }, actions(close))));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', esc);
    document.body.append(ov);
    const first = ov.querySelector('input:not([readonly]), textarea, select');
    if (first) first.focus();
    return close;
  }

  // 削除の確認：「削除します」にチェックを入れてから押す（うっかり押しを防ぐ）
  function confirmDelete(title, lines, run) {
    const chk = h('input', { type: 'checkbox' });
    const err = h('p', { class: 'error' });
    dialog('削除の確認', h('div', null,
      h('p', null, h('b', null, title)),
      h('ul', { class: 'warnlist' }, lines.map((l) => h('li', null, l))),
      h('label', { class: 'check' }, chk, ' 内容を確認しました。削除します'), err),
    (close) => {
      const go2 = h('button', { class: 'btn danger', disabled: true, onclick: async () => {
        go2.disabled = true;
        try { await run(); close(); } catch (ex) { err.textContent = ex.message; go2.disabled = false; }
      } }, '削除する');
      chk.addEventListener('change', () => { go2.disabled = !chk.checked; });
      return [h('button', { class: 'btn secondary', onclick: close }, 'やめる'), go2];
    });
  }

  // はい／いいえ の確認（ブラウザの確認ダイアログは使わない）
  function askYes(msg) {
    return new Promise((resolve) => {
      dialog('確認', h('p', null, msg), (close) => [
        h('button', { class: 'btn secondary', onclick: () => { close(); resolve(false); } }, 'いいえ'),
        h('button', { class: 'btn', onclick: () => { close(); resolve(true); } }, 'はい'),
      ]);
    });
  }

  // ---------- ルーティング ----------
  function go(hash) {
    if (MEM) { memHash = hash; app.style.height = ''; window.scrollTo(0, 0); route(); return; }
    if (location.hash === hash) route(); else location.hash = hash;
  }
  addEventListener('hashchange', route);

  async function route() {
    clearTimers();
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    dropUrls();
    if (!S.token) return renderLogin();
    if (!S.user) {
      try { const me = await api('GET', '/api/me'); S.user = me.user; S.pushKey = me.push_key || null; useUserSize(S.user); } catch { return; }
    }
    if (!P.synced && !S.user.must_change_pw) { P.synced = true; syncPush(); }
    if (S.user.must_change_pw) return renderPassword(true);
    checkUnread();
    const parts = (curHash() || '#/').slice(2).split('/');
    const [a, b, c] = parts;
    if (a === 'room' && b) return renderChat(Number(b));
    if (a === 'offices') return renderHome('offices');
    if (a === 'office' && b) return renderHome('clients', Number(b));
    if (a === 'menu') return renderMenu();
    if (a === 'links' && S.user.role === 'provider') return renderLinks();
    if (a === 'password') return renderPassword(false);
    if (a === 'manage' && S.user.role === 'cm') return renderManage(b || 'clients', c);
    return renderHome('clients');
  }

  // ---------- ログイン ----------
  function renderLogin(msg) {
    const err = h('p', { class: 'error', role: 'alert' }, msg || '');
    const idIn = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pwIn = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const showPw = h('input', { type: 'checkbox', onchange: (e) => { pwIn.type = e.target.checked ? 'text' : 'password'; } });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'ログイン');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        try {
          const r = await api('POST', '/api/login', { login_id: normId(idIn.value), password: pwIn.value });
          S.token = r.token; S.user = r.user; S.lastActive = Date.now(); useUserSize(r.user);
          safeSet(sessionStorage, 'token', r.token);
          go('#/');
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; pwIn.value = ''; pwIn.focus(); }
      },
    },
      h('label', { class: 'field' }, 'ログインID', idIn),
      h('label', { class: 'field' }, 'パスワード', pwIn),
      h('label', { class: 'check' }, showPw, 'パスワードを表示する'),
      err, btn,
    );
    mount(h('div', { class: 'login-top' }, sizeButton(true)), h('main', { class: 'login' },
      h('div', { class: 'logo' }, 'ケアブル'),
      h('p', { class: 'tagline' }, 'ケアマネジャーと事業所をつなぐ連絡帳'),
      API === 'demo' ? h('div', { class: 'demo-note' }, h('b', null, 'デモモードで動いています'), h('br'),
        'ケアマネ：cm-demo / cm2-demo　事業所：office-demo / nurse-demo / day-demo', h('br'), 'パスワード（共通）：Demo-pass-123', h('br'),
        h('span', { class: 'hint' }, '見本データです。再読み込みすると元に戻ります。')) : null,
      form,
      isApp() ? null : h('p', { class: 'installrow' }, h('button', { type: 'button', class: 'btn secondary block', onclick: installApp }, '📲 ホーム画面に追加（アプリにする）')),
      h('div', { class: 'secure-note' }, '🔒 安心してお使いいただけます',
        h('ul', null,
          h('li', null, '通信と保存データはすべて暗号化しています'),
          h('li', null, '5回続けて間違えると15分間ロックされます'),
          h('li', null, '30分操作がないと自動でログアウトします'),
          h('li', null, 'だれがいつ見たかを記録しています'),
        )),
    ));
    if (API !== 'demo') app.querySelector('main.login').append(h('p', { class: 'setup-link' }, h('button', { type: 'button', class: 'linkbtn', onclick: renderSetup }, 'はじめての設定（最初のケアマネジャー登録）')));
    idIn.focus();
  }

  // 最初のケアマネ登録（Cloudflare に登録した SETUP_TOKEN が必要）
  function renderSetup() {
    const err = h('p', { class: 'error', role: 'alert' });
    const tok = h('input', { type: 'password', id: 'setup-token', autocomplete: 'off' });
    const name = h('input', { type: 'text', id: 'setup-name', maxlength: '50' });
    const lid = h('input', { type: 'text', id: 'setup-id', autocapitalize: 'off', spellcheck: 'false', maxlength: '64' });
    const prefSel = h('select', { id: 'setup-pref' }, h('option', { value: '' }, '（都道府県をえらぶ）'), PREFS.map((x) => h('option', { value: x }, x)));
    const pw = h('input', { type: 'password', id: 'setup-pw', autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', id: 'setup-pw2', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, '登録する');
    mount(h('div', { class: 'login-top' }, sizeButton(true)), h('main', { class: 'login' },
      h('h2', null, 'ケアマネジャーの登録'),
      h('p', { class: 'testnote' }, 'テスト仕様です。現状は、登録できません。'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        lid.value = normId(lid.value);
        if (!/^[A-Za-z0-9._-]{4,64}$/.test(lid.value)) { err.textContent = 'ログインIDは、半角の英字・数字で4文字以上にしてください（例：1234）'; return; }
        if (!prefSel.value) { err.textContent = '都道府県をえらんでください'; prefSel.focus(); return; }
        if (pw.value.length < 10) { err.textContent = `パスワードは10文字以上にしてください（いま ${pw.value.length}文字です）`; return; }
        if (pw.value !== pw2.value) { err.textContent = 'パスワードが一致しません'; return; }
        btn.disabled = true;
        try {
          await api('POST', '/api/setup', { setup_token: tok.value, name: name.value, login_id: normId(lid.value), password: pw.value, pref: prefSel.value });
          renderLogin('登録しました。いま決めたログインIDとパスワードでログインしてください');
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      } },
        h('label', { class: 'field' }, 'セットアップキー', tok),
        h('label', { class: 'field' }, '氏名', name),
        h('label', { class: 'field' }, '基本の都道府県', h('span', { class: 'hint' }, '（事業所をさがすときに、最初からこの県がえらばれます。あとで変更できます）'), prefSel),
        h('label', { class: 'field' }, 'ログインID', h('span', { class: 'hint' }, '（半角の英字・数字で4文字以上。数字だけでも大丈夫です。例：1234）'), lid),
        h('label', { class: 'field' }, 'パスワード', h('span', { class: 'hint' }, '（10文字以上・英字と数字など2種類以上）'), pw),
        h('label', { class: 'field' }, 'パスワード（確認）', pw2),
        err, btn),
      h('p', null, h('button', { type: 'button', class: 'btn secondary block', onclick: () => renderLogin() }, 'ログイン画面に戻る'))));
    tok.focus();
  }

  // 右上の「文字」ボタン：押すたびに 大 ⇔ 通常 が切り替わる
  function sizeButton(light) {
    const cur = h('span', { class: 'cur' }, sizeLabel());
    const btn = h('button', { type: 'button', class: 'sizebtn' + (light ? ' light' : ''), 'aria-label': `文字の大きさ（いまは${sizeLabel()}。押すと切り替わります）` },
      h('span', { class: 'aa', 'aria-hidden': 'true' }, 'あ'), '文字', cur);
    btn.addEventListener('click', () => {
      const i = SIZES.findIndex(([k]) => k === document.documentElement.dataset.size);
      const next = SIZES[(i + 1) % SIZES.length][0];
      applySize(next);
      if (S.token && S.user) {
        S.user.font_size = next;
        api('POST', '/api/me/prefs', { font_size: next }).catch(() => { /* 保存できなくても表示は変える */ });
      }
    });
    return h('div', { class: 'sizewrap' }, btn);
  }

  // ---------- パスワード変更 ----------
  function renderPassword(forced) {
    const err = h('p', { class: 'error', role: 'alert' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nx = h('input', { type: 'password', autocomplete: 'new-password' });
    const nx2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, '変更する');
    mount(
      topbar('パスワード変更', forced ? {} : { back: () => go('#/menu') }),
      h('main', { class: 'page' },
        forced ? h('p', { class: 'card' }, '初めてのログインです。安全のため、ご自身だけが知っているパスワードに変更してください。') : null,
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault(); err.textContent = '';
            if (nx.value !== nx2.value) { err.textContent = '新しいパスワードが一致しません'; return; }
            btn.disabled = true;
            try {
              await api('POST', '/api/password', { current: cur.value, next: nx.value });
              S.user.must_change_pw = false;
              toast('パスワードを変更しました');
              go('#/');
            } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
          },
        },
          h('label', { class: 'field' }, '現在のパスワード', cur),
          h('label', { class: 'field' }, '新しいパスワード', h('span', { class: 'hint' }, '（10文字以上・英字と数字など2種類以上）'), nx),
          h('label', { class: 'field' }, '新しいパスワード（確認）', nx2),
          err, btn),
        forced ? h('p', null, h('button', { class: 'btn secondary block', type: 'button', onclick: doLogout }, 'ログアウト')) : null,
      ));
    cur.focus();
  }

  // 自分でログアウトしたら、このパソコンへの通知も止める（共用のパソコンで、次の人に届かないように）
  // ※ 30分操作がなくて自動でログアウトしたときは止めない（席を外していても、新しい連絡に気づけるように）
  async function doLogout() {
    await pushOff();
    try { await api('POST', '/api/logout'); } catch { /* 無視 */ }
    logoutLocal('ログアウトしました');
  }

  // ---------- サービス種別 ----------
  // 介護保険のサービス種別。「居宅サービス」「入所サービス」の2つの大分類の下に並べます
  const TYPE_GROUPS = [
    ['居宅サービス', ['訪問介護', '訪問入浴介護', '訪問看護', '訪問リハビリテーション', '居宅療養管理指導', '通所介護', '地域密着型通所介護', '認知症対応型通所介護',
      '通所リハビリテーション', '短期入所生活介護', '短期入所療養介護', '小規模多機能型居宅介護', '看護小規模多機能型居宅介護', '定期巡回・随時対応型訪問介護看護',
      '夜間対応型訪問介護', '福祉用具貸与', '特定福祉用具販売', '住宅改修', '居宅介護支援', 'その他']],
    ['入所サービス', ['介護老人福祉施設（特養）', '地域密着型介護老人福祉施設', '介護老人保健施設（老健）', '介護医療院', '特定施設入居者生活介護',
      '地域密着型特定施設入居者生活介護', '認知症対応型共同生活介護（グループホーム）']],
  ];
  const ALL_TYPES = TYPE_GROUPS.flatMap(([, l]) => l);
  // いま選んでいる絞り込み：'all'（すべて）／'g:居宅サービス'（大分類）／種別名
  const svcGroup = () => (S.svc && S.svc.startsWith('g:') ? S.svc.slice(2) : (TYPE_GROUPS.find(([, l]) => l.includes(S.svc)) || [null])[0]);
  const svcTypes = () => (!S.svc || S.svc === 'all' ? null : S.svc.startsWith('g:') ? TYPE_GROUPS.find(([g]) => g === S.svc.slice(2))[1] : [S.svc]);
  const svcLabel = () => (S.svc.startsWith('g:') ? S.svc.slice(2) : S.svc);
  const typeOptions = (selected) => TYPE_GROUPS.map(([g, l]) => h('optgroup', { label: g }, l.map((t) => h('option', { value: t, selected: selected === t }, t))));
  // 公開データ（名簿）がない種別
  const NO_DIRECTORY = ['居宅療養管理指導', '住宅改修', 'その他'];
  const TYPE_CLASS = { 通所介護: 't-day', 地域密着型通所介護: 't-day', 認知症対応型通所介護: 't-day', 訪問介護: 't-home', 夜間対応型訪問介護: 't-home', 訪問看護: 't-nurse' };
  const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  function typeTag(t) { return h('span', { class: 'stype ' + (TYPE_CLASS[t] || 't-other') }, t || 'その他'); }
  function officeLabel(o) { return `${o.service_type ? o.service_type + '：' : ''}${o.name}`; }

  // ---------- ホーム（トーク一覧） ----------
  async function renderHome(tab, officeId) {
    const isCm = S.user.role === 'cm';
    if (!S.svc) S.svc = 'all';
    const title = isCm ? 'ケアブル' : (S.user.office ? S.user.office.name : 'ケアブル');
    const listBox = h('div', null, h('p', { class: 'empty loading' }, '読み込み中…'));
    const tabs = isCm ? h('nav', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(tab === 'clients'), onclick: () => go('#/') }, '👤 利用者ごと'),
      h('button', { role: 'tab', 'aria-selected': String(tab === 'offices'), onclick: () => go('#/offices') }, '🏢 事業所ごと'),
    ) : null;
    const chipBox = h('div', { class: 'typebar', role: 'group', 'aria-label': 'サービス種別で切り替え' });
    const search = h('input', { type: 'search', id: 'room-search', placeholder: '🔍 名前でさがす', 'aria-label': '利用者の名前でさがす', value: S.q || '' });
    const searchBox = tab === 'clients' && !officeId ? h('div', { class: 'searchbar' }, search) : null;
    // 事業所：複数のケアマネとつながっているときは、ケアマネで絞り込める
    const cmBox = !isCm ? h('div', { class: 'typebar', role: 'group', 'aria-label': 'ケアマネジャーで切り替え' }) : null;
    const notice = !isCm ? h('button', { class: 'notice', hidden: true, onclick: () => go('#/links') }) : null;
    function drawNotice() {
      if (!notice) return;
      notice.hidden = !S.user.pending;
      fill(notice, `🔔 ケアマネジャーから「つながる依頼」が ${S.user.pending || 0}件 届いています`, h('span', { class: 'go' }, '確認する ›'));
    }
    drawNotice();
    mount(topbar(title, { sub: `${S.user.name} さん`, right: menuButton(), dog: true }), tabs, notice, notifyInvite(), isCm && !officeId ? chipBox : cmBox, searchBox, h('main', null, listBox));
    if (!isCm && S.cmFilter == null) S.cmFilter = 'all';
    let cms = [];
    function drawCms() {
      if (!cmBox) return;
      if (cms.length < 2) { cmBox.hidden = true; return; }
      cmBox.hidden = false;
      fill(cmBox, h('div', { class: 'chiprow' },
        h('button', { type: 'button', class: 'chip grp', 'aria-pressed': String(S.cmFilter === 'all'), onclick: () => { S.cmFilter = 'all'; drawCms(); drawRooms(); } }, 'すべて'),
        cms.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.cmFilter === c.id), onclick: () => { S.cmFilter = c.id; drawCms(); drawRooms(); } },
          c.name, h('span', { class: 'cnt' }, `${rooms.filter((r) => r.cm && r.cm.id === c.id).length}`)))));
    }

    let offices = [], rooms = [];
    function drawChips() {
      const count = (list) => offices.filter((o) => o.active && list.includes(o.service_type)).length;
      const grp = svcGroup();
      const sub = TYPE_GROUPS.find(([g]) => g === grp);
      fill(chipBox,
        h('div', { class: 'chiprow' },
          h('button', { type: 'button', class: 'chip grp', 'aria-pressed': String(S.svc === 'all'), onclick: () => setSvc('all') }, 'すべて'),
          TYPE_GROUPS.map(([g, l]) => h('button', { type: 'button', class: 'chip grp', 'aria-pressed': String(grp === g), 'aria-expanded': String(grp === g), onclick: () => setSvc('g:' + g) },
            g, h('span', { class: 'cnt' }, `${count(l)}`), h('span', { class: 'arrow', 'aria-hidden': 'true' }, grp === g ? '▲' : '▼')))),
        sub ? h('div', { class: 'chiprow sub', role: 'group', 'aria-label': sub[0] + 'の種別' },
          h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.svc === 'g:' + sub[0]), onclick: () => setSvc('g:' + sub[0]) }, sub[0] + 'すべて'),
          sub[1].map((t) => h('button', { type: 'button', class: 'chip ' + (TYPE_CLASS[t] || 't-other') + (count([t]) ? '' : ' none'), 'aria-pressed': String(S.svc === t), onclick: () => setSvc(t) },
            t, h('span', { class: 'cnt' }, `${count([t])}`)))) : null);
    }
    function setSvc(t) { S.svc = t; drawChips(); load(); }

    function drawRooms() {
      const q = (S.q || '').trim();
      const base = !isCm && S.cmFilter !== 'all' && cms.some((c) => c.id === S.cmFilter) ? rooms.filter((r) => r.cm && r.cm.id === S.cmFilter) : rooms;
      const shown = q ? base.filter((r) => r.name.replace(/\s/g, '').includes(q.replace(/\s/g, ''))) : base;
      const nodes = [];
      if (officeId) {
        const o = offices.find((x) => x.id === officeId);
        nodes.push(h('div', { class: 'filter-chip' }, h('span', null, o ? typeTag(o.service_type) : null, ' ', o ? o.name : '選択した事業所', ' の利用者'),
          h('button', { class: 'btn secondary', onclick: () => go('#/offices') }, '事業所一覧へ')));
      } else if (isCm && S.svc !== 'all') {
        nodes.push(h('p', { class: 'listhead' }, `${svcLabel()}を利用している方：${shown.length}人`));
      } else if (!isCm && S.cmFilter !== 'all' && cms.length > 1) {
        nodes.push(h('p', { class: 'listhead' }, `${(cms.find((c) => c.id === S.cmFilter) || {}).name || ''} さんの担当：${shown.length}人`));
      } else {
        nodes.push(h('p', { class: 'listhead' }, `${q ? '該当' : '利用者'}：${shown.length}人`));
      }
      nodes.push(shown.length ? h('ul', { class: 'list' }, shown.map((r) => h('li', null,
        h('button', { onclick: () => go('#/room/' + r.id), 'aria-label': `${r.name} さんのトーク${r.unread ? `、未読${r.unread}件` : ''}` },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial(r.name)),
          h('span', { class: 'main' },
            h('div', { class: 'name' }, r.name, ' 様'),
            h('div', { class: 'preview' }, r.last_message || 'メッセージはまだありません'),
            isCm ? h('div', { class: 'meta' }, r.offices.length ? r.offices.map((o) => typeTag(o.service_type)) : '共有している事業所なし')
              : r.cm && cms.length > 1 ? h('div', { class: 'meta' }, h('span', { class: 'tag cmtag' }, '担当ケアマネ：', r.cm.name)) : null),
          h('span', { class: 'right' }, fmtShort(r.last_at), h('br'), r.unread ? h('span', { class: 'badge' }, r.unread > 99 ? '99+' : r.unread) : null),
        )))) : h('p', { class: 'empty' }, q ? `「${q}」に当てはまる利用者はいません。` : isCm ? (S.svc !== 'all' ? `${svcLabel()}の事業所と共有している利用者はいません。` : 'まだ利用者が登録されていません。メニュー →「利用者の管理」から登録できます。') : '共有されている利用者はまだいません。'));
      fill(listBox, ...nodes);
    }
    search.addEventListener('input', () => { S.q = search.value; drawRooms(); });

    function drawOffices() {
      const sel = svcTypes();
      const act = offices.filter((o) => o.active && (!sel || sel.includes(o.service_type)));
      if (!act.length) {
        fill(listBox, h('p', { class: 'empty' }, S.svc === 'all' ? 'まだ事業所が登録されていません。メニュー →「事業所の管理」から登録できます。' : `${svcLabel()}の事業所はまだ登録されていません。`));
        return;
      }
      const groups = ALL_TYPES.map((t) => [t, act.filter((o) => (o.service_type || 'その他') === t)]).filter(([, l]) => l.length);
      fill(listBox, groups.map(([t, list]) => [
        h('h2', { class: 'grouphead' }, typeTag(t), ` ${list.length}事業所`),
        h('ul', { class: 'list' }, list.map((o) => h('li', null,
          h('button', { onclick: () => go('#/office/' + o.id) },
            h('span', { class: 'avatar office ' + (TYPE_CLASS[o.service_type] || 't-other'), 'aria-hidden': 'true' }, initial(o.name)),
            h('span', { class: 'main' },
              h('div', { class: 'name' }, o.name),
              h('div', { class: 'meta' }, `担当利用者 ${o.client_count}人・${o.can_post ? '返信できる' : '閲覧のみ'}`)),
          )))),
      ]));
    }

    const load = async (passive) => {
      try {
        // 合図を受けての取り直しでは、変わりやすい「一覧」だけを取る（事業所の一覧などは取り直さない）
        if (isCm && !(passive && offices.length)) {
          offices = (await api('GET', '/api/offices')).offices;
          if (!officeId) drawChips();
        }
        if (tab === 'offices') { drawOffices(); return; }
        const sel = isCm && !officeId ? svcTypes() : null;
        const q = officeId ? `?office_id=${officeId}` : (sel && sel.length === 1 ? `?service_type=${encodeURIComponent(sel[0])}` : '');
        const got = await api('GET', '/api/rooms' + q, null, { passive });
        rooms = got.rooms;
        if (!isCm) {
          cms = got.cms || []; drawCms();
          if (!passive) { try { S.user = (await api('GET', '/api/me')).user; drawNotice(); } catch { /* そのまま */ } }
        }
        // 大分類（居宅・入所）で絞るときは、画面側でまとめて絞り込む
        if (sel && sel.length > 1) rooms = rooms.filter((r) => r.offices.some((o) => sel.includes(o.service_type)));
        drawRooms();
      } catch (ex) { if (!passive) fill(listBox, h('p', { class: 'empty error' }, ex.message)); }
    };
    await load();
    watch(60000, load);
    S.refresh = load;
  }


  // ---------- 添付ファイル ----------
  const MAX_FILE = 5 * 1024 * 1024;
  const blobCache = new Map();
  // 写真・PDFを表示するための一時的なアドレス。画面を切り替えたとき・ログアウトしたときに必ず破棄する
  const liveUrls = new Set();
  function objUrl(blob) { const u = URL.createObjectURL(blob); liveUrls.add(u); return u; }
  function dropUrls() { liveUrls.forEach((u) => URL.revokeObjectURL(u)); liveUrls.clear(); }
  async function apiRaw(method, path, { body, headers } = {}) {
    let res;
    try {
      res = await fetch(API + path, { method, body, headers: { ...(headers || {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, credentials: 'omit', cache: 'no-store' });
    } catch {
      throw new Error('通信できませんでした。電波の状態を確認してください');
    }
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch { /* 空 */ }
      if (res.status === 401 && S.token) logoutLocal(data.error || 'ログインしてください');
      throw new Error(data.error || 'ファイルを開けませんでした');
    }
    return res;
  }
  async function fileBlob(f) {
    if (!blobCache.has(f.id)) {
      blobCache.set(f.id, apiRaw('GET', '/api/attachments/' + f.id).then((r) => r.blob()).then((b) => new Blob([b], { type: f.mime })));
      blobCache.get(f.id).catch(() => blobCache.delete(f.id));
    }
    return blobCache.get(f.id);
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  function fileKind(f) { return f.mime.startsWith('image/') ? 'image' : f.mime === 'application/pdf' ? 'pdf' : 'csv'; }

  function viewer(title, content, extra) {
    const ov = h('div', { class: 'overlay viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    ov.append(h('div', { class: 'viewer-box' },
      h('div', { class: 'viewer-head' }, h('b', null, title), extra || null, h('button', { class: 'btn', type: 'button', onclick: close }, '✕ 閉じる')),
      h('div', { class: 'viewer-body' }, content)));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', esc);
    document.body.append(ov);
  }

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch { /* Excel の Shift_JIS */ }
    try { return new TextDecoder('shift_jis').decode(buf); } catch { return new TextDecoder().decode(buf); }
  }
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; if (rows.length > 500) break; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function openFile(f) {
    try {
      const blob = await fileBlob(f);
      const kind = fileKind(f);
      if (kind === 'image') {
        const url = objUrl(blob);
        viewer(f.name, h('img', { src: url, alt: f.name, class: 'viewer-img' }));
      } else if (kind === 'pdf') {
        const url = objUrl(blob);
        viewer(f.name, h('iframe', { src: url, title: f.name, class: 'viewer-pdf' }),
          h('a', { class: 'btn secondary', href: url, target: '_blank', rel: 'noopener' }, '別の画面で開く'));
      } else {
        const rows = parseCsv(decodeText(await blob.arrayBuffer())).filter((r) => r.some((c) => c !== ''));
        const [head, ...body] = rows;
        viewer(f.name, rows.length ? h('div', { class: 'csv-wrap' }, h('table', { class: 'csv' },
          h('thead', null, h('tr', null, (head || []).map((c) => h('th', null, c)))),
          h('tbody', null, body.slice(0, 500).map((r) => h('tr', null, r.map((c) => h('td', null, c))))))) : h('p', null, '中身が空です'));
      }
    } catch (ex) { toast(ex.message, true); }
  }

  function fileView(f) {
    const kind = fileKind(f);
    if (kind === 'image') {
      const img = h('img', { alt: f.name, class: 'thumb' });
      img.addEventListener('load', () => { const sc = img.closest('.chat-scroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < img.height + 200) sc.scrollTop = sc.scrollHeight; });
      const btn = h('button', { type: 'button', class: 'filethumb', 'aria-label': `写真「${f.name}」を大きく見る`, onclick: () => openFile(f) }, img, h('span', { class: 'loading' }, '写真を読み込み中…'));
      fileBlob(f).then((b) => { img.src = objUrl(b); btn.querySelector('.loading')?.remove(); })
        .catch(() => { btn.querySelector('.loading').textContent = '写真を表示できませんでした'; });
      return btn;
    }
    return h('button', { type: 'button', class: 'filecard', onclick: () => openFile(f) },
      h('span', { class: 'ficon ' + kind, 'aria-hidden': 'true' }, kind === 'pdf' ? 'PDF' : 'CSV'),
      h('span', { class: 'fmain' }, h('span', { class: 'fname' }, f.name), h('span', { class: 'fmeta' }, fmtSize(f.size), '・', kind === 'pdf' ? '押すと開きます' : '押すと表で見られます')));
  }

  async function prepareFile(file) {
    const name = file.name || 'ファイル';
    const lower = name.toLowerCase();
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('この写真は読み込めませんでした（JPEG・PNG に対応）')); img.src = url; });
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
        if (!blob) throw new Error('写真を変換できませんでした');
        return { blob, type: 'image/jpeg', name: name.replace(/\.[^.]+$/, '') + '.jpg', kind: 'image' };
      } finally { URL.revokeObjectURL(url); }
    }
    if (file.type === 'application/pdf' || lower.endsWith('.pdf')) return { blob: file, type: 'application/pdf', name, kind: 'pdf' };
    if (file.type === 'text/csv' || lower.endsWith('.csv')) return { blob: file, type: 'text/csv', name, kind: 'csv' };
    throw new Error('送れるのは写真、PDF、CSV です');
  }

  function confirmUpload(clientId, file, onDone) {
    prepareFile(file).then((pf) => {
      if (pf.blob.size > MAX_FILE) throw new Error(`ファイルが大きすぎます（${fmtSize(pf.blob.size)}）。5MBまで送れます`);
      const caption = h('textarea', { rows: '2', maxlength: '500', placeholder: 'ひとこと（なくても送れます）', id: 'upload-caption' });
      const err = h('p', { class: 'error' });
      const preview = pf.kind === 'image'
        ? h('img', { src: objUrl(pf.blob), alt: '', class: 'upload-preview' })
        : h('div', { class: 'filecard static' }, h('span', { class: 'ficon ' + pf.kind }, pf.kind === 'pdf' ? 'PDF' : 'CSV'),
          h('span', { class: 'fmain' }, h('span', { class: 'fname' }, pf.name), h('span', { class: 'fmeta' }, fmtSize(pf.blob.size))));
      dialog('このファイルを送りますか？', h('div', null, preview,
        pf.kind === 'image' ? h('p', { class: 'hint' }, `送信用に小さくしました（${fmtSize(pf.blob.size)}）`) : null,
        h('label', { class: 'field' }, 'ひとこと', caption),
        h('p', { class: 'hint' }, '🔒 ファイルは暗号化して保存され、この利用者を担当する事業所だけが見られます。'), err),
      (close) => {
        const sendBtn = h('button', { class: 'btn', onclick: async () => {
          sendBtn.disabled = true; err.textContent = '';
          try {
            await apiRaw('POST', `/api/rooms/${clientId}/attachments`, {
              body: pf.blob,
              headers: { 'Content-Type': pf.type, 'X-File-Name': encodeURIComponent(pf.name), 'X-Caption': encodeURIComponent(caption.value.trim()) },
            });
            close(); toast('送信しました'); onDone();
          } catch (ex) { err.textContent = ex.message; sendBtn.disabled = false; }
        } }, '送信する');
        return [h('button', { class: 'btn secondary', onclick: close }, 'やめる'), sendBtn];
      });
    }).catch((ex) => toast(ex.message, true));
  }

  // ---------- トーク画面 ----------
  async function renderChat(clientId) {
    const scroll = h('div', { class: 'chat-scroll', role: 'log', 'aria-label': 'メッセージ' });
    const bottom = h('div');
    const chat = h('div', { class: 'chat' }, scroll, bottom);
    const header = topbar('読み込み中…', { back: () => go('#/') });
    mount(header, chat);
    app.style.height = '100dvh';

    let lastId = 0, lastDay = '', roomName = '';
    const mineReadEls = new Map();
    const shown = new Set(); // 表示済みのメッセージ（同じものを2回出さない）

    try {
      const { rooms } = await api('GET', '/api/rooms');
      const r = rooms.find((x) => x.id === clientId);
      if (!r) throw new Error('この利用者は表示できません');
      roomName = r.name;
      header.replaceWith(topbar(r.name + ' 様', {
        back: () => go('#/'),
        sub: (r.cm ? `担当ケアマネ：${r.cm.name}　` : '') + (r.offices.length ? '共有先：' + r.offices.map(officeLabel).join('、') : '共有先の事業所なし'),
      }));
    } catch (ex) { scroll.replaceChildren(h('p', { class: 'empty error' }, ex.message)); return; }

    function addMessages(list) {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
      for (const m of list) {
        if (shown.has(m.id)) continue;
        shown.add(m.id);
        const day = fmtDay(m.created_at);
        if (day !== lastDay) { scroll.append(h('div', { class: 'daysep' }, h('span', null, day))); lastDay = day; }
        const readEl = m.mine ? h('div', null, m.read_count ? `既読 ${m.read_count}` : '') : null;
        if (readEl) mineReadEls.set(m.id, readEl);
        const who = m.mine ? null : h('div', { class: 'who' }, m.author, m.author_office ? `（${m.author_office}）` : (m.author_role === 'cm' ? '（ケアマネ）' : ''));
        scroll.append(h('div', { class: 'msg' + (m.mine ? ' mine' : '') }, who,
          h('div', { class: 'row' }, h('div', { class: 'bubble' + (m.file ? ' has-file' : '') }, m.file ? fileView(m.file) : null, m.file && m.body.startsWith('📎 ') ? null : h('div', { class: 'btext' }, m.body)), h('div', { class: 'time' }, readEl, fmtTime(m.created_at)))));
        lastId = Math.max(lastId, m.id);
      }
      if (list.length && (nearBottom || !lastId || list.some((m) => m.mine))) scroll.scrollTop = scroll.scrollHeight;
    }

    // サーバーが返す「ほかの人がどこまで読んだか」から、自分の投稿の既読数を更新
    function applyReads(reads) {
      if (!Array.isArray(reads)) return;
      for (const [id, el] of mineReadEls) {
        const n = reads.filter((x) => x >= id).length;
        el.textContent = n ? `既読 ${n}` : '';
      }
    }

    // 新しいメッセージの取り込みは、同時に1つだけ行う（重なると同じ吹き出しが2つ出るため）
    let pulling = null, sending = false;
    async function pull(passive) {
      while (pulling) { try { await pulling; } catch { /* 次へ */ } }
      pulling = (async () => {
        const more = await api('GET', `/api/rooms/${clientId}/messages?after=${lastId}`, null, { passive });
        if (more.messages.length) { scroll.querySelector('.empty')?.remove(); addMessages(more.messages); checkUnread(true); }
        applyReads(more.reads);
      })();
      try { await pulling; } finally { pulling = null; }
    }

    try {
      const { messages, can_post } = await api('GET', `/api/rooms/${clientId}/messages`);
      if (!messages.length) scroll.append(h('p', { class: 'empty' }, `${roomName} 様についての連絡はまだありません。`));
      addMessages(messages);
      scroll.scrollTop = scroll.scrollHeight;
      checkUnread(true); // いま開いて読んだ分を、タブの数から引く
      if (can_post) {
        const ta = h('textarea', { rows: '1', 'aria-label': 'メッセージを入力', placeholder: 'メッセージを入力', maxlength: '4000' });
        const send = h('button', { class: 'btn', type: 'submit' }, '送信');
        const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf,text/csv,.csv', hidden: true, id: 'file-input' });
        const refresh = () => pull();
        fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) confirmUpload(clientId, f, () => refresh().catch(() => {})); });
        const attach = h('button', { type: 'button', class: 'attachbtn', 'aria-label': '写真・PDF・CSVを送る', onclick: () => fileIn.click() }, '📎');
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; });
        bottom.replaceChildren(h('form', {
          class: 'composer',
          onsubmit: async (e) => {
            e.preventDefault();
            if (sending) return; // 送信中はもう一度押しても送らない
            const text = ta.value.trim();
            if (!text) return;
            sending = true; send.disabled = true; send.textContent = '送信中…';
            // 押した瞬間に入力欄を空にして、「送信中」の吹き出しをすぐ出す
            ta.value = ''; ta.style.height = 'auto';
            scroll.querySelector('.empty')?.remove();
            const temp = h('div', { class: 'msg mine sending' }, h('div', { class: 'row' }, h('div', { class: 'bubble' }, h('div', { class: 'btext' }, text)), h('div', { class: 'time' }, '送信中…')));
            scroll.append(temp); scroll.scrollTop = scroll.scrollHeight;
            try {
              await api('POST', `/api/rooms/${clientId}/messages`, { body: text });
              temp.remove();
              await pull();
            } catch (ex) {
              temp.remove();
              if (!ta.value) ta.value = text; // 送れなかったときは文字を戻す
              toast(ex.message, true);
            }
            sending = false; send.disabled = false; send.textContent = '送信'; ta.focus();
          },
        }, fileIn, attach, ta, send));
      } else {
        bottom.replaceChildren(h('div', { class: 'readonly-bar' }, '👀 閲覧のみです（返信はできません）'));
      }
    } catch (ex) { scroll.replaceChildren(h('p', { class: 'empty error' }, ex.message)); return; }

    // 相手の書き込みは、サーバーからの合図で取り込む。合図を受け取れない端末だけ、画面を見ているあいだ20秒ごとに確認する
    // 画面が裏にあるときは取り込まない（見ていないのに「既読」にならないように）。戻ってきた瞬間に取り込む
    const quietPull = async () => { if (sending || pulling || document.hidden) return; try { await pull(true); } catch { /* 次回再試行 */ } };
    watch(20000, quietPull);
    S.refresh = quietPull;
  }
  addEventListener('hashchange', () => { app.style.height = ''; });

  // ---------- メニュー ----------
  function renderMenu() {
    const isCm = S.user.role === 'cm';
    mount(topbar('メニュー', { back: () => go('#/') }),
      h('main', null,
        h('div', { class: 'page' },
          h('div', { class: 'card' },
            h('h3', null, S.user.name, ' さん'),
            h('div', { class: 'hint' }, isCm ? 'ケアマネジャー' : `${S.user.office?.name || ''}（${S.user.office?.can_post ? '返信できる' : '閲覧のみ'}）`),
            h('div', { class: 'hint' }, 'ログインID：', S.user.login_id))),
        !isCm ? h('ul', { class: 'menu' },
          h('li', null, h('button', { onclick: () => go('#/links') }, '🤝 つながっているケアマネジャー',
            S.user.pending ? h('span', { class: 'badge' }, S.user.pending) : null,
            h('span', { class: 'hint' }, S.user.pending ? '新しい依頼が届いています' : `${S.user.links || 0}人とつながっています`)))) : null,
        isCm ? h('h2', { class: 'menuhead' }, '登録・管理') : null,
        isCm ? h('ul', { class: 'menu' },
          h('li', null, h('button', { onclick: () => go('#/manage/clients') }, '👤 利用者の管理')),
          h('li', null, h('button', { onclick: () => go('#/manage/offices') }, '🏢 事業所の管理')),
          h('li', null, h('button', { onclick: () => go('#/manage/accounts') }, '🔑 サービス事業所アカウントの管理')),
          h('li', null, h('button', { onclick: editPref }, '📍 基本の都道府県',
            h('span', { class: 'hint' }, S.user.pref ? `いまは「${S.user.pref}」です。押すと変更できます` : 'まだ決まっていません。押すと登録できます')))) : null,
        h('details', { class: 'menufold' },
          h('summary', null, '安全のための設定・記録'),
          h('ul', { class: 'menu' },
          h('li', null, h('button', { onclick: () => go('#/password') }, '🔒 パスワード変更')),
          isCm ? h('li', null, h('button', { onclick: () => go('#/manage/audit') }, '📋 操作の記録（監査ログ）', h('span', { class: 'hint' }, 'だれが・いつ見たかを確認できます'))) : null)),
        h('ul', { class: 'menu' },
          h('li', null, h('button', { onclick: toggleNotify }, '🔔 新しい連絡のお知らせ（このパソコン）',
            h('span', { class: 'tag ' + (P.on ? 'ok' : '') }, P.on ? 'オン' : 'オフ'),
            h('span', { class: 'hint' }, notifyHint())))),
        isApp() ? null : h('ul', { class: 'menu' },
          h('li', null, h('button', { onclick: installApp }, '📲 ホーム画面に追加（アプリにする）',
            h('span', { class: 'hint' }, 'アイコンを押すだけで、すぐ開けるようになります')))),
        h('ul', { class: 'menu last' },
          h('li', null, h('button', { onclick: doLogout }, '🚪 ログアウト')))));
  }

  // 基本の都道府県（事業所をさがすときに、最初からえらばれる県）
  function editPref() {
    const sel = h('select', null, h('option', { value: '' }, '（都道府県をえらぶ）'), PREFS.map((x) => h('option', { value: x, selected: S.user.pref === x }, x)));
    const err = h('p', { class: 'error' });
    dialog('基本の都道府県', h('div', null,
      h('p', { class: 'hint' }, '事業所を追加するときに、最初からこの県の名簿が出ます。となりの県の事業所も、追加の画面で県を切り替えればさがせます。'),
      h('label', { class: 'field' }, '都道府県', sel), err),
    (close) => [
      h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
      h('button', { class: 'btn', onclick: async () => {
        if (!sel.value) { err.textContent = '都道府県をえらんでください'; return; }
        try {
          await api('POST', '/api/me/prefs', { pref: sel.value });
          S.user.pref = sel.value; close(); toast('保存しました'); route();
        } catch (ex) { err.textContent = ex.message; }
      } }, '保存'),
    ]);
  }

  // ---------- つながっているケアマネジャー（事業所のみ） ----------
  async function renderLinks() {
    const body = h('main', { class: 'page' }, h('p', { class: 'empty loading' }, '読み込み中…'));
    mount(topbar('つながっているケアマネジャー', { back: () => go('#/menu') }), body);
    const refresh = async () => { try { S.user = (await api('GET', '/api/me')).user; } catch { /* そのまま */ } route(); };
    let links;
    try { links = (await api('GET', '/api/links')).links; } catch (ex) { fill(body, h('p', { class: 'empty error' }, ex.message)); return; }
    const pending = links.filter((l) => l.status === 'pending');
    const active = links.filter((l) => l.status !== 'pending');
    const answer = (l, accept) => async () => {
      if (!accept && !(await askYes(`${l.cm_name} さんとのつながりを${l.status === 'pending' ? '断り' : '外し'}ますか？`))) return;
      try { await api('POST', `/api/links/${l.cm_id}/${accept ? 'accept' : 'remove'}`); toast(accept ? 'つながりました' : '外しました'); refresh(); } catch (ex) { toast(ex.message, true); }
    };
    fill(body,
      h('p', { class: 'hint' }, 'このログインIDひとつで、ここに並んでいるケアマネジャーの利用者をまとめて見られます。見えるのは、それぞれのケアマネジャーがこの事業所に共有した利用者だけです。'),
      pending.length ? [h('h2', { class: 'menuhead' }, `🔔 届いている依頼（${pending.length}件）`),
        pending.map((l) => h('div', { class: 'card pending' },
          h('h3', null, l.cm_name, ' さん（ケアマネジャー）'),
          h('div', { class: 'hint' }, 'この事業所を「', l.office_name, '」として登録しています'),
          h('div', { class: 'rowline' },
            h('button', { class: 'btn', onclick: answer(l, true) }, '承認する'),
            h('button', { class: 'btn secondary', onclick: answer(l, false) }, '断る'))))] : null,
      h('h2', { class: 'menuhead' }, `つながっているケアマネジャー（${active.length}人）`),
      active.length ? active.map((l) => h('div', { class: 'card' },
        h('h3', null, l.cm_name, ' さん'),
        h('div', { class: 'hint' }, '登録名：', l.office_name, '・', l.can_post ? '返信できる' : '閲覧のみ'),
        h('div', { class: 'rowline' },
          h('span', { class: 'tag ' + (l.active ? 'ok' : 'ng') }, l.active ? '共有中' : '停止中'),
          l.home ? h('span', { class: 'tag' }, 'このIDを発行したケアマネ') : null),
        l.home ? null : h('div', { class: 'rowline' }, h('button', { class: 'btn secondary', onclick: answer(l, false) }, 'つながりを外す')),
      )) : h('p', { class: 'empty' }, 'まだつながっているケアマネジャーはいません'),
    );
  }

  // ---------- 管理（ケアマネのみ） ----------
  async function renderManage(section) {
    const titles = { clients: '利用者の管理', offices: '事業所の管理', accounts: 'サービス事業所アカウント', audit: '操作の記録' };
    const body = h('main', { class: 'page' }, h('p', { class: 'empty loading' }, '読み込み中…'));
    mount(topbar(titles[section] || '管理', { back: () => go('#/menu') }), body);
    try {
      if (section === 'offices') await manageOffices(body);
      else if (section === 'accounts') await manageAccounts(body);
      else if (section === 'audit') await manageAudit(body);
      else await manageClients(body);
    } catch (ex) { fill(body, h('p', { class: 'empty error' }, ex.message)); }
  }
  const reload = () => route();

  // ---------- 事業所の名簿（厚生労働省の公開データ）を取り込む ----------
  // CSV の1行を項目に分ける（"..." で囲まれた項目の中のカンマ・改行にも対応）
  function parseCsvRows(text, onRow) {
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); cell = ''; onRow(row); row = []; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); onRow(row); }
  }
  const dirCache = new Map(); // 読み込んだ名簿（県|種別ごと）
  async function importDirectory(pref, type, codes, progress) {
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k];
      const step = codes.length > 1 ? `（${k + 1}/${codes.length}）` : '';
      progress(`${pref}の「${type}」の名簿を、厚生労働省の公開データから取得しています${step}… 1分ほどかかることがあります。`);
      let res;
      try {
        res = await fetch(API + '/api/directory/source?code=' + code, { headers: { Authorization: 'Bearer ' + S.token }, credentials: 'omit', cache: 'no-store' });
      } catch { throw new Error('名簿を取得できませんでした。電波の状態を確認してください'); }
      if (!res.ok) { let d = {}; try { d = await res.json(); } catch { /* 空 */ } throw new Error(d.error || '名簿を取得できませんでした'); }
      const source = decodeURIComponent(res.headers.get('X-Source') || '');
      const buf = await res.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('shift_jis').decode(buf); }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      progress(`${pref}の事業所をえらび出しています${step}…`);
      let col = null; const rows = [];
      parseCsvRows(text, (r) => {
        if (!col) {
          const at = (...names) => r.findIndex((x) => names.some((n) => x.trim().startsWith(n)));
          col = { pref: at('都道府県名'), city: at('市区町村名'), name: at('事業所名'), addr: at('住所'), bld: at('方書'), tel: at('電話番号'), no: at('事業所番号') };
          if (col.pref < 0 || col.city < 0 || col.name < 0) throw new Error('公開データの形式が変わったため、取り込めませんでした');
          return;
        }
        if ((r[col.pref] || '').trim() !== pref) return;
        rows.push([r[col.city] || '', r[col.name] || '', ((r[col.addr] || '') + ' ' + (r[col.bld] || '')).trim(), r[col.tel] || '', r[col.no] || '']);
      });
      const SIZE = 300;
      for (let i = 0; i === 0 || i < rows.length; i += SIZE) {
        progress(`保存しています${step}… ${Math.min(i + SIZE, rows.length)} / ${rows.length}件`);
        await api('POST', '/api/directory/import', { pref, code, reset: i === 0, done: i + SIZE >= rows.length, source, rows: rows.slice(i, i + SIZE) });
      }
    }
  }

  async function manageOffices(body) {
    const { offices } = await api('GET', '/api/offices');
    const openForm = (o) => {
      const name = h('input', { type: 'text', value: o?.name || '', maxlength: '60' });
      const svc = h('select', null, typeOptions(o?.service_type || (ALL_TYPES.includes(S.svc) ? S.svc : '訪問介護')));
      const canPost = h('input', { type: 'checkbox', checked: o?.can_post });
      const err = h('p', { class: 'error' });
      // 新しく追加するときだけ：県 → 市区町村 → 名簿からえらぶ
      const pref = h('select', null, h('option', { value: '' }, '（都道府県をえらぶ）'), PREFS.map((x) => h('option', { value: x, selected: (S.user.pref || safeGet(localStorage, 'pref')) === x }, x)));
      const city = h('select', { disabled: true }, h('option', { value: '' }, '（市区町村をえらぶ）'));
      const kw = h('input', { type: 'search', placeholder: '🔍 事業所名でさがす', 'aria-label': '事業所名でさがす' });
      const pickBox = h('div', { class: 'pickbox' });
      let seq = 0;
      const note = (text, cls) => fill(pickBox, h('p', { class: cls || 'hint' }, text));
      // 名簿は県と種別ごとに一度だけ読み込み、あとは画面の中でしぼり込む（待ち時間なし）
      let all = [];
      const squash = (v) => String(v || '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
      function showList() {
        const q = squash(kw.value);
        if (!city.value && !q) return fill(pickBox, h('p', { class: 'hint' }, '市区町村をえらぶか、事業所名でさがしてください。'), dirFoot);
        const hit = all.filter((d) => (!city.value || d.city === city.value) && (!q || d.key.includes(q)));
        if (!hit.length) return fill(pickBox, h('p', { class: 'hint' }, '該当する事業所が見つかりません。下の「事業所名」に直接入力して追加できます。'), dirFoot);
        const list = hit.slice(0, 200);
        fill(pickBox,
          h('p', { class: 'hint' }, `${hit.length}件${hit.length > list.length ? `（はじめの${list.length}件を表示。名前を入れるとしぼり込めます）` : ''}。追加したい事業所を押してください。`),
          h('ul', { class: 'picklist' }, list.map((d) => h('li', null, h('button', {
            type: 'button', 'aria-pressed': String(name.value === d.name),
            onclick: (e) => {
              name.value = d.name.slice(0, 60);
              pickBox.querySelectorAll('button[aria-pressed]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
              e.currentTarget.setAttribute('aria-pressed', 'true');
            },
          }, h('b', null, d.name), h('span', { class: 'hint' }, [city.value ? '' : d.city, d.address, d.tel].filter(Boolean).join('　')))))),
          dirFoot);
      }
      let dirFoot = null;
      async function refresh(forceImport) {
        const my = ++seq;
        city.disabled = true; fill(city, h('option', { value: '' }, '（市区町村をえらぶ）'));
        if (!pref.value) return note('都道府県をえらぶと、その地域の事業所が一覧で出ます。');
        // 基本の都道府県がまだ決まっていない人は、最初にえらんだ県をそのまま登録する（次からどの端末でもこの県が出る）
        if (!S.user.pref) {
          S.user.pref = pref.value; safeSet(localStorage, 'pref', pref.value);
          api('POST', '/api/me/prefs', { pref: pref.value }).then(() => toast(`基本の都道府県を「${pref.value}」にしました`)).catch(() => { /* 保存できなくても、この画面では使える */ });
        }
        if (NO_DIRECTORY.includes(svc.value)) return note('この種別は公開されている名簿がありません。下の「事業所名」に直接入力してください。');
        note('確認しています…');
        try {
          const q = new URLSearchParams({ pref: pref.value, type: svc.value });
          let st = await api('GET', '/api/directory/status?' + q);
          if (my !== seq) return;
          if (!st.available) return note('この種別は公開されている名簿がありません。下の「事業所名」に直接入力してください。');
          const codes = forceImport ? st.codes : st.missing;
          if (codes.length) {
            await importDirectory(pref.value, svc.value, codes, (t) => { if (my === seq) note(t); });
            if (my !== seq) return;
            st = await api('GET', '/api/directory/status?' + q);
          }
          const key = pref.value + '|' + svc.value;
          if (codes.length) dirCache.delete(key);
          if (!dirCache.has(key)) {
            note('名簿を読み込んでいます…');
            const got = (await api('GET', '/api/directory/list?all=1&' + q)).offices;
            got.forEach((d) => { d.key = squash(d.name); });
            dirCache.set(key, got);
          }
          if (my !== seq) return;
          all = dirCache.get(key);
          if (!all.length) return note(`${pref.value}には、この種別の事業所が公開データにありません。下の「事業所名」に直接入力してください。`);
          const cities = [];
          const seen = new Map();
          all.forEach((d) => { if (!seen.has(d.city)) { seen.set(d.city, { city: d.city, n: 0 }); cities.push(seen.get(d.city)); } seen.get(d.city).n++; });
          fill(city, h('option', { value: '' }, `（市区町村をえらぶ：全${all.length}件）`), cities.map((c) => h('option', { value: c.city }, `${c.city}（${c.n}）`)));
          city.disabled = false;
          dirFoot = h('p', { class: 'hint' }, `名簿：厚生労働省 介護サービス情報公表システム（${fmtFull(st.imported_at)} 取り込み）　`,
            h('button', { type: 'button', class: 'linkbtn', onclick: () => refresh(true) }, '最新の名簿に更新'));
          showList();
        } catch (ex) { if (my === seq) note(ex.message, 'error'); }
      }
      pref.addEventListener('change', () => refresh(false));
      svc.addEventListener('change', () => { if (!o) refresh(false); });
      city.addEventListener('change', () => { if (!city.disabled) showList(); });
      kw.addEventListener('input', () => { if (!city.disabled) showList(); });
      dialog(o ? '事業所を編集' : '事業所を追加', h('div', null,
        !o && S.clientDraft ? h('p', { class: 'testnote' }, '保存すると、利用者の入力画面に戻ります。入力した内容はそのまま残っています。') : null,
        h('label', { class: 'field' }, 'サービス種別', svc),
        o ? null : h('fieldset', { class: 'card picker' }, h('legend', null, '一覧からえらぶ'),
          h('label', { class: 'field' }, '都道府県', h('span', { class: 'hint' }, '（となりの県の事業所をさがすときは、ここで切り替えられます）'), pref),
          h('label', { class: 'field' }, '市区町村', city),
          kw, pickBox),
        h('label', { class: 'field' }, '事業所名', o ? null : h('span', { class: 'hint' }, '（一覧にない新しい事業所は、ここに直接入力できます）'), name),
        h('label', { class: 'check' }, canPost, '事業所からの返信を許可する'),
        h('p', { class: 'hint' }, 'チェックしない場合、事業所は「閲覧のみ」になります。'), err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: () => { seq++; close(); if (S.clientDraft) go('#/manage/clients'); } }, S.clientDraft ? '利用者の入力に戻る' : 'やめる'),
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              if (o) await api('PATCH', '/api/offices/' + o.id, { name: name.value, service_type: svc.value, can_post: canPost.checked });
              else {
                const made = await api('POST', '/api/offices', { name: name.value, service_type: svc.value, can_post: canPost.checked });
                // 利用者の入力の途中から来たときは、追加した事業所にチェックを入れて元の画面に戻る
                if (S.clientDraft) { S.clientDraft.office_ids.push(made.id); seq++; close(); toast('事業所を追加しました。利用者の入力に戻ります'); go('#/manage/clients'); return; }
              }
              seq++; close(); toast('保存しました'); reload();
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '保存'),
      ]);
      if (!o) refresh(false);
    };
    if (S.clientDraft) setTimeout(() => openForm(null));
    fill(body, 
      h('p', null, h('button', { class: 'btn block', onclick: () => openForm(null) }, '＋ 事業所を追加')),
      offices.length ? offices.map((o) => h('div', { class: 'card' },
        h('h3', null, o.name),
        h('div', { class: 'rowline' },
          h('span', { class: 'tag ' + (o.active ? 'ok' : 'ng') }, o.active ? '利用中' : '停止中'),
          typeTag(o.service_type),
          h('span', { class: 'tag' }, o.can_post ? '返信できる' : '閲覧のみ'),
          h('span', { class: 'tag' }, `利用者 ${o.client_count}人`)),
        h('div', { class: 'rowline' },
          h('button', { class: 'btn secondary', onclick: () => openForm(o) }, '編集'),
          h('button', {
            class: 'btn ' + (o.active ? 'danger' : 'secondary'),
            onclick: async () => {
              const msg = o.active ? `「${o.name}」との共有を停止します。この事業所のアカウントから、あなたの利用者が見えなくなります。よろしいですか？` : `「${o.name}」との共有を再開しますか？`;
              dialog('確認', h('p', null, msg), (close) => [
                h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
                h('button', { class: 'btn' + (o.active ? ' danger' : ''), onclick: async () => {
                  try { await api('PATCH', '/api/offices/' + o.id, { active: !o.active }); close(); reload(); } catch (ex) { toast(ex.message, true); }
                } }, o.active ? '停止する' : '再開する')]);
            },
          }, o.active ? '共有を停止' : '再開'),
          h('button', { class: 'btn danger outline', onclick: () => confirmDelete(
            `「${o.name}」を削除します。`,
            ['この事業所は、利用者の共有先から外れます。', 'この事業所につないだアカウントからは、あなたの利用者が見えなくなります。', 'これまでのやり取りは残ります。', '削除は元に戻せません。しばらく使わないだけなら「共有を停止」をおすすめします。'],
            async () => { await api('POST', `/api/offices/${o.id}/delete`); toast('削除しました'); reload(); }) }, '削除'),
        ))) : h('p', { class: 'empty' }, '事業所はまだありません'),
    );
  }

  async function manageClients(body) {
    const [{ clients }, { offices }] = await Promise.all([api('GET', '/api/clients'), api('GET', '/api/offices')]);
    const officeName = new Map(offices.map((o) => [o.id, officeLabel(o)]));
    const openForm = (c, draft) => {
      const name = h('input', { type: 'text', value: draft ? draft.name : (c?.name || ''), maxlength: '50' });
      const note = h('textarea', { rows: '3', maxlength: '500' }, draft ? draft.note : (c?.note || ''));
      const picked = draft ? draft.office_ids : (c?.office_ids || []);
      const checks = offices.filter((o) => o.active).map((o) => h('input', { type: 'checkbox', value: String(o.id), checked: picked.includes(o.id) }));
      const err = h('p', { class: 'error' });
      let closeForm = () => {};
      // 入力の途中で「サービス事業所を追加」へ進む（入力した内容は覚えておき、戻ったときに元に戻す）
      const toOffice = () => {
        S.clientDraft = { id: c ? c.id : null, name: name.value, note: note.value, office_ids: checks.filter((x) => x.checked).map((x) => Number(x.value)) };
        closeForm(); go('#/manage/offices');
      };
      dialog(c ? '利用者を編集' : '利用者を追加', h('div', null,
        h('label', { class: 'field' }, '氏名', name),
        h('label', { class: 'field' }, 'メモ（ケアマネのみ閲覧）', note),
        h('fieldset', { class: 'card' }, h('legend', null, '共有する事業所'),
          checks.length ? checks.map((cb) => h('label', { class: 'check' }, cb, officeName.get(Number(cb.value)))) : h('p', { class: 'hint' }, 'まだ事業所が登録されていません。下のボタンから追加できます。'),
          h('p', { class: 'addoffice' }, h('button', { type: 'button', class: 'btn secondary block', onclick: toOffice }, '＋ サービス事業所を追加'))),
        err),
      (close) => [
        (closeForm = close, h('button', { class: 'btn secondary', onclick: close }, 'やめる')),
        h('button', {
          class: 'btn', onclick: async () => {
            const payload = { name: name.value, note: note.value, office_ids: checks.filter((x) => x.checked).map((x) => Number(x.value)) };
            try {
              if (c) await api('PATCH', '/api/clients/' + c.id, payload);
              else await api('POST', '/api/clients', payload);
              close(); toast('保存しました'); reload();
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '保存'),
      ]);
    };
    if (S.clientDraft) {
      const d = S.clientDraft; S.clientDraft = null;
      setTimeout(() => openForm(d.id ? clients.find((x) => x.id === d.id) || null : null, d));
    }
    fill(body, 
      h('p', null, h('button', { class: 'btn block', onclick: () => openForm(null) }, '＋ 利用者を追加')),
      clients.length ? clients.map((c) => h('div', { class: 'card' },
        h('h3', null, c.name, ' 様'),
        c.note ? h('div', { class: 'hint' }, c.note) : null,
        h('div', { class: 'rowline' },
          c.archived ? h('span', { class: 'tag ng' }, '終了') : null,
          c.office_ids.length ? c.office_ids.map((id) => h('span', { class: 'tag' }, officeName.get(id) || '')) : h('span', { class: 'tag' }, '共有なし')),
        h('div', { class: 'rowline' },
          h('button', { class: 'btn secondary', onclick: () => openForm(c) }, '編集'),
          h('button', { class: 'btn secondary', onclick: async () => {
            try { await api('PATCH', '/api/clients/' + c.id, { archived: !c.archived }); reload(); } catch (ex) { toast(ex.message, true); }
          } }, c.archived ? '支援を再開' : '支援終了（非表示）'),
          h('button', { class: 'btn danger outline', onclick: () => confirmDelete(
            `「${c.name} 様」を削除します。`,
            ['この方とのやり取り・写真・PDF などが、すべて消えます。', '削除は元に戻せません。記録を残したいときは「支援終了（非表示）」を使ってください。'],
            async () => { await api('POST', `/api/clients/${c.id}/delete`); toast('削除しました'); reload(); }) }, '削除')),
      )) : h('p', { class: 'empty' }, '利用者はまだいません'),
    );
  }

  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    // かたよりが出ない範囲の乱数だけを使う
    const pick = (n) => { const b = new Uint32Array(1); let x; do { crypto.getRandomValues(b); x = b[0]; } while (x >= Math.floor(0x100000000 / n) * n); return x % n; };
    return Array.from({ length: 12 }, () => chars[pick(chars.length)]).join('') + '-' + (pick(90) + 10);
  }
  function showPassword(loginId, pw) {
    dialog('初期パスワード', h('div', null,
      h('p', null, '以下を事業所の担当者へ、口頭や手渡しなど安全な方法でお伝えください。この画面を閉じると再表示できません。'),
      h('div', { class: 'card' }, h('div', null, 'ログインID：', h('b', null, loginId)), h('div', null, '初期パスワード：', h('b', null, pw))),
      h('p', { class: 'hint' }, '初回ログイン時に、担当者自身のパスワードへの変更が必要です。')),
    (close) => [h('button', { class: 'btn', onclick: () => { close(); reload(); } }, '控えました')]);
  }

  async function manageAccounts(body) {
    const [{ accounts }, { offices }] = await Promise.all([api('GET', '/api/accounts'), api('GET', '/api/offices')]);
    const officeName = new Map(offices.map((o) => [o.id, officeLabel(o)]));
    const officeSelect = () => h('select', null, offices.filter((o) => o.active).map((o) => h('option', { value: String(o.id) }, officeLabel(o))));
    const openForm = () => {
      const office = officeSelect();
      const name = h('input', { type: 'text', maxlength: '50' });
      const loginId = h('input', { type: 'text', autocapitalize: 'off', maxlength: '64' });
      const err = h('p', { class: 'error' });
      dialog('新しいIDを発行', h('div', null,
        h('p', { class: 'hint' }, 'まだケアブルのIDを持っていない事業所に、IDを発行します。'),
        h('label', { class: 'field' }, '事業所', office),
        h('label', { class: 'field' }, '担当者名', name),
        h('label', { class: 'field' }, 'ログインID', h('span', { class: 'hint' }, '（半角の英字・数字で4文字以上。数字だけでも大丈夫です。例：1234）'), loginId),
        h('p', { class: 'hint' }, '初期パスワードは自動で作成します。'), err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn', onclick: async () => {
            const pw = genPassword();
            try {
              await api('POST', '/api/accounts', { office_id: Number(office.value), name: name.value, login_id: normId(loginId.value), password: pw });
              close(); showPassword(loginId.value.trim(), pw);
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '発行する'),
      ]);
    };
    const openLink = () => {
      const office = officeSelect();
      const loginId = h('input', { type: 'text', autocapitalize: 'off', maxlength: '64', inputmode: 'text' });
      const err = h('p', { class: 'error' });
      dialog('発行済みのIDとつなぐ', h('div', null,
        h('p', { class: 'hint' }, 'ほかのケアマネジャーからすでにIDをもらっている事業所は、そのIDとつなぐだけで使えます。新しいIDやパスワードは不要です。'),
        h('label', { class: 'field' }, 'この事業所として共有します', office),
        h('label', { class: 'field' }, '事業所のログインID', h('span', { class: 'hint' }, '（事業所の方に聞いてください）'), loginId),
        h('p', { class: 'hint' }, '事業所の方が「承認」すると、あなたが共有した利用者が見えるようになります。'), err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              await api('POST', '/api/accounts/link', { office_id: Number(office.value), login_id: normId(loginId.value) });
              close(); toast('依頼しました。事業所の方の承認を待っています'); reload();
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '依頼する'),
      ]);
    };
    const patch = (a, data, msg) => async () => {
      if (msg && !(await askYes(msg))) return;
      try { await api('PATCH', '/api/accounts/' + a.id, data); reload(); } catch (ex) { toast(ex.message, true); }
    };
    const noOffice = !offices.some((o) => o.active);
    fill(body,
      h('p', { class: 'hint' }, '事業所のIDは1つで、複数のケアマネジャーと共有できます。ほかのケアマネジャーからすでにIDをもらっている事業所は「発行済みのIDとつなぐ」を使ってください。'),
      h('div', { class: 'rowline wide' },
        h('button', { class: 'btn', onclick: openForm, disabled: noOffice }, '＋ 新しいIDを発行'),
        h('button', { class: 'btn secondary', onclick: openLink, disabled: noOffice }, '🔗 発行済みのIDとつなぐ')),
      accounts.length ? accounts.map((a) => {
        const pending = a.status === 'pending';
        return h('div', { class: 'card' },
          h('h3', null, a.name),
          h('div', { class: 'hint' }, officeName.get(a.office_id) || '', '・ID：', a.login_id),
          pending ? null : h('div', { class: 'hint' }, '最終ログイン：', a.last_login ? fmtFull(a.last_login) : 'なし'),
          h('div', { class: 'rowline' },
            pending ? h('span', { class: 'tag wait' }, '承認待ち') : h('span', { class: 'tag ' + (a.active ? 'ok' : 'ng') }, a.active ? '有効' : '停止中'),
            a.home ? h('span', { class: 'tag' }, 'あなたが発行') : h('span', { class: 'tag' }, 'ほかのケアマネが発行'),
            a.shared ? h('span', { class: 'tag' }, 'ほかのケアマネとも共有中') : null,
            a.locked ? h('span', { class: 'tag ng' }, 'ロック中') : null),
          h('div', { class: 'rowline' },
            pending ? h('button', { class: 'btn secondary', onclick: patch(a, { remove: true }, '依頼を取り消しますか？') }, '依頼を取り消す') : [
              a.home && !a.shared ? h('button', { class: 'btn secondary', onclick: async () => {
                const pw = genPassword();
                try { await api('PATCH', '/api/accounts/' + a.id, { password: pw }); showPassword(a.login_id, pw); } catch (ex) { toast(ex.message, true); }
              } }, 'パスワード再発行') : null,
              h('button', { class: 'btn ' + (a.active ? 'danger' : 'secondary'), onclick: patch(a, { active: !a.active }) }, a.active ? '停止' : '有効にする'),
              a.home ? null : h('button', { class: 'btn secondary', onclick: patch(a, { remove: true }, 'この事業所とのつながりを外しますか？') }, 'つながりを外す'),
            ]),
          a.home && a.shared ? h('p', { class: 'hint' }, 'ほかのケアマネとも共有しているため、パスワードを忘れたときは事業所の方ご自身で変更してもらいます（ログイン後のメニュー →「パスワード変更」）。') : null,
        );
      }) : h('p', { class: 'empty' }, 'アカウントはまだありません'),
    );
  }

  const ACTION_LABEL = {
    login_success: 'ログイン', login_fail: 'ログイン失敗', login_locked: 'ロック中のログイン試行', logout: 'ログアウト',
    password_change: 'パスワード変更', password_change_fail: 'パスワード変更失敗',
    room_view: 'トーク閲覧', message_post: 'メッセージ送信', file_upload: 'ファイル送信', file_view: 'ファイル閲覧',
    office_create: '事業所登録', office_update: '事業所変更', client_create: '利用者登録', client_update: '利用者変更',
    account_create: 'アカウント発行', account_reset_pw: 'パスワード再発行', account_enable: 'アカウント有効化', account_disable: 'アカウント停止',
    cm_created: 'ケアマネ登録', client_delete: '利用者を削除', office_delete: '事業所を削除', account_link_request: 'つながる依頼', account_unlink: 'つながりを外す',
    link_accept: '事業所が依頼を承認', link_reject: '事業所が依頼を断る', link_remove: '事業所がつながりを外す',
  };
  async function manageAudit(body) {
    const { logs } = await api('GET', '/api/audit');
    fill(body, 
      h('p', { class: 'hint' }, '直近100件の操作記録です。だれが・いつ・何をしたかを確認できます。'),
      logs.length ? logs.map((l) => h('div', { class: 'log' },
        h('b', null, fmtFull(l.at)), '　', ACTION_LABEL[l.action] || l.action, h('br'),
        h('span', { class: 'hint' }, l.name || l.login_id || '不明', l.target ? ` / ${l.target}` : '', ` / IP ${l.ip || '-'}`),
      )) : h('p', { class: 'empty' }, '記録はまだありません'),
    );
  }

  // デモの見本データは、デモのときだけ読み込む（本番では読み込まないので、そのぶん速く開く）
  if (API === 'demo' && typeof window.demoLogin !== 'function') {
    const me = document.querySelector('script[src*="app.js"]');
    const v = me ? (me.getAttribute('src').split('?')[1] || '') : '';
    const sc = document.createElement('script');
    sc.src = 'demo-api.js' + (v ? '?' + v : '');
    sc.onload = route;
    sc.onerror = () => renderLogin('デモの準備ができませんでした。もう一度開いてください');
    document.head.append(sc);
  } else route();
})();
