// ケアマネ情報共有 API（Cloudflare Workers + D1）
// - パスワード: PBKDF2-SHA256（10万回）+ ソルト
// - セッション: ランダムトークン（DBにはSHA-256ハッシュのみ）、無操作30分 / 最長12時間で失効
// - 保存データ: 氏名・メモ・本文を AES-256-GCM で暗号化。鍵はマスター鍵からケアマネ毎に HKDF で導出
// - アクセス制御: すべての業務データを cm_id で分離。事業所アカウントは割り当てられた利用者のみ閲覧
// - 事業所アカウントは1つのIDで複数のケアマネとつながれる（provider_links）。ケアマネごとに承認・停止できる
// - 監査ログ: ログイン、閲覧、投稿、設定変更を記録

const VERSION = '2026-11-11f';
let lastError = null; // 直近のサーバーエラー（/api/health で確認できる。個人情報は含めない）
const enc = new TextEncoder();
const dec = new TextDecoder();

const IDLE_TIMEOUT = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT = 12 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const IP_WINDOW = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 30;
const PBKDF2_ITER = 100000;
const MAX_BODY = 4000;
// 介護保険のサービス種別（事業所の分類）。数字は厚生労働省「介護サービス情報公表システム」オープンデータのサービスコード
const SERVICE_SOURCES = {
  訪問介護: ['110'], 訪問入浴介護: ['120'], 訪問看護: ['130'], 訪問リハビリテーション: ['140'], 居宅療養管理指導: [],
  通所介護: ['150', '155'], 通所リハビリテーション: ['160'], 短期入所生活介護: ['210'], 短期入所療養介護: ['220', '230', '551'],
  特定施設入居者生活介護: ['331', '332', '334', '335', '336', '337'], 福祉用具貸与: ['170'], 特定福祉用具販売: ['410'], 住宅改修: [],
  居宅介護支援: ['430'], '定期巡回・随時対応型訪問介護看護': ['760'], 夜間対応型訪問介護: ['710'], 地域密着型通所介護: ['780'],
  認知症対応型通所介護: ['720'], 小規模多機能型居宅介護: ['730'], 看護小規模多機能型居宅介護: ['770'],
  '認知症対応型共同生活介護（グループホーム）': ['320'], 地域密着型特定施設入居者生活介護: ['361', '362', '364'],
  地域密着型介護老人福祉施設: ['540'], '介護老人福祉施設（特養）': ['510'], '介護老人保健施設（老健）': ['520'], 介護医療院: ['550'], その他: [],
};
const SERVICE_TYPES = Object.keys(SERVICE_SOURCES);
// 以前の短い呼び名 → 正式な名前
const LEGACY_TYPES = { 訪問入浴: '訪問入浴介護', 訪問リハビリ: '訪問リハビリテーション', 通所リハビリ: '通所リハビリテーション', 短期入所: '短期入所生活介護', 福祉用具: '福祉用具貸与', 小規模多機能: '小規模多機能型居宅介護' };
function serviceType(v) {
  if (v == null || v === '') return 'その他';
  if (LEGACY_TYPES[v]) return LEGACY_TYPES[v];
  if (!SERVICE_TYPES.includes(v)) throw new HttpError(400, 'サービス種別が不正です');
  return v;
}
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];

// ---------- 小物 ----------
function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64url(buf) {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}
async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const now = () => Date.now();

// ---------- パスワード ----------
async function hashPassword(password, salt = randomBytes(16), iter = PBKDF2_ITER) {
  iter = Math.min(Math.max(Number(iter) || PBKDF2_ITER, 10000), 100000);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return `pbkdf2$${iter}$${toB64(salt)}$${toB64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const again = await hashPassword(password, fromB64(salt), Number(iter));
  return timingSafeEqual(again.split('$')[3], hash);
}
// ダミー検証（存在しないIDでも処理時間をそろえる）
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'パスワードは10文字以上にしてください');
  if (pw.length > 128) throw new HttpError(400, 'パスワードが長すぎます');
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 2) throw new HttpError(400, 'パスワードは英字・数字・記号のうち2種類以上を組み合わせてください');
}

// ---------- 暗号化（ケアマネ毎の鍵） ----------
// DATA_KEY は「32バイトを Base64 にした文字」が基本。前後の空白や引用符が混ざっていても受け付け、
// Base64 でない文字（自分で決めた合言葉など）の場合は SHA-256 で 32 バイトの鍵に変換して使う。
function dataKeyText(env) {
  return String(env.DATA_KEY || '').trim().replace(/^['"`]+|['"`]+$/g, '').trim();
}
async function masterKeyBytes(env) {
  const raw = dataKeyText(env);
  if (!raw) throw new HttpError(500, 'サーバー設定エラー（DATA_KEY 未設定）');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length % 4 === 0) {
    try {
      const bytes = fromB64(raw);
      if (bytes.length >= 16) return bytes;
    } catch { /* Base64 でなければ下の方法で変換 */ }
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(raw)));
}
const keyCache = new Map();
async function cmKey(env, cmId) {
  const cacheKey = String(cmId);
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  const master = await crypto.subtle.importKey('raw', await masterKeyBytes(env), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('caremane-share-v1'), info: enc.encode(`cm:${cmId}`) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  keyCache.set(cacheKey, key);
  return key;
}
async function seal(env, cmId, text) {
  const key = await cmKey(env, cmId);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`cm:${cmId}`) }, key, enc.encode(text ?? ''));
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}
async function open(env, cmId, sealed) {
  if (!sealed) return '';
  const [v, iv, ct] = sealed.split(':');
  if (v !== 'v1') return '';
  const key = await cmKey(env, cmId);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(`cm:${cmId}`) }, key, fromB64(ct));
    return dec.decode(pt);
  } catch {
    return '（復号できません）';
  }
}

// ---------- HTTP ----------
function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name, X-Caption',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(env, req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...corsHeaders(env, req),
    },
  });
}
async function readJson(req) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > 20000) throw new HttpError(413, 'データが大きすぎます');
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, '不正なリクエストです');
  }
}
const clientIp = (req) => req.headers.get('CF-Connecting-IP') || 'unknown';
// ログインID：全角の英数字（１２３４ など）を半角に直し、空白を取る
const normId = (v) => String(v || '').normalize('NFKC').replace(/\s+/g, '');
function str(v, max, label, required = true) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${label}を入力してください`);
    return '';
  }
  if (typeof v !== 'string') throw new HttpError(400, `${label}が不正です`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${label}を入力してください`);
  if (t.length > max) throw new HttpError(400, `${label}は${max}文字以内にしてください`);
  return t;
}
function intId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'IDが不正です');
  return n;
}

async function audit(env, req, user, action, target = null, cmId = null) {
  await env.DB.prepare('INSERT INTO audit_logs (cm_id, user_id, action, target, ip, ua, at) VALUES (?,?,?,?,?,?,?)')
    .bind(cmId ?? user?.cm_id ?? null, user?.id ?? null, action, target, clientIp(req), (req.headers.get('User-Agent') || '').slice(0, 200), now())
    .run();
}

// ---------- 認証 ----------
async function authenticate(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new HttpError(401, 'ログインしてください');
  const th = await sha256Hex(m[1]);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(th).first();
  const t = now();
  if (!s || t - s.last_seen > IDLE_TIMEOUT || t - s.created_at > ABSOLUTE_TIMEOUT) {
    if (s) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(th).run();
    throw new HttpError(401, '一定時間操作がなかったため、ログアウトしました');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.user_id).first();
  if (!user || !user.active) throw new HttpError(401, 'アカウントが無効です');
  await repairCm(env, user);
  if (t - s.last_seen > 5 * 60 * 1000) {
    await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(t, th).run();
  }
  user.token_hash = th;
  return user;
}
function requireCm(user) {
  if (user.role !== 'cm') throw new HttpError(403, 'この操作はケアマネジャーのみ可能です');
}
function requirePwChanged(user) {
  if (user.must_change_pw) throw new HttpError(403, '初回ログインのため、パスワードを変更してください');
}

