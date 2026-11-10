// サーバー（Cloudflare Worker）のアドレス。最後の / は付けません。
// アドレスの最後に ?demo を付けて開くと、見本データ（利用者50名）のデモで動きます。
//   例: https://ユーザー名.github.io/リポジトリ名/?demo
window.APP_CONFIG = {
  API_BASE: /[?&]demo\b/.test(location.search) ? 'demo' : 'https://caremanage.umebiz1366.workers.dev',
};
