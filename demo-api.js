// デモモード専用：config.js の API_BASE が 'demo' のときだけ、サーバーの代わりにブラウザ内の見本データで動きます
// 本番（API_BASE に Cloudflare の URL を設定）では何もしません
(() => {
  const T = Date.now();
  const H = 3600e3, D = 24 * H;
  const db = {
    users: [
      { id: 1, role: 'cm', cm_id: 1, office_id: null, login_id: 'cm-demo', name: '山田 花子', pw: 'Demo-pass-123', must: false, active: true },
      { id: 2, role: 'provider', cm_id: 1, office_id: 1, login_id: 'office-demo', name: '佐藤 健', pw: 'Demo-pass-123', must: false, active: true },
      { id: 3, role: 'provider', cm_id: 1, office_id: 2, login_id: 'day-demo', name: '高橋 恵', pw: 'Demo-pass-123', must: false, active: true },
      { id: 4, role: 'provider', cm_id: 1, office_id: 3, login_id: 'nurse-demo', name: '中村 由美', pw: 'Demo-pass-123', must: false, active: true },
    ],
    offices: [
      { id: 1, name: 'ひまわり訪問介護', service_type: '訪問介護', can_post: true, active: true },
      { id: 2, name: 'さくらデイサービス', service_type: '通所介護', can_post: false, active: true },
      { id: 3, name: 'みどり訪問看護ステーション', service_type: '訪問看護', can_post: true, active: true },
      { id: 4, name: 'あおぞらヘルパーステーション', service_type: '訪問介護', can_post: true, active: true },
      { id: 5, name: 'デイサービスこもれび', service_type: '通所介護', can_post: true, active: true },
      { id: 6, name: 'けやき訪問看護', service_type: '訪問看護', can_post: false, active: true },
      { id: 7, name: 'あおば福祉用具', service_type: '福祉用具貸与', can_post: false, active: true },
      { id: 8, name: 'ショートステイ松風', service_type: '短期入所生活介護', can_post: false, active: true },
    ],
    clients: [],
    messages: [],
    reads: new Set(),
    audit: [],
    seq: 1000,
  };
  // ---- 見本の利用者50名と連絡を作る（毎回同じ内容になるよう固定の乱数） ----
  (() => {
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    const sei = ['鈴木', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山口', '松本', '井上', '木村', '林', '清水', '斎藤', '山崎', '森', '池田', '橋本', '阿部', '石川', '前田', '藤田', '岡田'];
    const mei = ['一郎', 'キヨ', '正雄', 'ハル', '茂', 'トメ', '清', 'フミ', '勇', '千代', '博', 'ミツ', '実', 'ヨシ子', '武', '静子', '昭', '和子', '進', '幸子', '弘', 'タケ', '秀夫', '節子', '利夫'];
    const kaigo = ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5'];
    const memo = ['独居', '長女と同居', '夫婦のみ世帯', '長男が近所に在住', '日中独居'];
    const byType = (t) => db.offices.filter((o) => o.service_type === t).map((o) => o.id);
    const home = byType('訪問介護'), day = byType('通所介護'), nurse = byType('訪問看護');
    for (let i = 0; i < 50; i++) {
      const ids = new Set();
      if (i < 3 || rnd(10) < 6) ids.add(home[rnd(home.length)]);
      if (i < 3 || rnd(10) < 5) ids.add(day[rnd(day.length)]);
      if (i < 2 || rnd(10) < 3) ids.add(nurse[rnd(nurse.length)]);
      if (rnd(10) < 2) ids.add(7);
      if (rnd(10) < 1) ids.add(8);
      if (!ids.size) ids.add(home[rnd(home.length)]);
      db.clients.push({
        id: i + 1, name: `${sei[i % 25]} ${mei[(i * 7 + 3 + Math.floor(i / 25) * 4) % 25]}`,
        note: `${kaigo[rnd(7)]}・${memo[rnd(5)]}`, archived: false, office_ids: [...ids].sort((a, b) => a - b),
      });
    }
    const cmMsgs = [
      '来週のサービス担当者会議は、{d}10時からご自宅で行います。ご出席をお願いします。',
      '昨日から右ひざの痛みを訴えています。介助の際は様子を見ていただけますか。',
      '12月からケアプランを変更します。提供票は来週お送りします。',
      'ご家族から、最近食事量が減っているとの相談がありました。気づいたことがあれば教えてください。',
      '年末年始のサービス予定を確認させてください。',
    ];
    const reply = {
      訪問介護: ['本日の訪問時、冷蔵庫に期限切れの食品が多くありました。ご家族への共有をお願いします。', '承知しました。サービス提供責任者が伺います。', '本日は買い物と掃除を実施しました。お変わりありません。'],
      通所介護: ['本日の入浴は問題なく実施しました。', '昼食は8割ほど召し上がりました。', '承知しました。送迎時間を調整します。'],
      訪問看護: ['血圧 138/82、体温 36.5℃。むくみは軽度です。', '服薬の飲み忘れが2回ありました。お薬カレンダーの導入を提案します。', '主治医に報告済みです。次回訪問で再確認します。'],
    };
    const cmUser = 1;
    const officeUser = { 1: 2, 2: 3, 3: 4 };
    let mid = 0;
    for (const c of db.clients) {
      if (rnd(10) < 3) continue;
      let t = T - (rnd(14) + 1) * D - rnd(10) * H;
      const n = 1 + rnd(3);
      for (let k = 0; k < n; k++) {
        const fromOffice = k % 2 === 1 || rnd(10) < 3;
        const oid = c.office_ids[rnd(c.office_ids.length)];
        const o = db.offices.find((x) => x.id === oid);
        const author = fromOffice && o.can_post && reply[o.service_type] ? (officeUser[oid] || null) : cmUser;
        const pool = author === cmUser ? cmMsgs : reply[o.service_type];
        const day = new Date(T + 4 * D);
        db.messages.push({ id: ++mid, client_id: c.id, author_id: author || cmUser, body: pool[rnd(pool.length)].replace('{d}', `${day.getMonth() + 1}月${day.getDate()}日`), at: t });
        t += (rnd(20) + 1) * H;
        if (t > T) t = T - rnd(60) * 60e3;
      }
    }
    db.messages.sort((a, b) => a.at - b.at).forEach((m, i) => { m.id = i + 1; });
    // 古いメッセージは既読、直近2日分は未読のまま
    for (const m of db.messages) {
      if (m.at < T - 2 * D) for (const u of db.users) if (u.id !== m.author_id) db.reads.add(`${u.id}:${m.id}`);
    }
  })();

  // ---- 添付ファイルの見本（CSV・写真・PDF） ----
  const files = new Map();
  function addFile(clientId, authorId, name, mime, blob, at, caption) {
    const mid = ++db.seq;
    db.messages.push({ id: mid, client_id: clientId, author_id: authorId, body: caption || `📎 ${name}`, at });
    files.set(mid, { id: ++db.seq, message_id: mid, client_id: clientId, name, mime, size: blob.size, blob });
  }
  function samplePng() {
    try {
      const c = document.createElement('canvas'); c.width = 640; c.height = 440;
      const g = c.getContext('2d');
      g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 640, 440);
      g.fillStyle = '#333'; g.font = 'bold 30px sans-serif'; g.fillText('お薬カレンダー（見本）', 24, 50);
      const days = ['月', '火', '水', '木', '金', '土', '日'], times = ['朝', '昼', '夕', '寝る前'];
      g.font = 'bold 22px sans-serif';
      days.forEach((d, i) => g.fillText(d, 110 + i * 72, 100));
      times.forEach((t, j) => {
        g.fillText(t, 20, 160 + j * 72);
        days.forEach((_, i) => {
          g.fillStyle = (i * 4 + j) % 5 === 3 ? '#f4b6b6' : '#cdebd5';
          g.fillRect(96 + i * 72, 120 + j * 72, 62, 58);
          g.fillStyle = '#333';
        });
      });
      const bin = atob(c.toDataURL('image/png').split(',')[1]);
      const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: 'image/png' });
    } catch { return null; }
  }
  function samplePdf() {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    const text = 'BT /F1 22 Tf 60 770 Td (Care Plan - sample document) Tj 0 -40 Td /F1 14 Tf (This is a sample PDF for the preview.) Tj ET';
    objs[3] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return new Blob([out], { type: 'application/pdf' });
  }
  {
    const nurseClient = db.clients.find((c) => c.office_ids.includes(3)) || db.clients[0];
    const homeClient = db.clients.find((c) => c.office_ids.includes(1)) || db.clients[0];
    const csv = '日付,血圧（上）,血圧（下）,脈拍,体温,メモ\n11/3,142,84,72,36.4,むくみ軽度\n11/5,138,82,70,36.5,\n11/7,136,80,74,36.6,服薬の飲み忘れ1回\n11/9,140,85,71,36.4,\n';
    addFile(nurseClient.id, 4, '11月_バイタル記録.csv', 'text/csv', new Blob([csv], { type: 'text/csv' }), T - 6 * H, '11月のバイタル記録です。血圧がやや高めで推移しています。');
    const png = samplePng();
    if (png) addFile(homeClient.id, 2, 'お薬カレンダー.png', 'image/png', png, T - 5 * H, '本日、お薬カレンダーの飲み忘れ（赤い所）を確認しました。');
    addFile(homeClient.id, 1, 'ケアプラン_見本.pdf', 'application/pdf', samplePdf(), T - 4 * H, '');
    db.messages.sort((a, z) => a.at - z.at);
    // 並べ替え後に id を振り直し、添付の紐づけも合わせる
    const remap = new Map();
    db.messages.forEach((m, i) => { remap.set(m.id, i + 1); m.id = i + 1; });
    for (const [oldId, f] of [...files]) { files.delete(oldId); f.message_id = remap.get(oldId); files.set(f.message_id, f); }
    db.reads = new Set([...db.reads].map((k) => { const [u, id] = k.split(':'); return `${u}:${remap.get(Number(id)) ?? id}`; }));
  }

  let session = null;
  const nextId = () => ++db.seq;
  const err = (status, error) => ({ status, body: { error } });
  const ok = (body) => ({ status: 200, body });
  const log = (u, action, target) => db.audit.unshift({ id: nextId(), at: Date.now(), action, target, ip: 'プレビュー', login_id: u?.login_id, name: u?.name });
  const office = (id) => db.offices.find((o) => o.id === id);
  const pub = (u) => ({
    id: u.id, role: u.role, login_id: u.login_id, name: u.name, must_change_pw: u.must,
    office: u.office_id ? { id: u.office_id, name: office(u.office_id).name, can_post: office(u.office_id).can_post, service_type: office(u.office_id).service_type } : null,
  });
  const visible = (u, c) => !c.archived && (u.role === 'cm' || (c.office_ids.includes(u.office_id) && office(u.office_id).active));

  function handle(method, path, q, b) {
    if (method === 'POST' && path === '/api/login') {
      const u = db.users.find((x) => x.login_id === b.login_id);
      if (!u || u.pw !== b.password || !u.active) { log(u, 'login_fail', b.login_id); return err(401, 'ログインIDまたはパスワードが違います'); }
      session = u; log(u, 'login_success');
      return ok({ token: 'demo-token-000000000000000', user: pub(u) });
    }
    const u = session;
    if (!u) return err(401, 'ログインしてください');
    if (path === '/api/me') return ok({ user: pub(u) });
    if (path === '/api/logout') { log(u, 'logout'); session = null; return ok({ ok: true }); }
    if (path === '/api/password') {
      if (b.current !== u.pw) return err(400, '現在のパスワードが違います');
      if (!b.next || b.next.length < 10) return err(400, 'パスワードは10文字以上にしてください');
      u.pw = b.next; u.must = false; log(u, 'password_change'); return ok({ ok: true });
    }
    if (path === '/api/rooms') {
      const of = Number(q.get('office_id') || 0);
      const st = q.get('service_type');
      const rooms = db.clients.filter((c) => visible(u, c) && (!of || c.office_ids.includes(of))
        && (!st || c.office_ids.some((id) => office(id).active && office(id).service_type === st))).map((c) => {
        const ms = db.messages.filter((m) => m.client_id === c.id);
        const last = ms[ms.length - 1];
        return {
          id: c.id, name: c.name,
          offices: c.office_ids.map((id) => ({ id, name: office(id).name, service_type: office(id).service_type })),
          last_message: last ? last.body.slice(0, 60) : '', last_at: last ? last.at : T - 5 * D,
          unread: ms.filter((m) => m.author_id !== u.id && !db.reads.has(`${u.id}:${m.id}`)).length,
        };
      }).sort((a, z) => z.last_at - a.last_at);
      return ok({ rooms });
    }
    let m;
    if ((m = path.match(/^\/api\/rooms\/(\d+)\/messages$/))) {
      const c = db.clients.find((x) => x.id === Number(m[1]));
      if (!c || !visible(u, c)) return err(404, '見つかりません');
      const canPost = u.role === 'cm' || office(u.office_id).can_post;
      if (method === 'POST') {
        if (!canPost) return err(403, 'この事業所は閲覧のみです');
        const text = (b.body || '').trim();
        if (!text) return err(400, 'メッセージを入力してください');
        const id = nextId();
        db.messages.push({ id, client_id: c.id, author_id: u.id, body: text, at: Date.now() });
        log(u, 'message_post', `${c.name} 様`);
        return ok({ ok: true, id });
      }
      const after = Number(q.get('after') || 0);
      const list = db.messages.filter((x) => x.client_id === c.id && x.id > after);
      list.forEach((x) => { if (x.author_id !== u.id) db.reads.add(`${u.id}:${x.id}`); });
      if (!after) log(u, 'room_view', `${c.name} 様`);
      const roomIds = db.messages.filter((x) => x.client_id === c.id).map((x) => x.id);
      const reads = db.users.filter((y) => y.id !== u.id).map((y) => Math.max(0, ...roomIds.filter((id) => db.reads.has(`${y.id}:${id}`)))).filter((x) => x > 0);
      return ok({
        reads,
        can_post: canPost,
        messages: list.map((x) => {
          const a = db.users.find((y) => y.id === x.author_id);
          return {
            id: x.id, body: x.body, created_at: x.at, mine: x.author_id === u.id, author: a.name, author_role: a.role,
            author_office: a.office_id ? office(a.office_id).name : '',
            file: files.has(x.id) ? (({ id, name, mime, size }) => ({ id, name, mime, size }))(files.get(x.id)) : null,
            read_count: x.author_id === u.id ? db.users.filter((y) => y.id !== u.id && db.reads.has(`${y.id}:${x.id}`)).length : null,
          };
        }),
      });
    }
    if (u.role !== 'cm') return err(403, 'この操作はケアマネジャーのみ可能です');
    // 事業所の名簿（デモでは、どの県・種別でも同じ見本を出します）
    if (path.startsWith('/api/directory/')) {
      const type = q.get('type') || '';
      const none = ['居宅療養管理指導', '住宅改修', 'その他'].includes(type);
      const cities = ['葵区', '駿河区', '清水区'];
      const names = ['あさひ', 'ふじのくに', 'みかん', 'お茶の里', 'するが', 'しみず', 'はごろも', 'やまびこ'];
      const all = none ? [] : cities.flatMap((c, i) => names.slice(0, 5 + i).map((n, k) => ({
        city: '見本市' + c, name: `${n}${type.replace(/（.*$/, '')}（見本）`, address: `見本市${c}見本町${k + 1}-${i + 1}`, tel: `054-000-${String(1000 + i * 10 + k)}`, office_no: `22${i}${k}000000`,
      })));
      if (path === '/api/directory/status') return ok({ available: !none, codes: none ? [] : ['000'], missing: [], count: all.length, imported_at: Date.now() - 86400000 });
      if (path === '/api/directory/cities') return ok({ cities: [...new Set(all.map((x) => x.city))].map((c) => ({ city: c, n: all.filter((x) => x.city === c).length })) });
      if (path === '/api/directory/list') {
        const c = q.get('city'), kw = (q.get('q') || '').trim();
        return ok({ offices: all.filter((x) => (!c || x.city === c) && (!kw || x.name.includes(kw))) });
      }
      return ok({ ok: true });
    }
    if (path === '/api/offices' && method === 'GET') {
      return ok({ offices: db.offices.map((o) => ({ ...o, client_count: db.clients.filter((c) => !c.archived && c.office_ids.includes(o.id)).length })) });
    }
    if (path === '/api/offices' && method === 'POST') {
      if (!b.name?.trim()) return err(400, '事業所名を入力してください');
      const id = nextId(); db.offices.push({ id, name: b.name.trim(), service_type: b.service_type || 'その他', can_post: !!b.can_post, active: true }); log(u, 'office_create', b.name);
      return ok({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/offices\/(\d+)$/))) {
      const o = office(Number(m[1])); if (!o) return err(404, '見つかりません');
      if (b.name != null) o.name = b.name.trim();
      if (b.can_post != null) o.can_post = !!b.can_post;
      if (b.service_type != null) o.service_type = b.service_type;
      if (b.active != null) { o.active = !!b.active; if (!o.active) db.users.filter((x) => x.office_id === o.id).forEach((x) => { x.active = false; }); }
      log(u, 'office_update', o.name); return ok({ ok: true });
    }
    if (path === '/api/clients' && method === 'GET') return ok({ clients: db.clients.map((c) => ({ ...c })) });
    if (path === '/api/clients' && method === 'POST') {
      if (!b.name?.trim()) return err(400, '利用者名を入力してください');
      const id = nextId(); db.clients.push({ id, name: b.name.trim(), note: b.note || '', archived: false, office_ids: b.office_ids || [] }); log(u, 'client_create', b.name);
      return ok({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/clients\/(\d+)$/))) {
      const c = db.clients.find((x) => x.id === Number(m[1])); if (!c) return err(404, '見つかりません');
      if (b.name != null) c.name = b.name.trim();
      if (b.note != null) c.note = b.note;
      if (b.archived != null) c.archived = !!b.archived;
      if (b.office_ids != null) c.office_ids = b.office_ids;
      log(u, 'client_update', c.name); return ok({ ok: true });
    }
    if (path === '/api/accounts' && method === 'GET') {
      return ok({ accounts: db.users.filter((x) => x.role === 'provider').map((x) => {
        const l = db.audit.find((a) => a.login_id === x.login_id && a.action === 'login_success');
        return { id: x.id, login_id: x.login_id, name: x.name, office_id: x.office_id, active: x.active, locked: false, last_login: l ? l.at : null };
      }) });
    }
    if (path === '/api/accounts' && method === 'POST') {
      if (!/^[A-Za-z0-9._-]{4,64}$/.test(b.login_id || '')) return err(400, 'ログインIDは半角英数字4文字以上にしてください');
      if (db.users.some((x) => x.login_id === b.login_id)) return err(409, 'このログインIDは使われています');
      if (!b.name?.trim()) return err(400, '担当者名を入力してください');
      const id = nextId(); db.users.push({ id, role: 'provider', cm_id: 1, office_id: b.office_id, login_id: b.login_id, name: b.name.trim(), pw: b.password, must: true, active: true });
      log(u, 'account_create', b.login_id); return ok({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/accounts\/(\d+)$/))) {
      const x = db.users.find((y) => y.id === Number(m[1]) && y.role === 'provider'); if (!x) return err(404, '見つかりません');
      if (b.password != null) { x.pw = b.password; x.must = true; log(u, 'account_reset_pw', x.login_id); }
      if (b.active != null) { x.active = !!b.active; log(u, b.active ? 'account_enable' : 'account_disable', x.login_id); }
      return ok({ ok: true });
    }
    if (path === '/api/audit') return ok({ logs: db.audit.slice(0, 100) });
    return err(404, '見つかりません');
  }

  const realFetch = window.fetch.bind(window);
  const jsonRes = (r) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith('demo/')) return realFetch(input, init);
    const [path, qs] = url.slice(4).split('?');
    const method = (init.method || 'GET').toUpperCase();
    await new Promise((res) => setTimeout(res, 120));
    let m;
    if ((m = path.match(/^\/api\/attachments\/(\d+)$/))) {
      const f = [...files.values()].find((x) => x.id === Number(m[1]));
      const c = f && db.clients.find((x) => x.id === f.client_id);
      if (!session || !f || !visible(session, c)) return jsonRes(err(404, '見つかりません'));
      log(session, 'file_view', `${c.name} 様`);
      return new Response(f.blob, { status: 200, headers: { 'Content-Type': f.mime } });
    }
    if ((m = path.match(/^\/api\/rooms\/(\d+)\/attachments$/)) && method === 'POST') {
      const u = session; const c = db.clients.find((x) => x.id === Number(m[1]));
      if (!u || !c || !visible(u, c)) return jsonRes(err(404, '見つかりません'));
      if (u.role !== 'cm' && !office(u.office_id).can_post) return jsonRes(err(403, 'この事業所は閲覧のみです'));
      const hd = init.headers || {};
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body]);
      if (blob.size > 5 * 1024 * 1024) return jsonRes(err(413, 'ファイルは5MBまでです'));
      const name = decodeURIComponent(hd['X-File-Name'] || 'ファイル');
      const caption = decodeURIComponent(hd['X-Caption'] || '');
      addFile(c.id, u.id, name, hd['Content-Type'], new Blob([blob], { type: hd['Content-Type'] }), Date.now(), caption);
      const mid = db.messages[db.messages.length - 1].id;
      db.reads.add(`${u.id}:${mid}`);
      log(u, 'file_upload', `${c.name} 様`);
      return jsonRes(ok({ ok: true, id: mid }));
    }
    return jsonRes(handle(method, path, new URLSearchParams(qs || ''), init.body ? JSON.parse(init.body) : {}));
  };

  window.demoLogin = (id) => {
    const i = document.querySelector('input[autocomplete="username"]');
    const p = document.querySelector('input[autocomplete="current-password"]');
    if (!i || !p) return false;
    i.value = id; p.value = 'Demo-pass-123';
    i.closest('form').requestSubmit();
    return true;
  };
})();