async function publicUser(env, u) {
  let office = null;
  let links = 0, pending = 0;
  if (u.role === 'provider') {
    const rows = (await env.DB.prepare('SELECT cm_id, office_id, status, active FROM provider_links WHERE user_id = ?').bind(u.id).all()).results;
    pending = rows.filter((l) => l.status === 'pending').length;
    const act = rows.filter((l) => l.status === 'active' && l.active);
    links = act.length;
    // 画面の上に出す事業所名：最初に発行したケアマネの登録名（なければ、つながっている最初のケアマネの登録名）
    const l = act.find((x) => x.cm_id === u.cm_id) || act[0] || (u.office_id ? { cm_id: u.cm_id, office_id: u.office_id } : null);
    if (l) {
      const o = await env.DB.prepare('SELECT * FROM offices WHERE id = ? AND cm_id = ?').bind(l.office_id, l.cm_id).first();
      if (o) office = { id: o.id, name: await open(env, o.cm_id, o.name), can_post: !!o.can_post, service_type: o.service_type };
    }
  }
  return {
    id: u.id,
    role: u.role,
    login_id: u.login_id,
    name: await open(env, u.cm_id, u.display_name),
    must_change_pw: !!u.must_change_pw,
    font_size: (await env.DB.prepare('SELECT font_size FROM user_prefs WHERE user_id = ?').bind(u.id).first())?.font_size || null,
    office,
    ...(u.role === 'provider' ? { links, pending } : {}),
  };
}

async function handleLogin(env, req) {
  const body = await readJson(req);
  const loginId = normId(str(body.login_id, 64, 'ログインID'));
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(req);
  const t = now();

  await env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(t - IP_WINDOW).run();
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ?').bind(ip).first();
  if (cnt.c >= IP_MAX_ATTEMPTS) throw new HttpError(429, 'ログイン試行が多すぎます。しばらくしてからお試しください');

  const user = await env.DB.prepare('SELECT * FROM users WHERE login_id = ?').bind(loginId).first();
  const fail = async (reason) => {
    await env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, t).run();
    await audit(env, req, user, 'login_fail', `${loginId}: ${reason}`, user?.cm_id ?? null);
    throw new HttpError(401, 'ログインIDまたはパスワードが違います');
  };

  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    return fail('unknown id');
  }
  if (user.locked_until > t) {
    await audit(env, req, user, 'login_locked', loginId);
    throw new HttpError(423, 'パスワードを続けて間違えたため、15分間ロックしています');
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok || !user.active) {
    const failed = user.failed_count + 1;
    const lock = failed >= MAX_FAILED ? t + LOCK_MS : 0;
    await env.DB.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').bind(lock ? 0 : failed, lock, user.id).run();
    return fail(!user.active ? 'inactive' : lock ? 'bad password (locked)' : 'bad password');
  }
  await env.DB.prepare('UPDATE users SET failed_count = 0, locked_until = 0 WHERE id = ?').bind(user.id).run();
  await repairCm(env, user);

  const token = b64url(randomBytes(32));
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, ip) VALUES (?,?,?,?,?)')
    .bind(await sha256Hex(token), user.id, t, t, ip)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE created_at < ?').bind(t - ABSOLUTE_TIMEOUT).run();
  await audit(env, req, user, 'login_success');
  return json(env, req, { token, user: await publicUser(env, user) });
}

// 登録が途中で止まったケアマネ（cm_id が空）を、使える状態に直す
async function repairCm(env, user) {
  if (user.role !== 'cm' || user.cm_id != null) return;
  user.cm_id = user.id;
  user.display_name = await seal(env, user.id, user.login_id);
  await env.DB.prepare('UPDATE users SET cm_id = ?, display_name = ? WHERE id = ?').bind(user.id, user.display_name, user.id).run();
}

async function handleSetup(env, req) {
  const body = await readJson(req);
  if (!env.SETUP_TOKEN || typeof body.setup_token !== 'string' || !timingSafeEqual(body.setup_token, env.SETUP_TOKEN)) {
    await audit(env, req, null, 'setup_denied');
    throw new HttpError(403, 'セットアップキーが違います');
  }
  const loginId = normId(str(body.login_id, 64, 'ログインID'));
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(loginId)) throw new HttpError(400, 'ログインIDは、半角の英字・数字で4文字以上にしてください（例：1234）');
  checkPasswordPolicy(body.password);
  const name = str(body.name, 50, '氏名');
  await masterKeyBytes(env); // 鍵に問題があれば、何も書き込む前に止める
  const exists = await env.DB.prepare('SELECT id, role, cm_id FROM users WHERE login_id = ?').bind(loginId).first();
  // 途中で止まった登録（ケアマネなのに cm_id が空）は、同じIDでやり直せる
  const unfinished = exists && exists.role === 'cm' && exists.cm_id == null;
  if (exists && !unfinished) throw new HttpError(409, 'このログインIDは使われています');
  const t = now();
  let id;
  if (unfinished) {
    id = exists.id;
    await env.DB.prepare('UPDATE users SET password_hash = ?, failed_count = 0, locked_until = 0 WHERE id = ?').bind(await hashPassword(body.password), id).run();
  } else {
    const r = await env.DB.prepare("INSERT INTO users (role, login_id, display_name, password_hash, must_change_pw, created_at) VALUES ('cm', ?, '', ?, 0, ?)")
      .bind(loginId, await hashPassword(body.password), t)
      .run();
    id = r.meta.last_row_id;
  }
  await env.DB.prepare('UPDATE users SET cm_id = ?, display_name = ? WHERE id = ?').bind(id, await seal(env, id, name), id).run();
  await audit(env, req, { id, cm_id: id }, 'cm_created', loginId);
  return json(env, req, { ok: true, id });
}

// ---------- アクセス判定 ----------
// 事業所アカウントは、つながっているケアマネごとに「そのケアマネの立場」で処理する。
// （cm_id と office_id を、そのケアマネ側の値に置き換えた user を作る）
function asLinked(user, link) {
  return { ...user, cm_id: link.cm_id, office_id: link.office_id, home_cm_id: user.cm_id };
}
async function activeLinks(env, user) {
  const rows = await env.DB.prepare(
    `SELECT l.cm_id, l.office_id FROM provider_links l JOIN offices o ON o.id = l.office_id AND o.cm_id = l.cm_id
      WHERE l.user_id = ? AND l.status = 'active' AND l.active = 1 AND o.active = 1 ORDER BY l.created_at`
  ).bind(user.id).all();
  return rows.results;
}
async function ctxForClient(env, user, clientId) {
  if (user.role === 'cm') return user;
  const c = await env.DB.prepare('SELECT cm_id FROM clients WHERE id = ?').bind(clientId).first();
  if (!c) throw new HttpError(404, '見つかりません');
  const l = await env.DB.prepare("SELECT cm_id, office_id FROM provider_links WHERE user_id = ? AND cm_id = ? AND status = 'active' AND active = 1").bind(user.id, c.cm_id).first();
  if (!l) throw new HttpError(404, '見つかりません');
  return asLinked(user, l);
}
async function loadClientForUser(env, user, clientId) {
  const c = await env.DB.prepare('SELECT * FROM clients WHERE id = ? AND cm_id = ?').bind(clientId, user.cm_id).first();
  if (!c) throw new HttpError(404, '見つかりません');
  if (user.role === 'provider') {
    const link = await env.DB.prepare('SELECT 1 FROM client_offices WHERE client_id = ? AND office_id = ?').bind(clientId, user.office_id).first();
    const office = await env.DB.prepare('SELECT active FROM offices WHERE id = ?').bind(user.office_id).first();
    if (!link || !office?.active || c.archived) throw new HttpError(404, '見つかりません');
  }
  return c;
}
async function canPost(env, user) {
  if (user.role === 'cm') return true;
  const o = await env.DB.prepare('SELECT can_post FROM offices WHERE id = ? AND cm_id = ?').bind(user.office_id, user.cm_id).first();
  return !!o?.can_post;
}

// ---------- ルーム・メッセージ ----------
// D1 の無料枠（1回の処理あたり50クエリ、1日500万行の読み取り）に収まるよう、
// 一覧は利用者数に関係なく数回のクエリで取得する。
// 既読は「利用者ごとに、どこまで読んだか」（room_reads）で管理する（LINE と同じ考え方）。
async function officeNameMap(env, user) {
  const rows = await env.DB.prepare('SELECT id, name, service_type, active FROM offices WHERE cm_id = ?').bind(user.cm_id).all();
  const map = new Map();
  for (const o of rows.results) map.set(o.id, { id: o.id, name: await open(env, user.cm_id, o.name), service_type: o.service_type, active: !!o.active });
  return map;
}

async function listRooms(env, req, user, url) {
  if (user.role === 'cm') return json(env, req, { rooms: await roomsFor(env, user, url) });
  // 事業所：つながっているケアマネごとに集めて、1つの一覧にする
  const links = await activeLinks(env, user);
  const rooms = [], cms = [];
  for (const l of links) {
    const ctx = asLinked(user, l);
    const cmUser = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(l.cm_id).first();
    const cm = { id: l.cm_id, name: cmUser ? await open(env, l.cm_id, cmUser.display_name) : '' };
    cms.push(cm);
    for (const r of await roomsFor(env, ctx, url)) rooms.push({ ...r, cm });
  }
  rooms.sort((a, b) => b.last_at - a.last_at);
  return json(env, req, { rooms, cms });
}

