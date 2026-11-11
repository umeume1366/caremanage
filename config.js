// サーバー（Cloudflare Worker）のアドレス。最後の / は付けません。
// ※ここを書き換えるときは、index.html の「connect-src」と「preconnect」のアドレスも同じものに直してください。
// アドレスの最後に ?demo を付けて開くと、見本データ（利用者50名）のデモで動きます。
//   例: https://ユーザー名.github.io/リポジトリ名/?demo
window.APP_CONFIG = {
  API_BASE: /[?&]demo\b/.test(location.search) ? 'demo' : 'https://caremanage.umebiz1366.workers.dev',
};

// ほかのサイトの画面の中に埋め込まれて表示されたときは、何も表示しない
// （見えないボタンを重ねて押させる「クリックジャッキング」というだましの手口への対策）
try {
  if (window.top !== window.self) { window.APP_CONFIG.BLOCKED = true; document.documentElement.hidden = true; }
} catch { window.APP_CONFIG.BLOCKED = true; document.documentElement.hidden = true; }
