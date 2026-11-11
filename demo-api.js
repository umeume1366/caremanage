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
      { id: 5, role: 'provider', cm_id: 1, office_id: 4, login_id: 'aozora-demo', name: '小川 誠', pw: 'Demo-pass-123', must: false, active: true },
      { id: 6, role: 'provider', cm_id: 1, office_id: 9, login_id: 'reha-demo', name: '野口 直樹', pw: 'Demo-pass-123', must: false, active: true },
      { id: 7, role: 'provider', cm_id: 1, office_id: 12, login_id: 'short-demo', name: '原田 久美', pw: 'Demo-pass-123', must: false, active: true },
      { id: 8, role: 'provider', cm_id: 1, office_id: 14, login_id: 'yougu-demo', name: '村上 剛', pw: 'Demo-pass-123', must: false, active: true },
      { id: 9, role: 'provider', cm_id: 1, office_id: 16, login_id: 'yakkyoku-demo', name: '近藤 彩', pw: 'Demo-pass-123', must: false, active: true },
      { id: 10, role: 'provider', cm_id: 1, office_id: 19, login_id: 'tokuyou-demo', name: '石井 隆', pw: 'Demo-pass-123', must: false, active: true },
      // 2人目のケアマネ（同じ事業所IDを共有するしくみの見本）
      { id: 11, role: 'cm', cm_id: 11, office_id: null, login_id: 'cm2-demo', name: '大野 美香', pw: 'Demo-pass-123', must: false, active: true },
      { id: 12, role: 'cm', cm_id: 12, office_id: null, login_id: 'cm3-demo', name: '渡部 健太', pw: 'Demo-pass-123', must: false, active: true },
      { id: 13, role: 'cm', cm_id: 13, office_id: null, login_id: 'cm4-demo', name: '森 由紀子', pw: 'Demo-pass-123', must: false, active: true },
    ],
    // いろいろな種類のサービス事業所（居宅サービス・入所サービス）
    offices: [
      { id: 1, name: 'ひまわり訪問介護', service_type: '訪問介護', can_post: true, active: true },
      { id: 2, name: 'さくらデイサービス', service_type: '通所介護', can_post: true, active: true },
      { id: 3, name: 'みどり訪問看護ステーション', service_type: '訪問看護', can_post: true, active: true },
      { id: 4, name: 'あおぞらヘルパーステーション', service_type: '訪問介護', can_post: true, active: true },
      { id: 5, name: 'デイサービスこもれび', service_type: '通所介護', can_post: false, active: true },
      { id: 6, name: 'けやき訪問看護', service_type: '訪問看護', can_post: false, active: true },
      { id: 7, name: 'アクア訪問入浴', service_type: '訪問入浴介護', can_post: false, active: true },
      { id: 8, name: 'もみじ病院 訪問リハビリ', service_type: '訪問リハビリテーション', can_post: false, active: true },
      { id: 9, name: 'あおばクリニック デイケア', service_type: '通所リハビリテーション', can_post: true, active: true },
      { id: 10, name: '小さなデイ ほっこり', service_type: '地域密着型通所介護', can_post: false, active: true },
      { id: 11, name: '認知症デイ やすらぎ', service_type: '認知症対応型通所介護', can_post: false, active: true },
      { id: 12, name: 'ショートステイ松風', service_type: '短期入所生活介護', can_post: true, active: true },
      { id: 13, name: '老健つばさ ショートステイ', service_type: '短期入所療養介護', can_post: false, active: true },
      { id: 14, name: 'あおば福祉用具', service_type: '福祉用具貸与', can_post: true, active: true },
      { id: 15, name: 'ケアショップ ふくふく', service_type: '特定福祉用具販売', can_post: false, active: true },
      { id: 16, name: 'たんぽぽ薬局', service_type: '居宅療養管理指導', can_post: true, active: true },
      { id: 17, name: '小規模多機能 ひだまり', service_type: '小規模多機能型居宅介護', can_post: false, active: true },
      { id: 18, name: '定期巡回 24ケア', service_type: '定期巡回・随時対応型訪問介護看護', can_post: false, active: true },
      { id: 19, name: '特別養護老人ホーム 望洋苑', service_type: '介護老人福祉施設（特養）', can_post: true, active: true },
      { id: 20, name: '介護老人保健施設 つばさ', service_type: '介護老人保健施設（老健）', can_post: false, active: true },
      { id: 21, name: 'グループホーム 陽だまりの家', service_type: '認知症対応型共同生活介護（グループホーム）', can_post: false, active: true },
      { id: 22, name: '介護付き有料老人ホーム さくら館', service_type: '特定施設入居者生活介護', can_post: false, active: true },
      { id: 23, name: '介護医療院 しおさい', service_type: '介護医療院', can_post: false, active: true },
      { id: 24, name: '住まいの改修 たくみ工務店', service_type: '住宅改修', can_post: false, active: true },
      // 2人目のケアマネ（大野）が登録している事業所
      { id: 101, cm_id: 11, name: 'ひまわり訪問介護', service_type: '訪問介護', can_post: true, active: true },
      { id: 102, cm_id: 11, name: 'さくらデイサービス', service_type: '通所介護', can_post: true, active: true },
      { id: 103, cm_id: 11, name: 'はなみずき訪問看護', service_type: '訪問看護', can_post: false, active: true },
      { id: 104, cm_id: 11, name: 'あおば福祉用具', service_type: '福祉用具貸与', can_post: true, active: true },
      { id: 105, cm_id: 11, name: 'たんぽぽ薬局', service_type: '居宅療養管理指導', can_post: true, active: true },
      // 3人目のケアマネ（渡部）が登録している事業所
      { id: 201, cm_id: 12, name: 'ひまわり訪問介護', service_type: '訪問介護', can_post: true, active: true },
      { id: 202, cm_id: 12, name: 'みどり訪問看護ステーション', service_type: '訪問看護', can_post: true, active: true },
      { id: 203, cm_id: 12, name: 'ショートステイ松風', service_type: '短期入所生活介護', can_post: true, active: true },
      { id: 204, cm_id: 12, name: 'たんぽぽ薬局', service_type: '居宅療養管理指導', can_post: true, active: true },
      { id: 205, cm_id: 12, name: 'デイサービスこもれび', service_type: '通所介護', can_post: false, active: true },
      // 4人目のケアマネ（森）が登録している事業所
      { id: 301, cm_id: 13, name: 'さくらデイサービス', service_type: '通所介護', can_post: true, active: true },
      { id: 302, cm_id: 13, name: 'みどり訪問看護ステーション', service_type: '訪問看護', can_post: true, active: true },
      { id: 303, cm_id: 13, name: 'あおば福祉用具', service_type: '福祉用具貸与', can_post: true, active: true },
      { id: 304, cm_id: 13, name: 'ショートステイ松風', service_type: '短期入所生活介護', can_post: true, active: true },
      { id: 305, cm_id: 13, name: 'あおぞらヘルパーステーション', service_type: '訪問介護', can_post: true, active: true },
    ],
    // 事業所アカウントと、ケアマネとのつながり（1つのIDで複数のケアマネとつながれる）
    links: [],
    clients: [],
    messages: [],
    reads: new Set(),
    audit: [],
    seq: 1000,
  };
  // ---- 見本の利用者60名（継続45名・終了15名）と連絡を作る（毎回同じ内容になるよう固定の乱数） ----
  (() => {
    let seed = 11;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    const pick = (a) => a[rnd(a.length)];
    const sei = ['鈴木', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山口', '松本', '井上', '木村', '林', '清水', '斎藤', '山崎', '森', '池田', '橋本', '阿部', '石川', '前田', '藤田', '岡田', '後藤', '長谷川', '村田', '遠藤', '青木'];
    const mei = ['一郎', 'キヨ', '正雄', 'ハル', '茂', 'トメ', '清', 'フミ', '勇', '千代', '博', 'ミツ', '実', 'ヨシ子', '武', '静子', '昭', '和子', '進', '幸子', '弘', 'タケ', '秀夫', '節子', '利夫', '敏子', '三郎', '文子', '義雄', '春江'];
    const names = [];
    for (let i = 0; names.length < 60; i++) {
      const n = `${sei[i % 30]} ${mei[(i * 7 + 3 + Math.floor(i / 30) * 11) % 30]}`;
      if (!names.includes(n)) names.push(n);
    }
    const home = [1, 4], day = [2, 5], nurse = [3, 6];
    const live = ['独居', '長女と同居', '夫婦のみ世帯', '長男夫婦と同居', '日中独居', '次女が近所に在住'];
    const kaigoOf = (i) => ['要支援1', '要支援2', '要介護1', '要介護2', '要介護3', '要介護4', '要介護5'][i];
    // 継続利用の45名：介護度に合わせて、いろいろな事業所を組み合わせる
    for (let i = 0; i < 45; i++) {
      const lv = i < 4 ? 1 : i < 10 ? 2 : i < 20 ? 3 : i < 30 ? 4 : i < 38 ? 5 : 6;
      const ids = new Set();
      const extra = [];
      if (i % 15 === 7) {
        // 小規模多機能を使う方（訪問・通い・泊まりを1か所で）
        ids.add(17); if (rnd(2)) ids.add(14); if (lv >= 4) ids.add(3);
      } else if (i % 15 === 11 && lv >= 3) {
        // 定期巡回を使う方
        ids.add(18); ids.add(14); if (rnd(2)) ids.add(pick(day));
      } else {
        if (lv <= 1 || rnd(10) < 6) ids.add(pick(home));
        if (rnd(10) < 6) ids.add(pick(day));
        if (lv >= 3 && rnd(10) < 4) ids.add(pick(nurse));
        if (lv >= 4 && rnd(10) < 5) ids.add(7);
        if (rnd(10) < 2) ids.add(8);
        if (rnd(10) < 2) ids.add(9);
        if (rnd(10) < 2) ids.add(10);
        if (i % 9 === 4) { ids.add(11); extra.push('認知症あり'); }
        if (lv >= 3 && rnd(10) < 3) ids.add(12);
        if (lv >= 4 && rnd(10) < 2) ids.add(13);
        if (lv >= 2 && rnd(10) < 5) ids.add(14);
        if (rnd(10) < 1) ids.add(15);
        if (lv >= 3 && rnd(10) < 3) ids.add(16);
        if (i % 13 === 5) { ids.add(24); extra.push('手すり取付を検討中'); }
        if (lv >= 5 && i % 6 === 0) { ids.add(19); extra.push('特養に入所申込済み'); }
        if (!ids.size) ids.add(pick(home));
      }
      db.clients.push({ id: i + 1, name: names[i], note: [kaigoOf(lv), pick(live), ...extra].join('・'), archived: false, office_ids: [...ids].sort((a, b) => a - b) });
    }
    // 支援を終了した15名：ご逝去・施設入所・担当変更など
    const fmt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
    const ended = [
      ['ご逝去', [1, 3, 14]], ['ご逝去', [3, 6, 7, 14]], ['ご逝去（入院先にて）', [2, 16]], ['ご逝去', [4, 3, 13]], ['ご逝去', [1, 5]], ['ご逝去（ご自宅にて看取り）', [3, 7, 14, 16]],
      ['特養に入所のため担当終了', [19, 2, 12]], ['老健に入所のため担当終了', [20, 9]], ['グループホームに入居のため担当終了', [21, 11]], ['有料老人ホームに入居のため担当終了', [22, 1]], ['介護医療院に入所のため担当終了', [23, 3, 13]],
      ['ご家族の転居に伴い、他市の居宅介護支援事業所へ担当変更', [4, 2]], ['ご本人の希望により、他の居宅介護支援事業所へ担当変更', [1, 10]], ['小規模多機能の利用開始に伴い担当変更', [17]], ['要支援に変更となり、地域包括支援センターへ担当変更', [5]],
    ];
    ended.forEach(([why, ids], k) => {
      const at = T - (20 + k * 9 + rnd(6)) * D;
      db.clients.push({ id: 46 + k, name: names[45 + k], note: `【終了】${fmt(at)} ${why}（${kaigoOf(2 + rnd(5))}）`, archived: true, office_ids: ids });
    });

    const cmMsgs = [
      '来週のサービス担当者会議は、{d}10時からご自宅で行います。ご出席をお願いします。',
      '昨日から右ひざの痛みを訴えています。介助の際は様子を見ていただけますか。',
      '来月からケアプランを変更します。提供票は来週お送りします。',
      'ご家族から、最近食事量が減っているとの相談がありました。気づいたことがあれば教えてください。',
      '年末年始のサービス予定を確認させてください。',
      '主治医から、血圧の薬が変更になったと連絡がありました。ふらつきに注意してください。',
      '介護認定の更新で、来月に認定調査があります。日程が決まったらお知らせします。',
    ];
    const reply = {
      訪問介護: ['本日の訪問時、冷蔵庫に期限切れの食品が多くありました。ご家族への共有をお願いします。', '承知しました。サービス提供責任者が伺います。', '本日は買い物と掃除を実施しました。お変わりありません。'],
      通所介護: ['本日の入浴は問題なく実施しました。', '昼食は8割ほど召し上がりました。', '承知しました。送迎時間を調整します。'],
      訪問看護: ['血圧 138/82、体温 36.5℃。むくみは軽度です。', '服薬の飲み忘れが2回ありました。お薬カレンダーの導入を提案します。', '主治医に報告済みです。次回訪問で再確認します。'],
      通所リハビリテーション: ['歩行訓練は杖で20m可能になりました。', '体力測定の結果をお送りします。前回より改善しています。'],
      短期入所生活介護: ['ショートステイ中はよく眠れていました。食事も全量召し上がりました。', '次回の利用日を{d}で承りました。'],
      福祉用具貸与: ['手すりの高さを調整しました。', '車いすの点検を行いました。異常ありません。'],
      居宅療養管理指導: ['お薬を一包化に変更しました。飲みやすくなったとのことです。', '残薬を確認しました。湿布が多めに余っています。'],
      '介護老人福祉施設（特養）': ['入所の申し込みを受け付けました。順番が近づいたらご連絡します。', '入所判定会議の結果は来月お知らせします。'],
    };
    const accountOf = new Map(db.users.filter((x) => x.office_id).map((x) => [x.office_id, x.id]));
    let mid = 0;
    for (const c of db.clients) {
      if (c.archived || rnd(10) < 2) continue;
      let t = T - (rnd(20) + 1) * D - rnd(10) * H;
      const n = 1 + rnd(4);
      for (let k = 0; k < n; k++) {
        const oid = c.office_ids[rnd(c.office_ids.length)];
        const o = db.offices.find((x) => x.id === oid);
        const author = (k % 2 === 1 || rnd(10) < 3) && o.can_post && accountOf.has(oid) && reply[o.service_type] ? accountOf.get(oid) : 1;
        const pool = author === 1 ? cmMsgs : reply[o.service_type];
        const day = new Date(T + 4 * D);
        db.messages.push({ id: ++mid, client_id: c.id, author_id: author, body: pick(pool).replace('{d}', `${day.getMonth() + 1}月${day.getDate()}日`), at: t });
        t += (rnd(30) + 1) * H;
        if (t > T) t = T - rnd(60) * 60e3;
      }
    }
    db.messages.sort((a, b) => a.at - b.at).forEach((m, i) => { m.id = i + 1; });
    // 古いメッセージは既読、直近2日分は未読のまま
    for (const m of db.messages) {
      if (m.at < T - 2 * D) for (const u of db.users) if (u.id !== m.author_id) db.reads.add(`${u.id}:${m.id}`);
    }
  })();

  // ---- ほかのケアマネ3人（大野・渡部・森）の利用者と、事業所とのつながり ----
  (() => {
    for (const o of db.offices) if (o.cm_id == null) o.cm_id = 1;
    for (const c of db.clients) c.cm_id = 1;
    for (const x of db.users) if (x.role === 'provider') db.links.push({ user_id: x.id, cm_id: 1, office_id: x.office_id, status: 'active', active: true, at: T - 90 * D });
    // 事業所アカウント（ID）1つで、複数のケアマネとつながっている。pending は「つながる依頼」が届いていて未承認
    // 2:ひまわり訪問介護 3:さくらデイ 4:みどり訪問看護 7:ショート松風 8:あおば福祉用具 9:たんぽぽ薬局 5:あおぞらヘルパー
    const L = [
      [2, 11, 101, 'active'], [3, 11, 102, 'pending'], [8, 11, 104, 'active'], [9, 11, 105, 'active'],
      [2, 12, 201, 'active'], [4, 12, 202, 'active'], [7, 12, 203, 'active'], [9, 12, 204, 'active'],
      [3, 13, 301, 'active'], [4, 13, 302, 'active'], [8, 13, 303, 'pending'], [7, 13, 304, 'pending'], [5, 13, 305, 'active'],
    ];
    L.forEach(([user_id, cm_id, office_id, status], i) => db.links.push({ user_id, cm_id, office_id, status, active: true, at: T - (60 - i * 4) * D }));
    const people = {
      11: [['前川 ミドリ', '要介護2・独居', [101, 104]], ['小野寺 守', '要介護3・夫婦のみ世帯', [101, 102, 103, 105]], ['菅原 トシ', '要介護1・長女と同居', [102]],
        ['北村 清一', '要介護4・長男夫婦と同居', [101, 103, 104, 105]], ['今井 フサ', '要支援2・独居', [101]], ['杉山 勝', '要介護2・日中独居', [102, 104]],
        ['野村 ちよ', '要介護3・次女が近所に在住', [101, 102]], ['宮本 和夫', '要介護1・夫婦のみ世帯', [103, 105]]],
      12: [['佐野 ツル', '要介護3・独居', [201, 202, 204]], ['川口 正', '要介護2・長女と同居', [205, 201]], ['飯田 ハナ', '要介護4・夫婦のみ世帯', [202, 203, 204]],
        ['桑原 昭二', '要介護1・日中独居', [201]], ['横山 キミ', '要介護5・長男夫婦と同居', [202, 203]], ['堀 健次', '要介護2・独居', [205, 204]],
        ['関 タマ', '要介護3・次女が近所に在住', [201, 203]], ['平田 良子', '要支援2・夫婦のみ世帯', [201]], ['市川 寛', '要介護4・独居', [201, 202, 203, 204]]],
      13: [['大塚 スミ', '要介護2・独居', [301, 303]], ['千葉 忠', '要介護3・長女と同居', [301, 302, 305]], ['上田 ふみ', '要介護1・夫婦のみ世帯', [305]],
        ['松井 一男', '要介護4・長男夫婦と同居', [302, 303, 304]], ['新井 ヨネ', '要介護2・日中独居', [301, 305]], ['荒木 博之', '要介護3・独居', [302, 304, 305]],
        ['水野 千鶴', '要支援1・夫婦のみ世帯', [301]]],
    };
    const cmLine = ['来月の提供票をお送りします。ご確認ください。', '退院後の初回訪問は明日です。転倒に気をつけてください。', 'ご家族から、夜間の物音が増えたと相談がありました。',
      '来週のサービス担当者会議は、ご自宅で14時からです。', 'ケアプランを一部変更しました。入浴の回数を週2回にします。'];
    const officeLine = {
      訪問介護: ['本日伺いました。室内は杖で歩けています。', '買い物代行の領収書を連絡帳に入れました。', '承知しました。曜日を調整します。'],
      通所介護: ['本日の入浴は問題なく実施しました。', '昼食は全量召し上がりました。', '送迎時間を10分早めます。'],
      訪問看護: ['血圧 132/78、体温 36.4℃。お変わりありません。', '褥瘡（床ずれ）は改善傾向です。', '主治医に報告済みです。'],
      短期入所生活介護: ['ショートステイ中はよく眠れていました。', '次回の利用日を承りました。'],
      福祉用具貸与: ['手すりの高さを調整しました。', '車いすの点検を行いました。異常ありません。'],
      居宅療養管理指導: ['お薬を一包化に変更しました。', '残薬を確認しました。湿布が多めに余っています。'],
    };
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    let cid = 100;
    for (const [cm, list] of Object.entries(people)) {
      for (const [name, note, ids] of list) {
        const c = { id: ++cid, cm_id: Number(cm), name, note, archived: false, office_ids: ids };
        db.clients.push(c);
        let t = T - (rnd(12) + 1) * D - rnd(10) * H;
        const n = rnd(4);
        for (let k = 0; k < n; k++) {
          const oid = ids[rnd(ids.length)];
          const o = db.offices.find((x) => x.id === oid);
          const lk = db.links.find((l) => l.cm_id === c.cm_id && l.office_id === oid && l.status === 'active');
          const byOffice = k % 2 === 1 && lk && o.can_post && officeLine[o.service_type];
          const pool = byOffice ? officeLine[o.service_type] : cmLine;
          db.messages.push({ id: 90000 + db.messages.length, client_id: c.id, author_id: byOffice ? lk.user_id : c.cm_id, body: pool[rnd(pool.length)], at: t });
          t += (rnd(30) + 2) * H; if (t > T) t = T - rnd(90) * 60e3;
        }
      }
    }
    db.messages.sort((a, z) => a.at - z.at).forEach((m, i) => { m.id = i + 1; });
    db.reads = new Set();
    for (const m of db.messages) if (m.at < T - 2 * D) for (const u of db.users) if (u.id !== m.author_id) db.reads.add(`${u.id}:${m.id}`);
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
  // 操作の記録は、どのケアマネの記録かを持たせる（事業所の操作は、相手のケアマネの記録に入る）
  const log = (u, action, target, cm) => db.audit.unshift({ id: nextId(), at: Date.now(), action, target, ip: 'デモ', login_id: u?.login_id, name: u?.name, cm: cm ?? u?.cm_id });
  const office = (id) => db.offices.find((o) => o.id === id);
  const userOf = (id) => db.users.find((x) => x.id === id);
  // 事業所アカウントが、そのケアマネとつながっていて使える状態か（使えるならそのケアマネ側の事業所を返す）
  const linkFor = (u, cmId) => {
    const l = db.links.find((x) => x.user_id === u.id && x.cm_id === cmId && x.status === 'active' && x.active);
    return l && office(l.office_id)?.active ? l : null;
  };
  const activeLinks = (u) => db.links.filter((l) => l.user_id === u.id && linkFor(u, l.cm_id)).sort((a, z) => a.at - z.at);
  const pub = (u) => {
    if (u.role === 'cm') return { id: u.id, role: u.role, login_id: u.login_id, name: u.name, must_change_pw: u.must, font_size: u.font_size || null, pref: u.pref || null, office: null };
    const act = activeLinks(u);
    const l = act.find((x) => x.cm_id === u.cm_id) || act[0];
    const o = l ? office(l.office_id) : null;
    return {
      id: u.id, role: u.role, login_id: u.login_id, name: u.name, must_change_pw: u.must, font_size: u.font_size || null, pref: u.pref || null,
      office: o ? { id: o.id, name: o.name, can_post: o.can_post, service_type: o.service_type } : null,
      links: act.length, pending: db.links.filter((x) => x.user_id === u.id && x.status === 'pending').length,
    };
  };
  const visible = (u, c) => {
    if (c.archived) return false;
    if (u.role === 'cm') return c.cm_id === u.cm_id;
    const l = linkFor(u, c.cm_id);
    return !!l && c.office_ids.includes(l.office_id);
  };
  const postable = (u, c) => u.role === 'cm' || !!office(linkFor(u, c.cm_id)?.office_id)?.can_post;

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
    if (path === '/api/me/prefs') {
      if (b.font_size === undefined && b.pref === undefined) return err(400, '変更する内容がありません');
      if (b.font_size !== undefined) {
        if (!['normal', 'large', 'xlarge'].includes(b.font_size)) return err(400, '文字の大きさが不正です');
        u.font_size = b.font_size;
      }
      if (b.pref !== undefined) u.pref = b.pref;
      return ok({ ok: true });
    }
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
          ...(u.role === 'cm' ? {} : { cm: { id: c.cm_id, name: userOf(c.cm_id).name } }),
          offices: c.office_ids.map((id) => ({ id, name: office(id).name, service_type: office(id).service_type })),
          last_message: last ? last.body.slice(0, 60) : '', last_at: last ? last.at : T - 5 * D,
          unread: ms.filter((m) => m.author_id !== u.id && !db.reads.has(`${u.id}:${m.id}`)).length,
        };
      }).sort((a, z) => z.last_at - a.last_at);
      if (u.role === 'cm') return ok({ rooms });
      return ok({ rooms, cms: activeLinks(u).map((l) => ({ id: l.cm_id, name: userOf(l.cm_id).name })) });
    }
    let m;
    if ((m = path.match(/^\/api\/rooms\/(\d+)\/messages$/))) {
      const c = db.clients.find((x) => x.id === Number(m[1]));
      if (!c || !visible(u, c)) return err(404, '見つかりません');
      const canPost = postable(u, c);
      if (method === 'POST') {
        if (!canPost) return err(403, 'この事業所は閲覧のみです');
        const text = (b.body || '').trim();
        if (!text) return err(400, 'メッセージを入力してください');
        const id = nextId();
        db.messages.push({ id, client_id: c.id, author_id: u.id, body: text, at: Date.now() });
        log(u, 'message_post', `${c.name} 様`, c.cm_id);
        return ok({ ok: true, id });
      }
      const after = Number(q.get('after') || 0);
      const list = db.messages.filter((x) => x.client_id === c.id && x.id > after);
      list.forEach((x) => { if (x.author_id !== u.id) db.reads.add(`${u.id}:${x.id}`); });
      if (!after) log(u, 'room_view', `${c.name} 様`, c.cm_id);
      const roomIds = db.messages.filter((x) => x.client_id === c.id).map((x) => x.id);
      const reads = db.users.filter((y) => y.id !== u.id).map((y) => Math.max(0, ...roomIds.filter((id) => db.reads.has(`${y.id}:${id}`)))).filter((x) => x > 0);
      return ok({
        reads,
        can_post: canPost,
        messages: list.map((x) => {
          const a = db.users.find((y) => y.id === x.author_id);
          return {
            id: x.id, body: x.body, created_at: x.at, mine: x.author_id === u.id, author: a.name, author_role: a.role,
            author_office: a.role === 'provider' ? office(db.links.find((l) => l.user_id === a.id && l.cm_id === c.cm_id)?.office_id)?.name || '' : '',
            file: files.has(x.id) ? (({ id, name, mime, size }) => ({ id, name, mime, size }))(files.get(x.id)) : null,
            read_count: x.author_id === u.id ? db.users.filter((y) => y.id !== u.id && db.reads.has(`${y.id}:${x.id}`)).length : null,
          };
        }),
      });
    }
    if (u.role === 'provider' && path === '/api/links') {
      return ok({ links: db.links.filter((l) => l.user_id === u.id).sort((a, z) => (a.status === 'pending' ? 0 : 1) - (z.status === 'pending' ? 0 : 1) || a.at - z.at).map((l) => {
        const o = office(l.office_id);
        return { cm_id: l.cm_id, cm_name: userOf(l.cm_id).name, office_name: o?.name || '', status: l.status, active: !!(l.active && o?.active), can_post: !!o?.can_post, home: l.cm_id === u.cm_id, created_at: l.at };
      }) });
    }
    if (u.role === 'provider' && (m = path.match(/^\/api\/links\/(\d+)\/(accept|remove)$/))) {
      const l = db.links.find((x) => x.user_id === u.id && x.cm_id === Number(m[1]));
      if (!l) return err(404, '見つかりません');
      const was = l.status;
      if (m[2] === 'accept') l.status = 'active'; else db.links.splice(db.links.indexOf(l), 1);
      log(u, m[2] === 'accept' ? 'link_accept' : (was === 'pending' ? 'link_reject' : 'link_remove'), u.login_id, l.cm_id);
      return ok({ ok: true });
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
      return ok({ offices: db.offices.filter((o) => o.cm_id === u.cm_id).map((o) => ({ ...o, client_count: db.clients.filter((c) => !c.archived && c.office_ids.includes(o.id)).length })) });
    }
    if (path === '/api/offices' && method === 'POST') {
      if (!b.name?.trim()) return err(400, '事業所名を入力してください');
      const id = nextId(); db.offices.push({ id, cm_id: u.cm_id, name: b.name.trim(), service_type: b.service_type || 'その他', can_post: !!b.can_post, active: true }); log(u, 'office_create', b.name);
      return ok({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/offices\/(\d+)$/))) {
      const o = office(Number(m[1])); if (!o || o.cm_id !== u.cm_id) return err(404, '見つかりません');
      if (b.name != null) o.name = b.name.trim();
      if (b.can_post != null) o.can_post = !!b.can_post;
      if (b.service_type != null) o.service_type = b.service_type;
      if (b.active != null) o.active = !!b.active;
      log(u, 'office_update', o.name); return ok({ ok: true });
    }
    if ((m = path.match(/^\/api\/offices\/(\d+)\/delete$/))) {
      const o = office(Number(m[1])); if (!o || o.cm_id !== u.cm_id) return err(404, '見つかりません');
      for (const c of db.clients) if (c.cm_id === u.cm_id) c.office_ids = c.office_ids.filter((x) => x !== o.id);
      db.links = db.links.filter((l) => !(l.cm_id === u.cm_id && l.office_id === o.id));
      db.offices.splice(db.offices.indexOf(o), 1);
      log(u, 'office_delete', o.name); return ok({ ok: true });
    }
    if ((m = path.match(/^\/api\/clients\/(\d+)\/delete$/))) {
      const c = db.clients.find((x) => x.id === Number(m[1])); if (!c || c.cm_id !== u.cm_id) return err(404, '見つかりません');
      db.messages = db.messages.filter((x) => x.client_id !== c.id);
      for (const [k, f] of [...files]) if (f.client_id === c.id) files.delete(k);
      db.clients.splice(db.clients.indexOf(c), 1);
      log(u, 'client_delete', c.name); return ok({ ok: true });
    }
    if (path === '/api/clients' && method === 'GET') return ok({ clients: db.clients.filter((c) => c.cm_id === u.cm_id).map((c) => ({ ...c })).sort((a, z) => a.archived - z.archived) });
    if (path === '/api/clients' && method === 'POST') {
      if (!b.name?.trim()) return err(400, '利用者名を入力してください');
      const id = nextId(); db.clients.push({ id, cm_id: u.cm_id, name: b.name.trim(), note: b.note || '', archived: false, office_ids: b.office_ids || [] }); log(u, 'client_create', b.name);
      return ok({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/clients\/(\d+)$/))) {
      const c = db.clients.find((x) => x.id === Number(m[1])); if (!c || c.cm_id !== u.cm_id) return err(404, '見つかりません');
      if (b.name != null) c.name = b.name.trim();
      if (b.note != null) c.note = b.note;
      if (b.archived != null) c.archived = !!b.archived;
      if (b.office_ids != null) c.office_ids = b.office_ids;
      log(u, 'client_update', c.name); return ok({ ok: true });
    }
    const others = (x) => db.links.filter((l) => l.user_id === x.id && l.cm_id !== u.cm_id && l.status === 'active').length;
    if (path === '/api/accounts' && method === 'GET') {
      return ok({ accounts: db.links.filter((l) => l.cm_id === u.cm_id).sort((a, z) => a.at - z.at).map((l) => {
        const x = userOf(l.user_id);
        const last = db.audit.find((a) => a.login_id === x.login_id && a.action === 'login_success');
        return { id: x.id, login_id: x.login_id, name: x.name, office_id: l.office_id, status: l.status, active: !!(l.active && x.active), locked: false, home: x.cm_id === u.cm_id, shared: others(x) > 0, last_login: last ? last.at : (l.status === 'active' ? T - 3 * H : null) };
      }) });
    }
    if (path === '/api/accounts' && method === 'POST') {
      const lid = String(b.login_id || '').normalize('NFKC').trim();
      if (!/^[A-Za-z0-9._-]{4,64}$/.test(lid)) return err(400, 'ログインIDは、半角の英字・数字で4文字以上にしてください（例：1234）');
      const ex = db.users.find((x) => x.login_id === lid);
      if (ex) return err(409, ex.role === 'provider' ? 'このログインIDは、すでに発行されています。同じ事業所なら「発行済みのIDとつなぐ」を使ってください' : 'このログインIDは使われています');
      if (!b.name?.trim()) return err(400, '担当者名を入力してください');
      const id = nextId(); db.users.push({ id, role: 'provider', cm_id: u.cm_id, office_id: b.office_id, login_id: lid, name: b.name.trim(), pw: b.password, must: true, active: true });
      db.links.push({ user_id: id, cm_id: u.cm_id, office_id: b.office_id, status: 'active', active: true, at: Date.now() });
      log(u, 'account_create', lid); return ok({ ok: true, id });
    }
    if (path === '/api/accounts/link' && method === 'POST') {
      const lid = String(b.login_id || '').normalize('NFKC').trim();
      const x = db.users.find((y) => y.login_id === lid && y.role === 'provider' && y.active);
      if (!x) return err(404, 'このログインIDの事業所アカウントは見つかりません。IDを事業所に確認してください');
      const ex = db.links.find((l) => l.user_id === x.id && l.cm_id === u.cm_id);
      if (ex) return err(409, ex.status === 'pending' ? 'すでに依頼しています。事業所の承認を待っています' : 'すでにつながっています');
      db.links.push({ user_id: x.id, cm_id: u.cm_id, office_id: b.office_id, status: 'pending', active: true, at: Date.now() });
      log(u, 'account_link_request', lid); return ok({ ok: true, id: x.id });
    }
    if ((m = path.match(/^\/api\/accounts\/(\d+)$/))) {
      const l = db.links.find((y) => y.user_id === Number(m[1]) && y.cm_id === u.cm_id);
      const x = l && userOf(l.user_id);
      if (!x) return err(404, '見つかりません');
      const home = x.cm_id === u.cm_id;
      if (b.remove) {
        if (home) return err(400, 'このケアマネが発行したアカウントです。使わなくなったら「停止」してください');
        db.links.splice(db.links.indexOf(l), 1); log(u, 'account_unlink', x.login_id); return ok({ ok: true });
      }
      if (b.password != null) {
        if (!home) return err(403, 'パスワードの再発行は、このアカウントを発行したケアマネジャーだけができます');
        if (others(x)) return err(403, 'ほかのケアマネジャーともつながっているため、ここでは再発行できません。事業所の方ご自身で「パスワード変更」をしてもらってください');
        x.pw = b.password; x.must = true; log(u, 'account_reset_pw', x.login_id);
      }
      if (b.active != null) {
        l.active = !!b.active;
        if (home && !others(x)) x.active = !!b.active;
        log(u, b.active ? 'account_enable' : 'account_disable', x.login_id);
      }
      return ok({ ok: true });
    }
    if (path === '/api/audit') return ok({ logs: db.audit.filter((a) => a.cm === u.cm_id).slice(0, 100) });
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
      log(session, 'file_view', `${c.name} 様`, c.cm_id);
      return new Response(f.blob, { status: 200, headers: { 'Content-Type': f.mime } });
    }
    if ((m = path.match(/^\/api\/rooms\/(\d+)\/attachments$/)) && method === 'POST') {
      const u = session; const c = db.clients.find((x) => x.id === Number(m[1]));
      if (!u || !c || !visible(u, c)) return jsonRes(err(404, '見つかりません'));
      if (!postable(u, c)) return jsonRes(err(403, 'この事業所は閲覧のみです'));
      const hd = init.headers || {};
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body]);
      if (blob.size > 5 * 1024 * 1024) return jsonRes(err(413, 'ファイルは5MBまでです'));
      const name = decodeURIComponent(hd['X-File-Name'] || 'ファイル');
      const caption = decodeURIComponent(hd['X-Caption'] || '');
      addFile(c.id, u.id, name, hd['Content-Type'], new Blob([blob], { type: hd['Content-Type'] }), Date.now(), caption);
      const mid = db.messages[db.messages.length - 1].id;
      db.reads.add(`${u.id}:${mid}`);
      log(u, 'file_upload', `${c.name} 様`, c.cm_id);
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