async function roomsFor(env, user, url) {
  const officeFilter = url.searchParams.get('office_id');
  const typeFilter = url.searchParams.get('service_type');
  let where = 'c.cm_id = ? AND c.archived = 0';
  const params = [user.id, user.id, user.cm_id];
  if (user.role === 'provider') {
    where += ' AND EXISTS (SELECT 1 FROM client_offices co WHERE co.client_id = c.id AND co.office_id = ?)';
    params.push(user.office_id);
  } else if (typeFilter) {
    where += ' AND EXISTS (SELECT 1 FROM client_offices co JOIN offices o ON o.id = co.office_id WHERE co.client_id = c.id AND o.cm_id = c.cm_id AND o.active = 1 AND o.service_type = ?)';
    params.push(serviceType(typeFilter));
  } else if (officeFilter) {
    where += ' AND EXISTS (SELECT 1 FROM client_offices co WHERE co.client_id = c.id AND co.office_id = ?)';
    params.push(intId(officeFilter));
  }
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.created_at, c.last_msg_at, lm.body AS last_body,
            (SELECT COUNT(*) FROM (SELECT 1 FROM messages m
               WHERE m.cm_id = c.cm_id AND m.client_id = c.id
                 AND m.id > IFNULL((SELECT r.last_read_id FROM room_reads r WHERE r.user_id = ? AND r.client_id = c.id), 0)
                 AND m.author_id != ? LIMIT 100)) AS unread
       FROM clients c LEFT JOIN messages lm ON lm.id = c.last_msg_id
      WHERE ${where}`
  ).bind(...params).all();
  const links = await env.DB.prepare(
    'SELECT co.client_id, co.office_id FROM client_offices co JOIN clients c ON c.id = co.client_id WHERE c.cm_id = ? AND c.archived = 0'
  ).bind(user.cm_id).all();
  const offices = await officeNameMap(env, user);
  const byClient = new Map();
  for (const l of links.results) {
    const o = offices.get(l.office_id);
    if (!o || !o.active) continue;
    if (!byClient.has(l.client_id)) byClient.set(l.client_id, []);
    byClient.get(l.client_id).push({ id: o.id, name: o.name, service_type: o.service_type });
  }
  const rooms = [];
  for (const c of rows.results) {
    rooms.push({
      id: c.id,
      name: await open(env, user.cm_id, c.name),
      offices: byClient.get(c.id) || [],
      last_message: c.last_body ? (await open(env, user.cm_id, c.last_body)).slice(0, 60) : '',
      last_at: c.last_msg_at || c.created_at,
      unread: c.unread,
    });
  }
  rooms.sort((a, b) => b.last_at - a.last_at);
  return rooms;
}

async function listMessages(env, req, user, clientId, url) {
  const c = await loadClientForUser(env, user, clientId);
  const after = Number(url.searchParams.get('after') || 0);
  const rows = await env.DB.prepare(
    `SELECT m.*, u.display_name AS author_name, u.cm_id AS author_cm, u.role AS author_role
       FROM messages m JOIN users u ON u.id = m.author_id
      WHERE m.cm_id = ? AND m.client_id = ? AND m.id > ?
      ORDER BY m.id DESC LIMIT 200`
  ).bind(user.cm_id, clientId, after).all();
  const list = rows.results.reverse();

  // 既読位置を進める（新しいメッセージがあるときだけ書き込む）
  if (list.length) {
    await env.DB.prepare(
      `INSERT INTO room_reads (user_id, client_id, last_read_id, read_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id), read_at = excluded.read_at`
    ).bind(user.id, clientId, list[list.length - 1].id, now()).run();
  }
  // ほかの人がどこまで読んだか（自分の投稿の「既読 n」に使う）
  const readRows = await env.DB.prepare('SELECT last_read_id FROM room_reads WHERE client_id = ? AND user_id != ?').bind(clientId, user.id).all();
  const reads = readRows.results.map((r) => r.last_read_id);

  // 事業所の投稿者は「このケアマネが登録している事業所名」で表示する
  const authorOffice = new Map();
  if (list.some((m) => m.author_role === 'provider')) {
    const offices = await officeNameMap(env, user);
    const lr = await env.DB.prepare('SELECT user_id, office_id FROM provider_links WHERE cm_id = ?').bind(user.cm_id).all();
    for (const l of lr.results) authorOffice.set(l.user_id, offices.get(l.office_id)?.name || '');
  }
  const files = new Map();
  if (list.length) {
    const fr = await env.DB.prepare('SELECT id, message_id, filename, mime, size FROM attachments WHERE cm_id = ? AND client_id = ? AND message_id >= ? AND message_id <= ?')
      .bind(user.cm_id, clientId, list[0].id, list[list.length - 1].id).all();
    for (const f of fr.results) files.set(f.message_id, { id: f.id, name: await open(env, user.cm_id, f.filename), mime: f.mime, size: f.size });
  }
  const out = [];
  for (const m of list) {
    const mine = m.author_id === user.id;
    out.push({
      id: m.id,
      body: await open(env, user.cm_id, m.body),
      created_at: m.created_at,
      mine,
      author: await open(env, m.author_cm ?? user.cm_id, m.author_name),
      author_role: m.author_role,
      author_office: m.author_role === 'provider' ? authorOffice.get(m.author_id) || '' : '',
      read_count: mine ? reads.filter((x) => x >= m.id).length : null,
      file: files.get(m.id) || null,
    });
  }
  if (!after) await audit(env, req, user, 'room_view', `client:${c.id}`);
  return json(env, req, { messages: out, reads, can_post: await canPost(env, user) });
}

async function postMessage(env, req, user, clientId) {
  await loadClientForUser(env, user, clientId);
  if (!(await canPost(env, user))) throw new HttpError(403, 'この事業所は閲覧のみです');
  const body = await readJson(req);
  const text = str(body.body, MAX_BODY, 'メッセージ');
  const t = now();
  const r = await env.DB.prepare('INSERT INTO messages (cm_id, client_id, author_id, body, created_at) VALUES (?,?,?,?,?)')
    .bind(user.cm_id, clientId, user.id, await seal(env, user.cm_id, text), t)
    .run();
  const id = r.meta.last_row_id;
  await env.DB.batch([
    env.DB.prepare('UPDATE clients SET last_msg_id = ?, last_msg_at = ? WHERE id = ? AND cm_id = ?').bind(id, t, clientId, user.cm_id),
    env.DB.prepare(
      `INSERT INTO room_reads (user_id, client_id, last_read_id, read_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id), read_at = excluded.read_at`
    ).bind(user.id, clientId, id, t),
  ]);
  await audit(env, req, user, 'message_post', `client:${clientId} msg:${id}`);
  return json(env, req, { ok: true, id });
}

// ---------- 添付ファイル（写真・PDF・CSV） ----------
// 保存先は FILE_STORAGE で切り替え: 'd1'（既定）または 'r2'（R2 バケットを FILES として設定）
// どちらでも「ケアマネごとの鍵」で暗号化してから保存し、直接リンクは発行しない。
const MAX_FILE = 5 * 1024 * 1024;       // 1ファイル 5MB まで（写真は画面側で縮小してから送る）
const CHUNK = 1024 * 1024;              // D1 は1行2MBまでなので 1MB ずつに分けて保存
const FILE_KINDS = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  'text/csv': (b) => !b.subarray(0, 65536).includes(0), // 文字だけのファイル（Shift_JIS も可）
};
async function sealBytes(env, cmId, fileId, bytes) {
  const key = await cmKey(env, cmId);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`cm:${cmId}:file:${fileId}`) }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0); out.set(ct, 12);
  return out;
}
async function openBytes(env, cmId, fileId, sealed) {
  const key = await cmKey(env, cmId);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: enc.encode(`cm:${cmId}:file:${fileId}`) }, key, sealed.subarray(12)));
}
function useR2(env) {
  return env.FILE_STORAGE === 'r2' && env.FILES;
}

async function uploadAttachment(env, req, user, clientId) {
  await loadClientForUser(env, user, clientId);
  if (!(await canPost(env, user))) throw new HttpError(403, 'この事業所は閲覧のみです');
  const mime = (req.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!FILE_KINDS[mime]) throw new HttpError(415, '送れるのは写真（JPEG・PNG）、PDF、CSV です');
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_FILE) throw new HttpError(413, 'ファイルは5MBまでです');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, 'ファイルが空です');
  if (bytes.length > MAX_FILE) throw new HttpError(413, 'ファイルは5MBまでです');
  if (!FILE_KINDS[mime](bytes)) throw new HttpError(415, 'ファイルの中身が種類と一致しません');
  let name;
  try { name = decodeURIComponent(req.headers.get('X-File-Name') || ''); } catch { name = ''; }
  name = name.replace(/[\\/\x00-\x1f]/g, '_').trim().slice(0, 100) || 'ファイル';
  let caption = '';
  try { caption = decodeURIComponent(req.headers.get('X-Caption') || '').trim().slice(0, 500); } catch { /* なし */ }

  const t = now();
  const storage = useR2(env) ? 'r2' : 'd1';
  const msg = await env.DB.prepare('INSERT INTO messages (cm_id, client_id, author_id, body, created_at) VALUES (?,?,?,?,?)')
    .bind(user.cm_id, clientId, user.id, await seal(env, user.cm_id, caption || `📎 ${name}`), t).run();
  const messageId = msg.meta.last_row_id;
  const a = await env.DB.prepare('INSERT INTO attachments (cm_id, client_id, message_id, uploader_id, filename, mime, size, storage, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(user.cm_id, clientId, messageId, user.id, await seal(env, user.cm_id, name), mime, bytes.length, storage, t).run();
  const fileId = a.meta.last_row_id;
  const sealed = await sealBytes(env, user.cm_id, fileId, bytes);
  try {
    if (storage === 'r2') {
      await env.FILES.put(`cm${user.cm_id}/${fileId}`, sealed);
    } else {
      const stmts = [];
      for (let i = 0, seq = 0; i < sealed.length; i += CHUNK, seq++) {
        stmts.push(env.DB.prepare('INSERT INTO attachment_chunks (attachment_id, seq, data) VALUES (?,?,?)').bind(fileId, seq, sealed.slice(i, i + CHUNK)));
      }
      await env.DB.batch(stmts);
    }
  } catch (e) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM attachment_chunks WHERE attachment_id = ?').bind(fileId),
      env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(fileId),
      env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(messageId),
    ]);
    throw e;
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE clients SET last_msg_id = ?, last_msg_at = ? WHERE id = ? AND cm_id = ?').bind(messageId, t, clientId, user.cm_id),
    env.DB.prepare(
      `INSERT INTO room_reads (user_id, client_id, last_read_id, read_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id), read_at = excluded.read_at`
    ).bind(user.id, clientId, messageId, t),
  ]);
  await audit(env, req, user, 'file_upload', `client:${clientId} file:${fileId}`);
  return json(env, req, { ok: true, id: messageId, attachment_id: fileId });
}

async function getAttachment(env, req, user, fileId) {
  if (user.role === 'provider') {
    const f = await env.DB.prepare('SELECT client_id FROM attachments WHERE id = ?').bind(fileId).first();
    if (!f) throw new HttpError(404, '見つかりません');
    user = await ctxForClient(env, user, f.client_id);
  }
  const a = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND cm_id = ?').bind(fileId, user.cm_id).first();
  if (!a) throw new HttpError(404, '見つかりません');
  await loadClientForUser(env, user, a.client_id); // 担当外の事業所には見せない
  let sealed;
  if (a.storage === 'r2') {
    if (!env.FILES) throw new HttpError(500, 'ファイルの保存先が設定されていません');
    const obj = await env.FILES.get(`cm${a.cm_id}/${a.id}`);
    if (!obj) throw new HttpError(404, 'ファイルが見つかりません');
    sealed = new Uint8Array(await obj.arrayBuffer());
  } else {
    const rows = await env.DB.prepare('SELECT data FROM attachment_chunks WHERE attachment_id = ? ORDER BY seq').bind(a.id).all();
    const parts = rows.results.map((r) => new Uint8Array(r.data));
    sealed = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let off = 0;
    for (const x of parts) { sealed.set(x, off); off += x.length; }
  }
  const bytes = await openBytes(env, a.cm_id, a.id, sealed);
  await audit(env, req, user, 'file_view', `client:${a.client_id} file:${a.id}`);
  return new Response(bytes, {
    headers: {
      'Content-Type': a.mime,
      'Content-Disposition': 'attachment',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
      ...corsHeaders(env, req),
    },
  });
}

// ---------- 管理（ケアマネのみ） ----------
async function listOffices(env, req, user) {
  const rows = await env.DB.prepare('SELECT * FROM offices WHERE cm_id = ? ORDER BY id').bind(user.cm_id).all();
  const offices = [];
  for (const o of rows.results) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM client_offices co JOIN clients c ON c.id = co.client_id WHERE co.office_id = ? AND c.archived = 0').bind(o.id).first();
    offices.push({ id: o.id, name: await open(env, user.cm_id, o.name), can_post: !!o.can_post, active: !!o.active, service_type: o.service_type, client_count: n.n });
  }
  return json(env, req, { offices });
}
async function createOffice(env, req, user) {
  const b = await readJson(req);
  const name = str(b.name, 60, '事業所名');
  const r = await env.DB.prepare('INSERT INTO offices (cm_id, name, service_type, can_post, created_at) VALUES (?,?,?,?,?)')
    .bind(user.cm_id, await seal(env, user.cm_id, name), serviceType(b.service_type), b.can_post ? 1 : 0, now())
    .run();
  await audit(env, req, user, 'office_create', `office:${r.meta.last_row_id}`);
  return json(env, req, { ok: true, id: r.meta.last_row_id });
}
async function updateOffice(env, req, user, id) {
  const o = await env.DB.prepare('SELECT * FROM offices WHERE id = ? AND cm_id = ?').bind(id, user.cm_id).first();
  if (!o) throw new HttpError(404, '見つかりません');
  const b = await readJson(req);
  const name = b.name != null ? await seal(env, user.cm_id, str(b.name, 60, '事業所名')) : o.name;
  const canPostV = b.can_post != null ? (b.can_post ? 1 : 0) : o.can_post;
  const active = b.active != null ? (b.active ? 1 : 0) : o.active;
  const svc = b.service_type != null ? serviceType(b.service_type) : o.service_type;
  await env.DB.prepare('UPDATE offices SET name = ?, service_type = ?, can_post = ?, active = ? WHERE id = ?').bind(name, svc, canPostV, active, id).run();
  // 事業所を停止すると、その事業所につないだアカウントからは、このケアマネの利用者が見えなくなる
  // （アカウント自体は止めない。ほかのケアマネとつながっていることがあるため）
  await audit(env, req, user, 'office_update', `office:${id}`);
  return json(env, req, { ok: true });
}

// 事業所を削除：共有先から外し、この事業所につないだアカウントとのつながりも外す（やり取りは残す）
async function deleteOffice(env, req, user, id) {
  const o = await env.DB.prepare('SELECT id FROM offices WHERE id = ? AND cm_id = ?').bind(id, user.cm_id).first();
  if (!o) throw new HttpError(404, '見つかりません');
  const linked = (await env.DB.prepare('SELECT user_id FROM provider_links WHERE cm_id = ? AND office_id = ?').bind(user.cm_id, id).all()).results.map((r) => r.user_id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM client_offices WHERE office_id = ? AND client_id IN (SELECT id FROM clients WHERE cm_id = ?)').bind(id, user.cm_id),
    env.DB.prepare('DELETE FROM provider_links WHERE cm_id = ? AND office_id = ?').bind(user.cm_id, id),
    env.DB.prepare('DELETE FROM offices WHERE id = ? AND cm_id = ?').bind(id, user.cm_id),
  ]);
  // どのケアマネともつながらなくなったアカウントは、ログインできないようにする
  for (const uid of linked) {
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM provider_links WHERE user_id = ?').bind(uid).first();
    if (!left.n) {
      await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ? AND role = 'provider'").bind(uid).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
    }
  }
  await audit(env, req, user, 'office_delete', `office:${id}`);
  return json(env, req, { ok: true });
}
// 利用者を削除：やり取り・添付ファイル・既読の記録もすべて消す（元に戻せない）
async function deleteClient(env, req, user, id) {
  const c = await env.DB.prepare('SELECT id FROM clients WHERE id = ? AND cm_id = ?').bind(id, user.cm_id).first();
  if (!c) throw new HttpError(404, '見つかりません');
  const files = (await env.DB.prepare("SELECT id, storage FROM attachments WHERE cm_id = ? AND client_id = ?").bind(user.cm_id, id).all()).results;
  if (env.FILES) {
    for (const f of files) if (f.storage === 'r2') { try { await env.FILES.delete(`cm${user.cm_id}/${f.id}`); } catch { /* 残っても読めない（鍵で暗号化済み） */ } }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE cm_id = ? AND client_id = ?)').bind(user.cm_id, id),
    env.DB.prepare('DELETE FROM attachments WHERE cm_id = ? AND client_id = ?').bind(user.cm_id, id),
    env.DB.prepare('DELETE FROM messages WHERE cm_id = ? AND client_id = ?').bind(user.cm_id, id),
    env.DB.prepare('DELETE FROM room_reads WHERE client_id = ?').bind(id),
    env.DB.prepare('DELETE FROM client_offices WHERE client_id = ?').bind(id),
    env.DB.prepare('DELETE FROM clients WHERE id = ? AND cm_id = ?').bind(id, user.cm_id),
  ]);
  await audit(env, req, user, 'client_delete', `client:${id}`);
  return json(env, req, { ok: true });
}

async function listClients(env, req, user) {
  const rows = await env.DB.prepare('SELECT * FROM clients WHERE cm_id = ? ORDER BY archived, id').bind(user.cm_id).all();
  const clients = [];
  for (const c of rows.results) {
    const links = await env.DB.prepare('SELECT office_id FROM client_offices WHERE client_id = ?').bind(c.id).all();
    clients.push({
      id: c.id,
      name: await open(env, user.cm_id, c.name),
      note: await open(env, user.cm_id, c.note),
      archived: !!c.archived,
      office_ids: links.results.map((l) => l.office_id),
    });
  }
  return json(env, req, { clients });
}
async function validOfficeIds(env, user, ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const raw of ids.slice(0, 50)) {
    const id = intId(raw);
    const o = await env.DB.prepare('SELECT id FROM offices WHERE id = ? AND cm_id = ?').bind(id, user.cm_id).first();
    if (!o) throw new HttpError(400, '事業所の指定が不正です');
    out.push(id);
  }
  return [...new Set(out)];
}
async function createClient(env, req, user) {
  const b = await readJson(req);
  const name = str(b.name, 50, '利用者名');
  const note = str(b.note, 500, 'メモ', false);
  const officeIds = await validOfficeIds(env, user, b.office_ids);
  const r = await env.DB.prepare('INSERT INTO clients (cm_id, name, note, created_at) VALUES (?,?,?,?)')
    .bind(user.cm_id, await seal(env, user.cm_id, name), await seal(env, user.cm_id, note), now())
    .run();
  const id = r.meta.last_row_id;
  if (officeIds.length) await env.DB.batch(officeIds.map((o) => env.DB.prepare('INSERT INTO client_offices (client_id, office_id) VALUES (?,?)').bind(id, o)));
  await audit(env, req, user, 'client_create', `client:${id}`);
  return json(env, req, { ok: true, id });
}
async function updateClient(env, req, user, id) {
  const c = await env.DB.prepare('SELECT * FROM clients WHERE id = ? AND cm_id = ?').bind(id, user.cm_id).first();
  if (!c) throw new HttpError(404, '見つかりません');
  const b = await readJson(req);
  const name = b.name != null ? await seal(env, user.cm_id, str(b.name, 50, '利用者名')) : c.name;
  const note = b.note != null ? await seal(env, user.cm_id, str(b.note, 500, 'メモ', false)) : c.note;
  const archived = b.archived != null ? (b.archived ? 1 : 0) : c.archived;
  const stmts = [env.DB.prepare('UPDATE clients SET name = ?, note = ?, archived = ? WHERE id = ?').bind(name, note, archived, id)];
  if (b.office_ids != null) {
    const officeIds = await validOfficeIds(env, user, b.office_ids);
    stmts.push(env.DB.prepare('DELETE FROM client_offices WHERE client_id = ?').bind(id));
    for (const o of officeIds) stmts.push(env.DB.prepare('INSERT INTO client_offices (client_id, office_id) VALUES (?,?)').bind(id, o));
  }
  await env.DB.batch(stmts);
  await audit(env, req, user, 'client_update', `client:${id}`);
  return json(env, req, { ok: true });
}

// 事業所アカウント：1つのIDを複数のケアマネで共有できる。
// ・最初に発行したケアマネ（users.cm_id）が「発行元」。パスワード再発行は、発行元だけ・ほかのケアマネとつながっていないときだけ。
// ・ほかのケアマネは「発行済みのIDとつなぐ」で依頼し、事業所が承認するとつながる。
async function listAccounts(env, req, user) {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.login_id, u.display_name, u.cm_id AS home_cm, u.active AS u_active, u.locked_until,
            l.office_id, l.status, l.active AS l_active,
            (SELECT COUNT(*) FROM provider_links x WHERE x.user_id = u.id AND x.cm_id != l.cm_id AND x.status = 'active') AS others
       FROM provider_links l JOIN users u ON u.id = l.user_id
      WHERE l.cm_id = ? AND u.role = 'provider' ORDER BY l.created_at, u.id`
  ).bind(user.cm_id).all();
  const accounts = [];
  for (const u of rows.results) {
    const last = await env.DB.prepare("SELECT at FROM audit_logs WHERE user_id = ? AND action = 'login_success' ORDER BY id DESC LIMIT 1").bind(u.id).first();
    accounts.push({
      id: u.id,
      login_id: u.login_id,
      name: await open(env, u.home_cm, u.display_name),
      office_id: u.office_id,
      status: u.status,
      active: !!(u.l_active && u.u_active),
      locked: u.locked_until > now(),
      home: u.home_cm === user.cm_id,
      shared: u.others > 0,
      last_login: last?.at ?? null,
    });
  }
  return json(env, req, { accounts });
}
async function myActiveOffice(env, user, officeId) {
  const o = await env.DB.prepare('SELECT id FROM offices WHERE id = ? AND cm_id = ? AND active = 1').bind(officeId, user.cm_id).first();
  if (!o) throw new HttpError(400, '事業所の指定が不正です');
}
async function createAccount(env, req, user) {
  const b = await readJson(req);
  const loginId = normId(str(b.login_id, 64, 'ログインID'));
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(loginId)) throw new HttpError(400, 'ログインIDは、半角の英字・数字で4文字以上にしてください（例：1234）');
  const name = str(b.name, 50, '担当者名');
  const officeId = intId(b.office_id);
  await myActiveOffice(env, user, officeId);
  checkPasswordPolicy(b.password);
  const exists = await env.DB.prepare('SELECT id, role FROM users WHERE login_id = ?').bind(loginId).first();
  if (exists?.role === 'provider') throw new HttpError(409, 'このログインIDは、すでに発行されています。同じ事業所なら「発行済みのIDとつなぐ」を使ってください');
  if (exists) throw new HttpError(409, 'このログインIDは使われています');
  const t = now();
  const r = await env.DB.prepare("INSERT INTO users (role, cm_id, office_id, login_id, display_name, password_hash, must_change_pw, created_at) VALUES ('provider',?,?,?,?,?,1,?)")
    .bind(user.cm_id, officeId, loginId, await seal(env, user.cm_id, name), await hashPassword(b.password), t)
    .run();
  const id = r.meta.last_row_id;
  await env.DB.prepare("INSERT INTO provider_links (user_id, cm_id, office_id, status, active, created_at) VALUES (?,?,?,'active',1,?)").bind(id, user.cm_id, officeId, t).run();
  await audit(env, req, user, 'account_create', `user:${id}`);
  return json(env, req, { ok: true, id });
}
// 発行済みのID（ほかのケアマネが発行した事業所アカウント）に、つながる依頼を出す
async function linkAccount(env, req, user) {
  const b = await readJson(req);
  const loginId = normId(str(b.login_id, 64, 'ログインID'));
  const officeId = intId(b.office_id);
  await myActiveOffice(env, user, officeId);
  const u = await env.DB.prepare("SELECT id FROM users WHERE login_id = ? AND role = 'provider' AND active = 1").bind(loginId).first();
  if (!u) throw new HttpError(404, 'このログインIDの事業所アカウントは見つかりません。IDを事業所に確認してください');
  const ex = await env.DB.prepare('SELECT status FROM provider_links WHERE user_id = ? AND cm_id = ?').bind(u.id, user.cm_id).first();
  if (ex) throw new HttpError(409, ex.status === 'pending' ? 'すでに依頼しています。事業所の承認を待っています' : 'すでにつながっています');
  await env.DB.prepare("INSERT INTO provider_links (user_id, cm_id, office_id, status, active, created_at) VALUES (?,?,?,'pending',1,?)").bind(u.id, user.cm_id, officeId, now()).run();
  await audit(env, req, user, 'account_link_request', `user:${u.id}`);
  return json(env, req, { ok: true, id: u.id });
}
async function updateAccount(env, req, user, id) {
  const u = await env.DB.prepare(
    `SELECT u.*, l.status, l.active AS l_active,
            (SELECT COUNT(*) FROM provider_links x WHERE x.user_id = u.id AND x.cm_id != l.cm_id AND x.status = 'active') AS others
       FROM provider_links l JOIN users u ON u.id = l.user_id WHERE l.user_id = ? AND l.cm_id = ? AND u.role = 'provider'`
  ).bind(id, user.cm_id).first();
  if (!u) throw new HttpError(404, '見つかりません');
  const home = u.cm_id === user.cm_id;
  const b = await readJson(req);
  if (b.remove) {
    // つながりを外す（依頼の取り消しも同じ）。発行元はアカウントごと停止で対応する
    if (home) throw new HttpError(400, 'このケアマネが発行したアカウントです。使わなくなったら「停止」してください');
    await env.DB.prepare('DELETE FROM provider_links WHERE user_id = ? AND cm_id = ?').bind(id, user.cm_id).run();
    await audit(env, req, user, 'account_unlink', `user:${id}`);
    return json(env, req, { ok: true });
  }
  if (b.password != null) {
    if (!home) throw new HttpError(403, 'パスワードの再発行は、このアカウントを発行したケアマネジャーだけができます');
    if (u.others > 0) throw new HttpError(403, 'ほかのケアマネジャーともつながっているため、ここでは再発行できません。事業所の方ご自身で「パスワード変更」をしてもらってください');
    checkPasswordPolicy(b.password);
    await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1, failed_count = 0, locked_until = 0 WHERE id = ?').bind(await hashPassword(b.password), id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await audit(env, req, user, 'account_reset_pw', `user:${id}`);
  }
  if (b.active != null) {
    const on = b.active ? 1 : 0;
    await env.DB.prepare('UPDATE provider_links SET active = ? WHERE user_id = ? AND cm_id = ?').bind(on, id, user.cm_id).run();
    // 発行元で、ほかのケアマネとつながっていなければ、ログインそのものも止める／戻す
    if (home && !u.others) {
      await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(on, id).run();
      if (!on) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    }
    await audit(env, req, user, on ? 'account_enable' : 'account_disable', `user:${id}`);
  }
  return json(env, req, { ok: true });
}

