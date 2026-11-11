// ケアつなぎ フロントエンド（ビルド不要・外部ライブラリなし）
(() => {
  'use strict';

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
  const SIZES = [['large', '大'], ['normal', '通常']];
  function applySize(s) { document.documentElement.dataset.size = s; safeSet(localStorage, 'size', s); }
  applySize(safeGet(localStorage, 'size') === 'normal' ? 'normal' : 'large');

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
  function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
  // 画面が見えていないとき（別アプリ・別タブ）は通信しない：サーバーの負荷と通信量を節約
  function every(ms, fn) { S.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms)); }

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
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
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
    S.token = null; S.user = null; S.q = ''; S.svc = 'all';
    blobCache.clear();
    safeSet(sessionStorage, 'token', null);
    if (MEM) memHash = '#/';
    else if (location.hash) history.replaceState(null, '', location.pathname);
    renderLogin(msg);
  }

  // 無操作で自動ログアウト（共有端末での覗き見対策）
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (S.token && Date.now() - S.lastActive > IDLE_LOGOUT_MS) {
      api('POST', '/api/logout').catch(() => {});
      logoutLocal('30分間操作がなかったため、自動でログアウトしました');
    }
  }, 30 * 1000);

  // ---------- 画面共通 ----------
  function topbar(title, { back, sub, right } = {}) {
    return h('header', { class: 'topbar' },
      back ? h('button', { class: 'iconbtn', 'aria-label': '戻る', onclick: back }, '＜ 戻る') : null,
      h('h1', null, title, sub ? h('span', { class: 'sub' }, sub) : null),
      h('div', { class: 'top-right' }, sizeButton(), right || null),
    );
  }
  function menuButton() { return h('button', { class: 'iconbtn', 'aria-label': 'メニュー', onclick: () => go('#/menu') }, '☰ メニュー'); }
  function initial(name) { return (name || '？').trim().charAt(0); }

  function dialog(title, body, actions) {
    const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const close = () => ov.remove();
    ov.append(h('div', { class: 'dialog' }, h('h2', null, title), body, h('div', { class: 'actions' }, actions(close))));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.append(ov);
    const first = ov.querySelector('input, textarea, select');
    if (first) first.focus();
    return close;
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
    if (!S.token) return renderLogin();
    if (!S.user) {
      try { S.user = (await api('GET', '/api/me')).user; } catch { return; }
    }
    if (S.user.must_change_pw) return renderPassword(true);
    const parts = (curHash() || '#/').slice(2).split('/');
    const [a, b, c] = parts;
    if (a === 'room' && b) return renderChat(Number(b));
    if (a === 'offices') return renderHome('offices');
    if (a === 'office' && b) return renderHome('clients', Number(b));
    if (a === 'menu') return renderMenu();
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
          const r = await api('POST', '/api/login', { login_id: idIn.value.trim(), password: pwIn.value });
          S.token = r.token; S.user = r.user; S.lastActive = Date.now();
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
      h('div', { class: 'logo' }, 'ケアつなぎ'),
      h('p', { class: 'tagline' }, 'ケアマネジャーと事業所をつなぐ連絡帳'),
      API === 'demo' ? h('div', { class: 'demo-note' }, h('b', null, 'デモモードで動いています'), h('br'),
        'ケアマネ：cm-demo　事業所：office-demo / nurse-demo / day-demo', h('br'), 'パスワード（共通）：Demo-pass-123', h('br'),
        h('span', { class: 'hint' }, '見本データです。再読み込みすると元に戻ります。')) : null,
      form,
      h('div', { class: 'secure-note' }, '🔒 安心してお使いいただくために',
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
    const pw = h('input', { type: 'password', id: 'setup-pw', autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', id: 'setup-pw2', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, '登録する');
    mount(h('div', { class: 'login-top' }, sizeButton(true)), h('main', { class: 'login' },
      h('h2', null, 'ケアマネジャーの登録'),
      h('p', { class: 'hint' }, 'Cloudflare に登録した「セットアップキー（SETUP_TOKEN）」を持っている人だけが登録できます。'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        if (pw.value !== pw2.value) { err.textContent = 'パスワードが一致しません'; return; }
        btn.disabled = true;
        try {
          await api('POST', '/api/setup', { setup_token: tok.value, name: name.value, login_id: lid.value.trim(), password: pw.value });
          renderLogin('登録しました。いま決めたログインIDとパスワードでログインしてください');
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      } },
        h('label', { class: 'field' }, 'セットアップキー', tok),
        h('label', { class: 'field' }, '氏名', name),
        h('label', { class: 'field' }, 'ログインID', h('span', { class: 'hint' }, '（半角英数字4文字以上）'), lid),
        h('label', { class: 'field' }, 'パスワード', h('span', { class: 'hint' }, '（10文字以上・英字と数字など2種類以上）'), pw),
        h('label', { class: 'field' }, 'パスワード（確認）', pw2),
        err, btn),
      h('p', null, h('button', { type: 'button', class: 'btn secondary block', onclick: () => renderLogin() }, 'ログイン画面に戻る'))));
    tok.focus();
  }

  // 右上の「文字」ボタン：押すたびに 大 ⇔ 通常 が切り替わる
  function sizeButton(light) {
    const label = () => (document.documentElement.dataset.size === 'normal' ? '通常' : '大');
    const cur = h('span', { class: 'cur' }, label());
    const btn = h('button', { type: 'button', class: 'sizebtn' + (light ? ' light' : ''), 'aria-label': `文字の大きさ（いまは${label()}。押すと切り替わります）` },
      h('span', { class: 'aa', 'aria-hidden': 'true' }, 'あ'), '文字', cur);
    btn.addEventListener('click', () => {
      applySize(document.documentElement.dataset.size === 'normal' ? 'large' : 'normal');
      document.querySelectorAll('.sizebtn .cur').forEach((x) => { x.textContent = label(); });
      document.querySelectorAll('.sizebtn').forEach((x) => { x.setAttribute('aria-label', `文字の大きさ（いまは${label()}。押すと切り替わります）`); });
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

  async function doLogout() {
    try { await api('POST', '/api/logout'); } catch { /* 無視 */ }
    logoutLocal('ログアウトしました');
  }

  // ---------- サービス種別 ----------
  // 介護保険のサービス種別（すべて）。サーバー側（index.js）と同じ並びにしています
  const ALL_TYPES = ['通所介護', '訪問介護', '訪問看護', '訪問入浴介護', '訪問リハビリテーション', '居宅療養管理指導', '通所リハビリテーション',
    '短期入所生活介護', '短期入所療養介護', '特定施設入居者生活介護', '福祉用具貸与', '特定福祉用具販売', '住宅改修', '居宅介護支援',
    '定期巡回・随時対応型訪問介護看護', '夜間対応型訪問介護', '地域密着型通所介護', '認知症対応型通所介護', '小規模多機能型居宅介護',
    '看護小規模多機能型居宅介護', '認知症対応型共同生活介護（グループホーム）', '地域密着型特定施設入居者生活介護', '地域密着型介護老人福祉施設',
    '介護老人福祉施設（特養）', '介護老人保健施設（老健）', '介護医療院', 'その他'];
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
    const title = isCm ? 'ケアつなぎ' : (S.user.office ? S.user.office.name : 'ケアつなぎ');
    const listBox = h('div', null, h('p', { class: 'empty' }, '読み込み中…'));
    const tabs = isCm ? h('nav', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(tab === 'clients'), onclick: () => go('#/') }, '👤 利用者ごと'),
      h('button', { role: 'tab', 'aria-selected': String(tab === 'offices'), onclick: () => go('#/offices') }, '🏢 事業所ごと'),
    ) : null;
    const chipBox = h('div', { class: 'typebar', role: 'group', 'aria-label': 'サービス種別で切り替え' });
    const search = h('input', { type: 'search', id: 'room-search', placeholder: '🔍 名前でさがす', 'aria-label': '利用者の名前でさがす', value: S.q || '' });
    const searchBox = tab === 'clients' && !officeId ? h('div', { class: 'searchbar' }, search) : null;
    mount(topbar(title, { sub: `${S.user.name} さん`, right: menuButton() }), tabs, isCm && !officeId ? chipBox : null, searchBox, h('main', null, listBox));

    let offices = [], rooms = [];
    function drawChips() {
      const types = ALL_TYPES;
      const count = (t) => offices.filter((o) => o.active && o.service_type === t).length;
      fill(chipBox,
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.svc === 'all'), onclick: () => setSvc('all') }, 'すべて'),
        types.map((t) => h('button', { type: 'button', class: 'chip ' + (TYPE_CLASS[t] || 't-other') + (count(t) ? '' : ' none'), 'aria-pressed': String(S.svc === t), onclick: () => setSvc(t) },
          t, h('span', { class: 'cnt' }, `${count(t)}`))));
    }
    function setSvc(t) { S.svc = t; drawChips(); load(); }

    function drawRooms() {
      const q = (S.q || '').trim();
      const shown = q ? rooms.filter((r) => r.name.replace(/\s/g, '').includes(q.replace(/\s/g, ''))) : rooms;
      const nodes = [];
      if (officeId) {
        const o = offices.find((x) => x.id === officeId);
        nodes.push(h('div', { class: 'filter-chip' }, h('span', null, o ? typeTag(o.service_type) : null, ' ', o ? o.name : '選択した事業所', ' の利用者'),
          h('button', { class: 'btn secondary', onclick: () => go('#/offices') }, '事業所一覧へ')));
      } else if (isCm && S.svc !== 'all') {
        nodes.push(h('p', { class: 'listhead' }, `${S.svc}を利用している方：${shown.length}人`));
      } else {
        nodes.push(h('p', { class: 'listhead' }, `${q ? '該当' : '利用者'}：${shown.length}人`));
      }
      nodes.push(shown.length ? h('ul', { class: 'list' }, shown.map((r) => h('li', null,
        h('button', { onclick: () => go('#/room/' + r.id), 'aria-label': `${r.name} さんのトーク${r.unread ? `、未読${r.unread}件` : ''}` },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial(r.name)),
          h('span', { class: 'main' },
            h('div', { class: 'name' }, r.name, ' 様'),
            h('div', { class: 'preview' }, r.last_message || 'メッセージはまだありません'),
            isCm ? h('div', { class: 'meta' }, r.offices.length ? r.offices.map((o) => typeTag(o.service_type)) : '共有している事業所なし') : null),
          h('span', { class: 'right' }, fmtShort(r.last_at), h('br'), r.unread ? h('span', { class: 'badge' }, r.unread > 99 ? '99+' : r.unread) : null),
        )))) : h('p', { class: 'empty' }, q ? `「${q}」に当てはまる利用者はいません。` : isCm ? (S.svc !== 'all' ? `${S.svc}の事業所と共有している利用者はいません。` : 'まだ利用者が登録されていません。メニュー →「利用者の管理」から登録できます。') : '共有されている利用者はまだいません。'));
      fill(listBox, ...nodes);
    }
    search.addEventListener('input', () => { S.q = search.value; drawRooms(); });

    function drawOffices() {
      const act = offices.filter((o) => o.active && (S.svc === 'all' || o.service_type === S.svc));
      if (!act.length) {
        fill(listBox, h('p', { class: 'empty' }, S.svc === 'all' ? 'まだ事業所が登録されていません。メニュー →「事業所の管理」から登録できます。' : `${S.svc}の事業所はまだ登録されていません。`));
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

    const load = async () => {
      try {
        if (isCm) {
          offices = (await api('GET', '/api/offices')).offices;
          if (!officeId) drawChips();
        }
        if (tab === 'offices') { drawOffices(); return; }
        const q = officeId ? `?office_id=${officeId}` : (isCm && S.svc !== 'all' ? `?service_type=${encodeURIComponent(S.svc)}` : '');
        rooms = (await api('GET', '/api/rooms' + q)).rooms;
        drawRooms();
      } catch (ex) { fill(listBox, h('p', { class: 'empty error' }, ex.message)); }
    };
    await load();
    every(30000, load);
  }


  // ---------- 添付ファイル ----------
  const MAX_FILE = 5 * 1024 * 1024;
  const blobCache = new Map();
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
        const url = URL.createObjectURL(blob);
        viewer(f.name, h('img', { src: url, alt: f.name, class: 'viewer-img' }));
      } else if (kind === 'pdf') {
        const url = URL.createObjectURL(blob);
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
      fileBlob(f).then((b) => { img.src = URL.createObjectURL(b); btn.querySelector('.loading')?.remove(); })
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
        ? h('img', { src: URL.createObjectURL(pf.blob), alt: '', class: 'upload-preview' })
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

    try {
      const { rooms } = await api('GET', '/api/rooms');
      const r = rooms.find((x) => x.id === clientId);
      if (!r) throw new Error('この利用者は表示できません');
      roomName = r.name;
      header.replaceWith(topbar(r.name + ' 様', {
        back: () => go('#/'),
        sub: r.offices.length ? '共有先：' + r.offices.map(officeLabel).join('、') : '共有先の事業所なし',
      }));
    } catch (ex) { scroll.replaceChildren(h('p', { class: 'empty error' }, ex.message)); return; }

    function addMessages(list) {
      const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
      for (const m of list) {
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

    try {
      const { messages, can_post } = await api('GET', `/api/rooms/${clientId}/messages`);
      if (!messages.length) scroll.append(h('p', { class: 'empty' }, `${roomName} 様についての連絡はまだありません。`));
      addMessages(messages);
      scroll.scrollTop = scroll.scrollHeight;
      if (can_post) {
        const ta = h('textarea', { rows: '1', 'aria-label': 'メッセージを入力', placeholder: 'メッセージを入力', maxlength: '4000' });
        const send = h('button', { class: 'btn', type: 'submit' }, '送信');
        const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf,.pdf,text/csv,.csv', hidden: true, id: 'file-input' });
        const refresh = async () => {
          const more = await api('GET', `/api/rooms/${clientId}/messages?after=${lastId}`);
          scroll.querySelector('.empty')?.remove();
          addMessages(more.messages);
          applyReads(more.reads);
        };
        fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) confirmUpload(clientId, f, () => refresh().catch(() => {})); });
        const attach = h('button', { type: 'button', class: 'attachbtn', 'aria-label': '写真・PDF・CSVを送る', onclick: () => fileIn.click() }, '📎');
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; });
        bottom.replaceChildren(h('form', {
          class: 'composer',
          onsubmit: async (e) => {
            e.preventDefault();
            const text = ta.value.trim();
            if (!text) return;
            send.disabled = true;
            try {
              await api('POST', `/api/rooms/${clientId}/messages`, { body: text });
              ta.value = ''; ta.style.height = 'auto';
              const more = await api('GET', `/api/rooms/${clientId}/messages?after=${lastId}`);
              scroll.querySelector('.empty')?.remove();
              addMessages(more.messages);
              applyReads(more.reads);
            } catch (ex) { toast(ex.message, true); }
            send.disabled = false; ta.focus();
          },
        }, fileIn, attach, ta, send));
      } else {
        bottom.replaceChildren(h('div', { class: 'readonly-bar' }, '👀 閲覧のみです（返信はできません）'));
      }
    } catch (ex) { scroll.replaceChildren(h('p', { class: 'empty error' }, ex.message)); return; }

    every(5000, async () => {
      try {
        const { messages, reads } = await api('GET', `/api/rooms/${clientId}/messages?after=${lastId}`);
        if (messages.length) { scroll.querySelector('.empty')?.remove(); addMessages(messages); }
        applyReads(reads);
      } catch { /* 次回再試行 */ }
    });
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
        h('ul', { class: 'menu' },
          isCm ? [
            h('li', null, h('button', { onclick: () => go('#/manage/clients') }, '👤 利用者の管理')),
            h('li', null, h('button', { onclick: () => go('#/manage/offices') }, '🏢 事業所の管理')),
            h('li', null, h('button', { onclick: () => go('#/manage/accounts') }, '🔑 事業所アカウントの管理')),
            h('li', null, h('button', { onclick: () => go('#/manage/audit') }, '📋 操作の記録（監査ログ）')),
          ] : null,
          h('li', null, h('button', { onclick: () => go('#/password') }, '🔒 パスワード変更')),
          h('li', null, h('button', { onclick: doLogout }, '🚪 ログアウト')),
        )));
  }

  // ---------- 管理（ケアマネのみ） ----------
  async function renderManage(section) {
    const titles = { clients: '利用者の管理', offices: '事業所の管理', accounts: '事業所アカウント', audit: '操作の記録' };
    const body = h('main', { class: 'page' }, h('p', { class: 'empty' }, '読み込み中…'));
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
  function parseCsv(text, onRow) {
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
      parseCsv(text, (r) => {
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
      const svc = h('select', null, ALL_TYPES.map((t) => h('option', { value: t, selected: (o?.service_type || (S.svc !== 'all' ? S.svc : '訪問介護')) === t }, t)));
      const canPost = h('input', { type: 'checkbox', checked: o?.can_post });
      const err = h('p', { class: 'error' });
      // 新しく追加するときだけ：県 → 市区町村 → 名簿からえらぶ
      const pref = h('select', null, h('option', { value: '' }, '（都道府県をえらぶ）'), PREFS.map((x) => h('option', { value: x, selected: safeGet(localStorage, 'pref') === x }, x)));
      const city = h('select', { disabled: true }, h('option', { value: '' }, '（市区町村をえらぶ）'));
      const kw = h('input', { type: 'search', placeholder: '🔍 事業所名でさがす', 'aria-label': '事業所名でさがす' });
      const pickBox = h('div', { class: 'pickbox' });
      let seq = 0;
      const note = (text, cls) => fill(pickBox, h('p', { class: cls || 'hint' }, text));
      async function showList() {
        const my = ++seq;
        const q = new URLSearchParams({ pref: pref.value, type: svc.value, city: city.value, q: kw.value.trim() });
        try {
          const { offices: list } = await api('GET', '/api/directory/list?' + q);
          if (my !== seq) return;
          if (!list.length) return note('該当する事業所が見つかりません。下の「事業所名」に直接入力して追加できます。');
          fill(pickBox,
            h('p', { class: 'hint' }, `${list.length >= 300 ? '300件以上' : list.length + '件'}。追加したい事業所を押してください。`),
            h('ul', { class: 'picklist' }, list.map((d) => h('li', null, h('button', {
              type: 'button', 'aria-pressed': String(name.value === d.name),
              onclick: (e) => {
                name.value = d.name.slice(0, 60);
                pickBox.querySelectorAll('button[aria-pressed]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
                e.currentTarget.setAttribute('aria-pressed', 'true');
              },
            }, h('b', null, d.name), h('span', { class: 'hint' }, [city.value ? '' : d.city, d.address, d.tel].filter(Boolean).join('　')))))));
        } catch (ex) { if (my === seq) note(ex.message, 'error'); }
      }
      async function refresh(forceImport) {
        const my = ++seq;
        city.disabled = true; fill(city, h('option', { value: '' }, '（市区町村をえらぶ）'));
        if (!pref.value) return note('都道府県をえらぶと、その地域の事業所が一覧で出ます。');
        safeSet(localStorage, 'pref', pref.value);
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
          const { cities } = await api('GET', '/api/directory/cities?' + q);
          if (my !== seq) return;
          if (!cities.length) return note(`${pref.value}には、この種別の事業所が公開データにありません。下の「事業所名」に直接入力してください。`);
          fill(city, h('option', { value: '' }, `（市区町村をえらぶ：全${st.count}件）`), cities.map((c) => h('option', { value: c.city }, `${c.city}（${c.n}）`)));
          city.disabled = false;
          fill(pickBox,
            h('p', { class: 'hint' }, '市区町村をえらぶか、事業所名でさがしてください。'),
            h('p', { class: 'hint' }, `名簿：厚生労働省 介護サービス情報公表システム（${fmtFull(st.imported_at)} 取り込み）　`,
              h('button', { type: 'button', class: 'linkbtn', onclick: () => refresh(true) }, '最新の名簿に更新')));
        } catch (ex) { if (my === seq) note(ex.message, 'error'); }
      }
      let kwTimer = null;
      pref.addEventListener('change', () => refresh(false));
      svc.addEventListener('change', () => { if (!o) refresh(false); });
      city.addEventListener('change', () => { if (city.value || kw.value.trim()) showList(); });
      kw.addEventListener('input', () => { clearTimeout(kwTimer); kwTimer = setTimeout(() => { if (pref.value && (city.value || kw.value.trim())) showList(); }, 400); });
      dialog(o ? '事業所を編集' : '事業所を追加', h('div', null,
        h('label', { class: 'field' }, 'サービス種別', svc),
        o ? null : h('fieldset', { class: 'card picker' }, h('legend', null, '一覧からえらぶ'),
          h('label', { class: 'field' }, '都道府県', pref),
          h('label', { class: 'field' }, '市区町村', city),
          kw, pickBox),
        h('label', { class: 'field' }, '事業所名', o ? null : h('span', { class: 'hint' }, '（一覧にない新しい事業所は、ここに直接入力できます）'), name),
        h('label', { class: 'check' }, canPost, '事業所からの返信を許可する'),
        h('p', { class: 'hint' }, 'チェックしない場合、事業所は「閲覧のみ」になります。'), err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: () => { seq++; close(); } }, 'やめる'),
        h('button', {
          class: 'btn', onclick: async () => {
            try {
              if (o) await api('PATCH', '/api/offices/' + o.id, { name: name.value, service_type: svc.value, can_post: canPost.checked });
              else await api('POST', '/api/offices', { name: name.value, service_type: svc.value, can_post: canPost.checked });
              seq++; close(); toast('保存しました'); reload();
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '保存'),
      ]);
      if (!o) refresh(false);
    };
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
              const msg = o.active ? `「${o.name}」の共有を停止します。所属アカウントもログインできなくなります。よろしいですか？` : `「${o.name}」を再開しますか？（アカウントは個別に有効化してください）`;
              dialog('確認', h('p', null, msg), (close) => [
                h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
                h('button', { class: 'btn' + (o.active ? ' danger' : ''), onclick: async () => {
                  try { await api('PATCH', '/api/offices/' + o.id, { active: !o.active }); close(); reload(); } catch (ex) { toast(ex.message, true); }
                } }, o.active ? '停止する' : '再開する')]);
            },
          }, o.active ? '共有を停止' : '再開'),
        ))) : h('p', { class: 'empty' }, '事業所はまだありません'),
    );
  }

  async function manageClients(body) {
    const [{ clients }, { offices }] = await Promise.all([api('GET', '/api/clients'), api('GET', '/api/offices')]);
    const officeName = new Map(offices.map((o) => [o.id, officeLabel(o)]));
    const openForm = (c) => {
      const name = h('input', { type: 'text', value: c?.name || '', maxlength: '50' });
      const note = h('textarea', { rows: '3', maxlength: '500' }, c?.note || '');
      const checks = offices.filter((o) => o.active).map((o) => h('input', { type: 'checkbox', value: String(o.id), checked: c?.office_ids.includes(o.id) }));
      const err = h('p', { class: 'error' });
      dialog(c ? '利用者を編集' : '利用者を追加', h('div', null,
        h('label', { class: 'field' }, '氏名', name),
        h('label', { class: 'field' }, 'メモ（ケアマネのみ閲覧）', note),
        h('fieldset', { class: 'card' }, h('legend', null, '共有する事業所'),
          checks.length ? checks.map((cb) => h('label', { class: 'check' }, cb, officeName.get(Number(cb.value)))) : h('p', { class: 'hint' }, '先に事業所を登録してください')),
        err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
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
          } }, c.archived ? '支援を再開' : '支援終了（非表示）')),
      )) : h('p', { class: 'empty' }, '利用者はまだいません'),
    );
  }

  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint32Array(12));
    return Array.from(r, (x) => chars[x % chars.length]).join('') + '-' + (r[0] % 90 + 10);
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
    const openForm = () => {
      const office = h('select', null, offices.filter((o) => o.active).map((o) => h('option', { value: String(o.id) }, officeLabel(o))));
      const name = h('input', { type: 'text', maxlength: '50' });
      const loginId = h('input', { type: 'text', autocapitalize: 'off', maxlength: '64' });
      const err = h('p', { class: 'error' });
      dialog('アカウントを発行', h('div', null,
        h('label', { class: 'field' }, '事業所', office),
        h('label', { class: 'field' }, '担当者名', name),
        h('label', { class: 'field' }, 'ログインID', h('span', { class: 'hint' }, '（半角英数字4文字以上）'), loginId),
        h('p', { class: 'hint' }, '初期パスワードは自動で作成します。'), err),
      (close) => [
        h('button', { class: 'btn secondary', onclick: close }, 'やめる'),
        h('button', {
          class: 'btn', onclick: async () => {
            const pw = genPassword();
            try {
              await api('POST', '/api/accounts', { office_id: Number(office.value), name: name.value, login_id: loginId.value.trim(), password: pw });
              close(); showPassword(loginId.value.trim(), pw);
            } catch (ex) { err.textContent = ex.message; }
          },
        }, '発行する'),
      ]);
    };
    fill(body, 
      h('p', null, h('button', { class: 'btn block', onclick: openForm, disabled: !offices.some((o) => o.active) }, '＋ アカウントを発行')),
      accounts.length ? accounts.map((a) => h('div', { class: 'card' },
        h('h3', null, a.name),
        h('div', { class: 'hint' }, officeName.get(a.office_id) || '', '・ID：', a.login_id),
        h('div', { class: 'hint' }, '最終ログイン：', a.last_login ? fmtFull(a.last_login) : 'なし'),
        h('div', { class: 'rowline' },
          h('span', { class: 'tag ' + (a.active ? 'ok' : 'ng') }, a.active ? '有効' : '停止中'),
          a.locked ? h('span', { class: 'tag ng' }, 'ロック中') : null),
        h('div', { class: 'rowline' },
          h('button', { class: 'btn secondary', onclick: async () => {
            const pw = genPassword();
            try { await api('PATCH', '/api/accounts/' + a.id, { password: pw }); showPassword(a.login_id, pw); } catch (ex) { toast(ex.message, true); }
          } }, 'パスワード再発行'),
          h('button', { class: 'btn ' + (a.active ? 'danger' : 'secondary'), onclick: async () => {
            try { await api('PATCH', '/api/accounts/' + a.id, { active: !a.active }); reload(); } catch (ex) { toast(ex.message, true); }
          } }, a.active ? '停止' : '有効にする')),
      )) : h('p', { class: 'empty' }, 'アカウントはまだありません'),
    );
  }

  const ACTION_LABEL = {
    login_success: 'ログイン', login_fail: 'ログイン失敗', login_locked: 'ロック中のログイン試行', logout: 'ログアウト',
    password_change: 'パスワード変更', password_change_fail: 'パスワード変更失敗',
    room_view: 'トーク閲覧', message_post: 'メッセージ送信', file_upload: 'ファイル送信', file_view: 'ファイル閲覧',
    office_create: '事業所登録', office_update: '事業所変更', client_create: '利用者登録', client_update: '利用者変更',
    account_create: 'アカウント発行', account_reset_pw: 'パスワード再発行', account_enable: 'アカウント有効化', account_disable: 'アカウント停止',
    cm_created: 'ケアマネ登録',
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

  route();
})();