// 事業所の側：つながっているケアマネの一覧・依頼の承認・つながりを外す
async function listLinks(env, req, user) {
  const rows = await env.DB.prepare(
    `SELECT l.cm_id, l.office_id, l.status, l.active, l.created_at, u.display_name, o.name AS office_name, o.can_post, o.active AS o_active
       FROM provider_links l JOIN users u ON u.id = l.cm_id LEFT JOIN offices o ON o.id = l.office_id AND o.cm_id = l.cm_id
      WHERE l.user_id = ? ORDER BY l.status DESC, l.created_at`
  ).bind(user.id).all();
  const links = [];
  for (const l of rows.results) {
    links.push({
      cm_id: l.cm_id,
      cm_name: await open(env, l.cm_id, l.display_name),
      office_name: l.office_name ? await open(env, l.cm_id, l.office_name) : '',
      status: l.status,
      active: !!(l.active && l.o_active),
      can_post: !!l.can_post,
      home: l.cm_id === user.cm_id,
      created_at: l.created_at,
    });
  }
  return json(env, req, { links });
}
async function answerLink(env, req, user, cmId, accept) {
  const l = await env.DB.prepare('SELECT status FROM provider_links WHERE user_id = ? AND cm_id = ?').bind(user.id, cmId).first();
  if (!l) throw new HttpError(404, '見つかりません');
  if (accept) {
    if (l.status !== 'pending') return json(env, req, { ok: true });
    await env.DB.prepare("UPDATE provider_links SET status = 'active' WHERE user_id = ? AND cm_id = ?").bind(user.id, cmId).run();
  } else {
    await env.DB.prepare('DELETE FROM provider_links WHERE user_id = ? AND cm_id = ?').bind(user.id, cmId).run();
  }
  // 記録は、相手のケアマネの「操作の記録」に残す
  await audit(env, req, user, accept ? 'link_accept' : (l.status === 'pending' ? 'link_reject' : 'link_remove'), `user:${user.id}`, cmId);
  return json(env, req, { ok: true });
}

async function listAudit(env, req, user, url) {
  const before = Number(url.searchParams.get('before') || 0) || Number.MAX_SAFE_INTEGER;
  const rows = await env.DB.prepare(
    'SELECT a.*, u.login_id, u.display_name, u.cm_id AS user_cm FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.cm_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT 100'
  ).bind(user.cm_id, before).all();
  const logs = [];
  for (const l of rows.results) {
    logs.push({
      id: l.id,
      at: l.at,
      action: l.action,
      target: l.target,
      ip: l.ip,
      login_id: l.login_id,
      name: l.display_name ? await open(env, l.user_cm ?? user.cm_id, l.display_name) : '',
    });
  }
  return json(env, req, { logs });
}

async function changePassword(env, req, user) {
  const b = await readJson(req);
  if (typeof b.current !== 'string' || !(await verifyPassword(b.current, user.password_hash))) {
    await audit(env, req, user, 'password_change_fail');
    throw new HttpError(400, '現在のパスワードが違います');
  }
  checkPasswordPolicy(b.next);
  if (b.next === b.current) throw new HttpError(400, '新しいパスワードは現在と別のものにしてください');
  await env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').bind(await hashPassword(b.next), user.id).run();
  // 他の端末のセッションを破棄
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, user.token_hash).run();
  await audit(env, req, user, 'password_change');
  return json(env, req, { ok: true });
}

// ---------- 事業所の名簿（全国の介護事業所の公開データ） ----------
// 厚生労働省のオープンデータ（CSV）を、県・サービス種別ごとに必要になったときだけ取り込み、D1 に保存します。
// 公開情報なので暗号化はしません。すべてのケアマネで共用します。
const OPENDATA_PAGE = 'https://www.mhlw.go.jp/stf/kaigo-kouhyou_opendata.html';
const OPENDATA_BASE = 'https://www.mhlw.go.jp/content/12300000/';
// ページから最新のファイル名が読み取れなかったときに使う（2026年6月末時点）
const OPENDATA_FALLBACK = {
  110: 'jigyosho_110_all_20260709180319.csv', 120: 'jigyosho_120_all_20260709180323.csv', 130: 'jigyosho_130_all_20260709180342.csv',
  140: 'jigyosho_140_all_20260709180350.csv', 150: 'jigyosho_150_all_20260709180445.csv', 155: 'jigyosho_155_all_20260709180449.csv',
  160: 'jigyosho_160_all_20260709180500.csv', 170: 'jigyosho_170_all_20260709180509.csv', 210: 'jigyosho_210_all_20260709180538.csv',
  220: 'jigyosho_220_all_20260709180546.csv', 230: 'jigyosho_230_all_20260709180549.csv', 551: 'jigyosho_551_all_20260709180935.csv',
  320: 'jigyosho_320_all_20260709180609.csv', 331: 'jigyosho_331_all_20260709180619.csv', 332: 'jigyosho_332_all_20260709180623.csv',
  334: 'jigyosho_334_all_20260709180627.csv', 335: 'jigyosho_335_all_20260709180630.csv', 336: 'jigyosho_336_all_20260709180633.csv',
  337: 'jigyosho_337_all_20260709180637.csv', 361: 'jigyosho_361_all_20260709180640.csv', 362: 'jigyosho_362_all_20260709180644.csv',
  364: 'jigyosho_364_all_20260709180647.csv', 410: 'jigyosho_410_all_20260709180655.csv', 430: 'jigyosho_430_all_20260709180740.csv',
  510: 'jigyosho_510_all_20260709180754.csv', 520: 'jigyosho_520_all_20260709180802.csv', 540: 'jigyosho_540_all_20260709180811.csv',
  550: 'jigyosho_550_all_20260709180931.csv', 710: 'jigyosho_710_all_20260709180814.csv', 720: 'jigyosho_720_all_20260709180821.csv',
  730: 'jigyosho_730_all_20260709180837.csv', 760: 'jigyosho_760_all_20260709180841.csv', 770: 'jigyosho_770_all_20260709180847.csv',
  780: 'jigyosho_780_all_20260709180927.csv',
};
let migrated = false;
// 新しく増えた表は、ここで自動的に作る（D1 のコンソールで SQL を流し直さなくてよいように）
async function ensureSchema(env) {
  if (migrated) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS provider_links (user_id INTEGER NOT NULL, cm_id INTEGER NOT NULL, office_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, cm_id))"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_provider_links_cm ON provider_links(cm_id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT)'),
    // 以前のしくみ（1アカウント＝1ケアマネ）で発行したアカウントを、1回だけ provider_links に移す
    env.DB.prepare("INSERT OR IGNORE INTO provider_links (user_id, cm_id, office_id, status, active, created_at) SELECT id, cm_id, office_id, 'active', 1, created_at FROM users WHERE role = 'provider' AND cm_id IS NOT NULL AND office_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_meta WHERE k = 'links_v1')"),
    env.DB.prepare("INSERT OR IGNORE INTO app_meta (k, v) VALUES ('links_v1', '1')"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS user_prefs (user_id INTEGER PRIMARY KEY, font_size TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS directory (id INTEGER PRIMARY KEY AUTOINCREMENT, pref TEXT NOT NULL, service_type TEXT NOT NULL, code TEXT NOT NULL, city TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT \'\', tel TEXT NOT NULL DEFAULT \'\', office_no TEXT NOT NULL DEFAULT \'\')'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_directory ON directory(pref, service_type, city)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS directory_meta (pref TEXT NOT NULL, code TEXT NOT NULL, service_type TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, source TEXT, imported_at INTEGER NOT NULL, PRIMARY KEY (pref, code))'),
    ...Object.entries(LEGACY_TYPES).map(([a, b]) => env.DB.prepare('UPDATE offices SET service_type = ? WHERE service_type = ?').bind(b, a)),
  ]);
  migrated = true;
}
function dirParams(url) {
  const pref = url.searchParams.get('pref') || '';
  const type = url.searchParams.get('type') || '';
  if (!PREFS.includes(pref)) throw new HttpError(400, '都道府県を選んでください');
  if (!SERVICE_TYPES.includes(type)) throw new HttpError(400, 'サービス種別が不正です');
  return { pref, type };
}
// その県・その種別の名簿が取り込み済みかどうか
async function directoryStatus(env, req, url) {
  const { pref, type } = dirParams(url);
  const codes = SERVICE_SOURCES[type];
  const rows = await env.DB.prepare('SELECT code, n, imported_at FROM directory_meta WHERE pref = ? AND service_type = ?').bind(pref, type).all();
  const done = new Set(rows.results.map((r) => r.code));
  return json(env, req, {
    available: codes.length > 0,
    codes,
    missing: codes.filter((c) => !done.has(c)),
    count: rows.results.reduce((a, r) => a + r.n, 0),
    imported_at: rows.results.reduce((a, r) => Math.max(a, r.imported_at), 0),
  });
}
async function directoryCities(env, req, url) {
  const { pref, type } = dirParams(url);
  const rows = await env.DB.prepare('SELECT city, COUNT(*) AS n FROM directory WHERE pref = ? AND service_type = ? GROUP BY city ORDER BY MIN(id)').bind(pref, type).all();
  return json(env, req, { cities: rows.results });
}
async function directoryList(env, req, url) {
  const { pref, type } = dirParams(url);
  const city = url.searchParams.get('city') || '';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
  let sql = 'SELECT name, address, tel, office_no, city FROM directory WHERE pref = ? AND service_type = ?';
  const args = [pref, type];
  if (city) { sql += ' AND city = ?'; args.push(city); }
  if (q) { sql += " AND name LIKE ? ESCAPE '\\'"; args.push('%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  sql += url.searchParams.get('all') ? ' ORDER BY id LIMIT 8000' : ' ORDER BY name LIMIT 300';
  const rows = await env.DB.prepare(sql).bind(...args).all();
  return json(env, req, { offices: rows.results });
}
// 厚生労働省のページから、最新の CSV のファイル名を調べる（6時間おぼえておく）
let sourceCache = { at: 0, map: null };
async function sourceUrl(code) {
  if (!sourceCache.map || now() - sourceCache.at > 6 * 60 * 60 * 1000) {
    const map = {};
    try {
      const res = await fetch(OPENDATA_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; care-directory)' } });
      if (res.ok) {
        const html = await res.text();
        // ページは新しい時点が上にあるので、コードごとに最初に出てきた CSV を使う
        for (const m of html.matchAll(/href="([^"]*?jigyosho_(\d{3})(?:_all_\d+)?\.csv)"/g)) {
          if (!map[m[2]]) map[m[2]] = new URL(m[1], OPENDATA_PAGE).href;
        }
      }
    } catch { /* 下の予備を使う */ }
    sourceCache = { at: now(), map };
  }
  return sourceCache.map[code] || (OPENDATA_FALLBACK[code] ? OPENDATA_BASE + OPENDATA_FALLBACK[code] : null);
}
// CSV をそのままブラウザへ中継する（読み解く作業はブラウザ側で行い、サーバーの負荷を抑える）
async function directorySource(env, req, url) {
  const code = url.searchParams.get('code') || '';
  if (!Object.values(SERVICE_SOURCES).some((l) => l.includes(code))) throw new HttpError(400, 'サービスコードが不正です');
  const src = await sourceUrl(code);
  if (!src) throw new HttpError(404, 'この種別の公開データはありません');
  let res = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; care-directory)' } });
  if (!res.ok && OPENDATA_FALLBACK[code] && src !== OPENDATA_BASE + OPENDATA_FALLBACK[code]) res = await fetch(OPENDATA_BASE + OPENDATA_FALLBACK[code]);
  if (!res.ok) throw new HttpError(502, '厚生労働省のサイトからデータを取得できませんでした。時間をおいてお試しください');
  return new Response(res.body, {
    status: 200,
    headers: { ...corsHeaders(env, req), 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Expose-Headers': 'X-Source', 'X-Source': encodeURIComponent(src) },
  });
}
// ブラウザが県ごとに絞り込んだ行を、少しずつ受け取って保存する
async function directoryImport(env, req, user) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > 400000) throw new HttpError(413, 'データが大きすぎます');
  let b;
  try { b = await req.json(); } catch { throw new HttpError(400, '不正なリクエストです'); }
  if (!PREFS.includes(b.pref)) throw new HttpError(400, '都道府県を選んでください');
  const type = Object.keys(SERVICE_SOURCES).find((t) => SERVICE_SOURCES[t].includes(String(b.code)));
  if (!type) throw new HttpError(400, 'サービスコードが不正です');
  const code = String(b.code);
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
  const cut = (v, n) => String(v ?? '').trim().slice(0, n);
  const stmts = [];
  if (b.reset) {
    stmts.push(env.DB.prepare('DELETE FROM directory WHERE pref = ? AND code = ?').bind(b.pref, code));
    stmts.push(env.DB.prepare('DELETE FROM directory_meta WHERE pref = ? AND code = ?').bind(b.pref, code));
  }
  const PER = 12; // 1文あたり 12行（8項目×12＝96個。D1 の上限は100個）
  for (let i = 0; i < rows.length; i += PER) {
    const part = rows.slice(i, i + PER).filter((r) => Array.isArray(r) && cut(r[1], 80));
    if (!part.length) continue;
    const args = [];
    for (const r of part) args.push(b.pref, type, code, cut(r[0], 40), cut(r[1], 80), cut(r[2], 120), cut(r[3], 20), cut(r[4], 20));
    stmts.push(env.DB.prepare('INSERT INTO directory (pref, service_type, code, city, name, address, tel, office_no) VALUES ' + part.map(() => '(?,?,?,?,?,?,?,?)').join(',')).bind(...args));
  }
  if (b.done) {
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO directory_meta (pref, code, service_type, n, source, imported_at) VALUES (?,?,?,(SELECT COUNT(*) FROM directory WHERE pref = ? AND code = ?),?,?)')
      .bind(b.pref, code, type, b.pref, code, cut(b.source, 200), now()));
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (b.done) await audit(env, req, user, 'directory_import', `${b.pref} ${type}`);
  return json(env, req, { ok: true });
}

// ---------- 動作確認（/api/health） ----------
// 設定がそろっているかを「はい／いいえ」だけで返します（鍵の中身は返しません）
async function healthCheck(env) {
  const check = {
    database: '未接続（バインディング DB を確認）',
    tables: '未確認',
    data_key: dataKeyText(env) ? 'OK' : '未設定',
    encryption: '未確認',
    setup_token: env.SETUP_TOKEN ? 'OK' : '未設定',
    allowed_origins: env.ALLOWED_ORIGINS || '未設定',
    file_storage: env.FILE_STORAGE === 'r2' ? (env.FILES ? 'r2' : 'r2（バケット FILES が未接続）') : 'd1',
  };
  if (env.DB) {
    try {
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('users','offices','clients','client_offices','messages','room_reads','sessions','login_attempts','audit_logs','attachments','attachment_chunks')").first();
      check.database = 'OK';
      check.tables = r.n === 11 ? 'OK' : `不足（${r.n}/11）SQL を実行してください`;
    } catch {
      check.database = 'エラー';
    }
  }
  if (check.data_key === 'OK') {
    try {
      keyCache.delete('0');
      check.encryption = (await open(env, 0, await seal(env, 0, 'テスト'))) === 'テスト' ? 'OK' : 'エラー';
    } catch (e) {
      check.encryption = 'エラー：' + String(e && e.message || e).slice(0, 120);
    }
  }
  if (check.tables === 'OK') {
    try {
      await env.DB.batch([
        env.DB.prepare('SELECT id, role, cm_id, office_id, login_id, display_name, password_hash, must_change_pw, active, failed_count, locked_until, created_at FROM users LIMIT 1'),
        env.DB.prepare('SELECT id, cm_id, name, service_type, can_post, active, created_at FROM offices LIMIT 1'),
        env.DB.prepare('SELECT id, cm_id, name, note, archived, last_msg_id, last_msg_at, created_at FROM clients LIMIT 1'),
        env.DB.prepare('SELECT id, cm_id, client_id, author_id, body, created_at FROM messages LIMIT 1'),
        env.DB.prepare('SELECT user_id, client_id, last_read_id, read_at FROM room_reads LIMIT 1'),
        env.DB.prepare('SELECT id, cm_id, user_id, action, target, ip, ua, at FROM audit_logs LIMIT 1'),
        env.DB.prepare('SELECT id, cm_id, client_id, message_id, uploader_id, filename, mime, size, storage, created_at FROM attachments LIMIT 1'),
      ]);
      check.columns = 'OK';
    } catch (e) {
      check.columns = '表の形が古い：' + String(e && e.message || e).slice(0, 160);
    }
  }
  const ok = check.database === 'OK' && check.tables === 'OK' && check.data_key === 'OK' && check.setup_token === 'OK' && check.encryption === 'OK' && check.columns === 'OK';
  const out = { ok, version: VERSION, app: 'ケアつなぎ API', check };
  if (lastError) out.last_error = lastError;
  return out;
}

// ---------- ルーター ----------
async function route(env, req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;

  if (m === 'GET' && (p === '' || p === '/api/health')) return json(env, req, await healthCheck(env));
  if (m === 'GET' && p === '/api/service-types') return json(env, req, { service_types: SERVICE_TYPES });
  if (m === 'POST' && p === '/api/login') { await ensureSchema(env); return handleLogin(env, req); }
  if (m === 'POST' && p === '/api/setup') return handleSetup(env, req);

  await ensureSchema(env);
  const user = await authenticate(env, req);

  if (m === 'GET' && p === '/api/me') return json(env, req, { user: await publicUser(env, user) });
  if (m === 'POST' && p === '/api/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
    await audit(env, req, user, 'logout');
    return json(env, req, { ok: true });
  }
  if (m === 'POST' && p === '/api/password') return changePassword(env, req, user);
  if (m === 'POST' && p === '/api/me/prefs') {
    const b = await readJson(req);
    if (!['normal', 'large', 'xlarge'].includes(b.font_size)) throw new HttpError(400, '文字の大きさが不正です');
    await env.DB.prepare('INSERT INTO user_prefs (user_id, font_size) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET font_size = excluded.font_size').bind(user.id, b.font_size).run();
    return json(env, req, { ok: true });
  }

  requirePwChanged(user);

  if (m === 'GET' && p === '/api/rooms') return listRooms(env, req, user, url);
  let mm;
  if ((mm = p.match(/^\/api\/rooms\/(\d+)\/messages$/))) {
    const id = intId(mm[1]);
    if (m === 'GET') return listMessages(env, req, await ctxForClient(env, user, id), id, url);
    if (m === 'POST') return postMessage(env, req, await ctxForClient(env, user, id), id);
  }
  if ((mm = p.match(/^\/api\/rooms\/(\d+)\/attachments$/)) && m === 'POST') {
    const id = intId(mm[1]);
    return uploadAttachment(env, req, await ctxForClient(env, user, id), id);
  }
  if ((mm = p.match(/^\/api\/attachments\/(\d+)$/)) && m === 'GET') return getAttachment(env, req, user, intId(mm[1]));

  if (user.role === 'provider') {
    if (m === 'GET' && p === '/api/links') return listLinks(env, req, user);
    if ((mm = p.match(/^\/api\/links\/(\d+)\/(accept|remove)$/)) && m === 'POST') return answerLink(env, req, user, intId(mm[1]), mm[2] === 'accept');
  }
  requireCm(user);
    if (m === 'GET' && p === '/api/directory/status') return directoryStatus(env, req, url);
  if (m === 'GET' && p === '/api/directory/cities') return directoryCities(env, req, url);
  if (m === 'GET' && p === '/api/directory/list') return directoryList(env, req, url);
  if (m === 'GET' && p === '/api/directory/source') return directorySource(env, req, url);
  if (m === 'POST' && p === '/api/directory/import') return directoryImport(env, req, user);
  if (p === '/api/offices') {
    if (m === 'GET') return listOffices(env, req, user);
    if (m === 'POST') return createOffice(env, req, user);
  }
  if ((mm = p.match(/^\/api\/offices\/(\d+)$/)) && m === 'PATCH') return updateOffice(env, req, user, intId(mm[1]));
  if ((mm = p.match(/^\/api\/offices\/(\d+)\/delete$/)) && m === 'POST') return deleteOffice(env, req, user, intId(mm[1]));
  if ((mm = p.match(/^\/api\/clients\/(\d+)\/delete$/)) && m === 'POST') return deleteClient(env, req, user, intId(mm[1]));
  if (p === '/api/clients') {
    if (m === 'GET') return listClients(env, req, user);
    if (m === 'POST') return createClient(env, req, user);
  }
  if ((mm = p.match(/^\/api\/clients\/(\d+)$/)) && m === 'PATCH') return updateClient(env, req, user, intId(mm[1]));
  if (p === '/api/accounts') {
    if (m === 'GET') return listAccounts(env, req, user);
    if (m === 'POST') return createAccount(env, req, user);
  }
  if (m === 'POST' && p === '/api/accounts/link') return linkAccount(env, req, user);
  if ((mm = p.match(/^\/api\/accounts\/(\d+)$/)) && m === 'PATCH') return updateAccount(env, req, user, intId(mm[1]));
  if (m === 'GET' && p === '/api/audit') return listAudit(env, req, user, url);

  throw new HttpError(404, '見つかりません');
}

// ---------- 計測（開発時のみ：DEBUG_METRICS=1 で D1 の読み書き行数をヘッダーに出す） ----------
function meteredDb(db, acc) {
  const add = (r) => { acc.q++; acc.r += r?.meta?.rows_read || 0; acc.w += r?.meta?.rows_written || 0; return r; };
  const wrap = (st) => ({
    _raw: st,
    bind: (...a) => wrap(st.bind(...a)),
    first: async () => { const r = add(await st.all()); return r.results[0] ?? null; },
    all: async () => add(await st.all()),
    run: async () => add(await st.run()),
  });
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (stmts) => { const rs = await db.batch(stmts.map((x) => x._raw || x)); rs.forEach(add); return rs; },
  };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, req) });
    let acc = null;
    if (env.DEBUG_METRICS === '1') {
      acc = { q: 0, r: 0, w: 0 };
      env = { ...env, DB: meteredDb(env.DB, acc) };
    }
    let res;
    try {
      res = await route(env, req);
    } catch (e) {
      if (e instanceof HttpError) res = json(env, req, { error: e.message }, e.status);
      else {
        console.error(e);
        lastError = { at: new Date().toISOString(), path: new URL(req.url).pathname, message: String(e && e.message || e).slice(0, 200) };
        res = json(env, req, { error: 'サーバーでエラーが発生しました' }, 500);
      }
    }
    if (acc) res.headers.set('X-D1-Metrics', `queries=${acc.q}; rows_read=${acc.r}; rows_written=${acc.w}`);
    return res;
  },
};
