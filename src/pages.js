const escaped = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));
const amount = (price) => `¥${price.toLocaleString("ja-JP")}`;

function shell(request, body, options = {}) {
  const { title = "touchCD｜作品の先行予約", description = "好きなアーティストの作品を、曲が聴けるミニCDキーホルダーに。", image = "/low-frequency.webp", unlisted = false, cta = "作品一覧", ctaUrl = "/#releases" } = options;
  const page = new URL(request.url);
  const values = {
    title: escaped(title), description: escaped(description), shareImage: escaped(new URL(image, page).href),
    url: escaped(page.origin + page.pathname), cta: escaped(cta), ctaUrl: escaped(ctaUrl),
    robots: unlisted ? '<meta name="robots" content="noindex,nofollow">' : "",
    body,
  };
  return siteAssets["/"].replace(/{{(\w+)}}/g, (_, key) => values[key]);
}

function commerceDisclosure(request, env) {
  const address = env.COMMERCE_ADDRESS?.trim() || "〒807-0806 福岡県北九州市八幡西区御開1丁目23−1 角のたばこ屋";
  const phone = env.COMMERCE_PHONE?.trim() || "070-4072-7527";
  const email = env.COMMERCE_EMAIL?.trim() || "cdman1106@gmail.com";
  const hours = env.COMMERCE_CONTACT_HOURS?.trim() || "9:00〜18:00";
  const returns = env.COMMERCE_RETURN_POLICY?.trim();
  const returnTerms = returns ? [["キャンセル・返品・不良品", returns]] : [
    ["お客様都合のキャンセル・返品", "お支払い完了後は、お客様のご都合によるキャンセル・返品・交換はお受けできません。"],
    ["返品・交換の対象", "当方が販売した商品に不備がある場合は、返品・交換の対象です。touchCD本体や提供する音源・サイトの不具合により音源を聴けない場合、当方からの発送時点ですでに破損していた場合、当方からお渡しした商品が受取時点で破損していた場合、注文と異なる商品をお渡しした場合が含まれます。"],
    ["返品・交換の対象外", [
      "・NFC非搭載のスマートフォンや、端末側のNFC設定によりサイトが開けない場合",
      "・お客様の通信環境や端末側の不具合が原因で、サイトを開けない、または音源を再生できない場合",
      "・受け取り後のお客様の取り扱いによる破損、紛失、改造、通常使用による摩耗",
      "・アーティストが販売者である取引で、当方が正常品を引き渡した後にアーティスト側の保管・販売過程で破損した場合。ご購入先にご連絡ください。",
    ].join("\n")],
    ["不備のご連絡と返送料", "商品に不備があった場合は、受け取り後、状況が分かり次第、注文情報と不備の内容を上記メールアドレスまでお知らせください。当方に原因がある不備で返送が必要な場合、返送料は当方が負担します。"],
  ];
  const rows = [
    ["販売事業者", "松尾 一慶（屋号 慶）"],
    ["事業所所在地", address],
    ["電話番号", phone],
    ["メールアドレス", email],
    ["問い合わせ対応時間", hours],
    ["販売価格", "作品ページに、商品1個あたりの税込価格を表示します。"],
    ["商品代金以外の費用", "会場受取は送料無料です。自宅配送が選べる作品は、送料と商品代金を合わせたお支払い予定額を予約画面に表示します。"],
    ["支払い方法", "クレジットカード決済（Stripe）のみご利用いただけます。"],
    ["無料予約のキャンセル", "決済案内の準備前は作品ページからメール認証で無料キャンセルできます。決済案内の準備後で未払いの場合はお問い合わせください。"],
    ["支払い時期", "無料予約時に代金はかかりません。作品ごとの予約目標に達した場合は、メールで決済リンクと支払期限をご案内します。期限までに商品代金を前払いしてください。"],
    ["申込期間・販売条件", "受付締切、予約上限、製造に必要な入金数は、各作品ページに記載します。"],
    ["商品の引渡時期・方法", "製造条件を満たした作品は、ご予約時に選んだ方法でお渡しします。各作品ページに会場受取の日時・場所や自宅配送の発送予定を表示します。"],
    ["製造不成立の場合", "支払期限までに製造に必要な入金数に達しなかった場合、お支払い済みの金額を送料を含めて全額返金します。対象のお客様にはメールでご案内します。"],
    ...returnTerms,
  ];
  const terms = rows.map(([label, value]) => `<div><dt>${escaped(label)}</dt><dd>${escaped(value)}</dd></div>`).join("");
  return shell(request, `<main class="section-shell commerce-page">
    <a class="crumb" href="/">トップページに戻る</a>
    <h1>特定商取引法に基づく表記</h1>
    <p class="commerce-intro">touchCDが販売する先行予約商品の取引条件です。</p>
    <dl class="commerce-details">${terms}</dl>
    <p class="commerce-contact">touchCDへのお問い合わせは <a href="https://www.instagram.com/touchcdyasann/" rel="noopener noreferrer">公式Instagram（@touchcdyasann）</a> へご連絡ください。</p>
  </main>`, { title: "特定商取引法に基づく表記｜touchCD", description: "touchCDの販売事業者、支払い、受け取り、返金に関するご案内。" });
}

function statusFor(data) {
  if (data.campaign.demo) return "サンプル";
  if (data.paid >= data.paidGoal) return "製造決定";
  if (Date.parse(data.paymentDeadline) <= Date.now()) return "支払期限終了";
  if (!data.unlimited && data.reserved >= data.capacity) return "予定数到達";
  if (data.accepting) return "予約受付中";
  if (data.reserved >= data.reservationGoal && data.paymentDeadline) return "支払い案内の対象";
  if (Date.parse(data.campaign.deadline) <= Date.now()) return "受付終了";
  return "受付前";
}

function productImage(campaign, className, eager = false) {
  if (!campaign.image) return '<div class="cover-placeholder"><span class="logo-disc" aria-hidden="true"></span>商品写真を準備中</div>';
  const src = campaign.image;
  return `<img class="${className}" src="${escaped(src)}" alt="${escaped(campaign.title)}のミニCDキーホルダー" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
}

function fanCanReserve(data) {
  return data.accepting && (data.unlimited || data.reserved < data.capacity);
}
function fanProgress(label, current, goal) {
  const n = Math.max(0, Number(current) || 0), target = Math.max(1, Number(goal) || 1);
  return `<div class="fan-card-progress"><div><span>${label}</span><strong>${n} / ${target}個</strong></div><progress value="${Math.min(n,target)}" max="${target}" aria-label="${label}の進捗"></progress></div>`;
}
function fanClosingLabel(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "締切未定";
  const remaining = t - Date.now();
  if (remaining <= 0) return "予約締切を経過";
  return remaining < 86400000 ? "締切まで24時間未満" : `締切まで約${Math.ceil(remaining / 86400000)}日`;
}
function card(data) {
  const { campaign, reserved, reservationGoal, paid, paidGoal } = data;
  const open = fanCanReserve(data), group = open ? "open" : paid >= paidGoal ? "funded" : "other";
  const deadline = Date.parse(campaign.deadline);
  return `<article class="release-card discover-card" data-release-card data-state="${group}" data-search="${escaped(campaign.artist + " " + campaign.title)}" data-deadline="${Number.isFinite(deadline) ? deadline : 8640000000000000}"><a href="${releasePath(campaign)}">
    <div class="release-art">${productImage(campaign, "release-img")}<span class="card-status ${open ? "is-open" : ""}">${escaped(data.status)}</span></div>
    <div class="release-detail"><div><p class="artist-tag">${escaped(campaign.artist)}</p><h3>${escaped(campaign.title)}</h3></div></div>
    <div class="fan-card-body">${fanProgress("無料予約",reserved,reservationGoal)}${fanProgress("入金済み",paid,paidGoal)}
      <div class="fan-card-date"><span>${open ? fanClosingLabel(campaign.deadline) : "受付状況は作品ページへ"}</span><small>${escaped(dateLabel(campaign.deadline) || "締切未定")}</small></div>
      <div class="fan-card-footer"><strong>${amount(campaign.price)}<small> 税込/個</small></strong><span>${open ? "無料予約へ" : "作品を見る"} ↗</span></div>
    </div></a></article>`;
}
function izumiPublicCard() {
  return `<article class="release-card discover-card izumi-public-card" data-release-card data-state="showcase" data-search="和田いづみ Izumi Wada A Jazz Date with Izumi ジャズ touchCD" data-deadline="8640000000000000"><a href="/works/izumi-wada"><div class="release-art"><img class="release-img" src="/touchcd-jazz-both.webp" alt="A Jazz Date with Izumiの実物" loading="lazy"><span class="card-status">作品紹介公開中</span></div><div class="release-detail"><div><p class="artist-tag">和田いづみ / JAZZ VOCAL</p><h3>A Jazz Date with Izumi</h3></div></div><div class="fan-card-body"><p class="izumi-public-card-lead">ジャズの余韻を、いつもそばに。</p><div class="izumi-public-card-profile"><img src="/izumi-wada-live.webp" alt="" loading="lazy"><span>アーティストの歩みと応援メッセージ、実物の写真を紹介。</span></div><div class="fan-card-footer"><small>予約受付の準備中</small><span>作品を見る ↗</span></div></div></a></article>`;
}

function fanDiscovery(rows, heading = "作品を探す", includeIzumi = false) {
  includeIzumi = includeIzumi && !rows.some(x => isIzumiCampaign(x.campaign));
  const total = rows.length + Number(includeIzumi);
  const open = rows.filter(fanCanReserve);
  const funded = rows.filter(x => !fanCanReserve(x) && x.paid >= x.paidGoal);
  const other = rows.filter(x => !fanCanReserve(x) && x.paid < x.paidGoal);
  return `<section id="releases" class="section-shell releases fan-silver fan-discovery" data-fan-discovery><p class="fan-discover-kicker">DISCOVER MUSIC GOODS</p><div class="section-head"><h2>${heading}</h2><span>予約受付中 <strong>${open.length}</strong>件 / 全${total}作品</span></div>
  ${total ? `<div class="fan-discover-tools"><label>アーティスト・作品名<input type="search" data-fan-search placeholder="作品名やアーティスト名で検索" maxlength="100"></label><label>並び替え<select data-fan-sort><option value="default">受付状況順</option><option value="deadline">締切が近い順（受付中を優先）</option></select></label></div><div class="fan-filter-row" role="group" aria-label="作品の受付状況"><button type="button" data-fan-filter="all" aria-pressed="true">すべて ${total}</button><button type="button" data-fan-filter="open" aria-pressed="false">予約受付中 ${open.length}</button><button type="button" data-fan-filter="funded" aria-pressed="false">受付終了・製造条件達成 ${funded.length}</button><button type="button" data-fan-filter="other" aria-pressed="false">その他 ${other.length}</button>${includeIzumi ? '<button type="button" data-fan-filter="showcase" aria-pressed="false">作品紹介 1</button>' : ""}</div><p data-fan-count class="fan-discover-count" role="status">${total}作品</p><div class="release-grid" data-fan-grid>${open.map(card).join("")}${includeIzumi ? izumiPublicCard() : ""}${[...funded,...other].map(card).join("")}</div><div class="fan-empty" data-fan-no-results hidden><div><h3>該当する作品がありません</h3><p>検索語や受付状況を変更してください。</p><button type="button" class="secondary" data-fan-reset>検索条件をリセット</button></div></div>` : `<div class="fan-empty"><span class="fan-record" aria-hidden="true"></span><div><h3>次の作品を準備中</h3><p>まだ公開中の予約企画はありません。新しい作品の公開をお楽しみに。</p><a class="fan-empty-link" href="https://www.instagram.com/touchcdyasann/" target="_blank" rel="noopener noreferrer">公式Instagramを見る ↗</a></div></div>`}
  ${total && !open.length ? '<p class="fan-list-note">現在予約受付中の作品はありません。</p>' : ""}
  <p class="fan-discover-note">無料予約は入金とは別です。条件達成後、予約者へ決済URLをメールでご案内します。</p></section>`;
}

function guide(steps = {}) {
  const { payment = "所定の予約数に届いた作品は、メールでお支払いをご案内します。", production = "必要な入金数に達したら製造します。作品ページで受取方法をご確認ください。", receive = "受け取る" } = steps;
  return `<section class="guide section-shell" id="guide"><div class="section-head"><h2>予約の流れ</h2></div>
  <ol class="steps">
    <li><span class="step-index" aria-hidden="true">01</span><div><h3>無料で予約</h3><p>作品を選び、希望個数とメールアドレスを登録します。</p></div></li>
    <li><span class="step-index" aria-hidden="true">02</span><div><h3>お支払い</h3><p>${payment}</p></div></li>
    <li><span class="step-index" aria-hidden="true">03</span><div><h3>${receive}</h3><p>${production}</p></div></li>
  </ol></section>`;
}

function home(request, data) {
  const releases = data.filter(({campaign}) => !campaign.demo);
  return shell(request, `<main class="fan-home">
  <section class="fan-hero shell">
    <div class="fan-copy"><p class="fan-kicker">MUSIC × NFC × GOODS</p><h1>音楽を、<br>手に取る。</h1><p class="fan-lead">好きなアーティストの音楽を、いつもそばに。</p><p>小さなCDケースに、大切な作品を。スマホをかざすと、アーティストの音楽や活動につながります。</p><div class="fan-hero-promises"><span><b>0円</b>で無料予約</span><span><b>成立後</b>に製造</span><span><b>未成立</b>なら全額返金*</span></div><small class="fan-hero-footnote">* お支払い済みの場合。送料を含みます。</small></div>
    <figure class="fan-hero-art"><img src="/touchcd-studio-removed.webp" alt="実際のtouchCDを元にした、ディスクを取り外したケースの広告用画像" width="1200" height="800" fetchpriority="high"><figcaption>制作参考イメージ（実物を元にAI加工）</figcaption></figure>
    <div class="fan-actions"><a class="primary" href="#releases">作品を探す ↘</a><a class="secondary" href="#about-touchcd">touchCDとは？ ↓</a><p>ファンの予約から、作品が形になります。</p></div>
  </section>
  ${fanDiscovery(releases, "作品を探す", true)}
  <section id="about-touchcd" class="section-shell fan-about"><p class="fan-kicker">WHAT IS touchCD?</p><h2>手に取る。かざす。楽しむ。</h2><p class="fan-sub">音楽と特別なコンテンツがつながる、ミニCDキーホルダーです。</p><div class="fan-how">
    <article><img src="/touchcd-jazz-front.webp" alt="実物の表面ジャケット" width="960" height="720" loading="lazy"><div><h3>手に取る</h3><p>好きなアーティストのジャケットを、グッズとして持ち歩く。</p></div></article>
    <article><div class="fan-symbol"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="13" y="5" width="22" height="38" rx="4"/><path d="M21 10h6M21 38h6M7 15a14 14 0 0 0 0 18M41 15a14 14 0 0 1 0 18"/></svg><span>NFC</span></div><div><h3>スマホをかざす</h3><p>NFC対応スマホで読み取り、専用サイトや指定のリンクを開く。</p></div></article>
    <article><div class="fan-symbol"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="18"/><path d="m20 15 13 9-13 9Z"/></svg><span>MUSIC / MOVIE / SNS</span></div><div><h3>音楽を楽しむ</h3><p>作品ごとの楽曲、映像、写真、メッセージを楽しむ。</p></div></article>
  </div><p class="fan-note">掲載内容は作品ごとに異なります。NFC対応端末と通信環境が必要です。</p></section>
  <section id="music-example" class="section-shell fan-music"><div><p class="fan-kicker">MUSIC SITE / 制作実例</p><h2>タッチした先にも、<br>アーティストの世界観を。</h2><p>実際に制作した ippuku Jazz Live &amp; Party の音楽サイト。レコード型プレーヤー、ライブ映像、出演アーティストの紹介などを掲載しています。</p><a class="primary" href="https://ippuku-event.cdman1106.workers.dev/?v=8" target="_blank" rel="noopener noreferrer">実際のサイトを体験する ↗</a><small>画面内を上下にスワイプできます。再生・表示ができない場合は直接開いてください。</small></div><div class="fan-device"><div class="fan-camera" aria-hidden="true"></div><iframe src="https://ippuku-event.cdman1106.workers.dev/?v=8" title="実際に制作した限定音楽サイト" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; encrypted-media; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div></section>
  <section id="guide" class="section-shell guide fan-silver reservation-explain"><p class="reservation-label">予約販売の仕組み</p><div class="section-head"><h2>ファンの「欲しい」から、<br>グッズが生まれる。</h2></div><p class="reservation-intro">欲しい作品を0円で予約。目標に達したら支払い案内が届き、必要な入金数が集まってから製造します。</p><ol class="reservation-explain-steps"><li><div class="reservation-step-mark"><span>01</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7h30v34H9zM17 16h14M17 24h14M17 32h8"/><path d="m28 33 4 4 7-8"/></svg></div><div><h3>一緒に企画・目標設定</h3><p>アーティストとtouchCDがデザイン・専用Webページ・販売価格・納期などを相談し、製造費とアーティストへの利益還元を考えて目標を決めます。</p></div></li><li><div class="reservation-step-mark"><span>02</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 14h34v8a5 5 0 0 0 0 10v2H7v-2a5 5 0 0 0 0-10zM30 14v5m0 5v5m0 5v1"/></svg></div><div><h3>ファンから無料予約を受付</h3><p>専用予約ページから0円で予約できます。SNSやライブで見つけた作品のグッズ化を応援。この段階ではまだ製造しません。</p></div></li><li><div class="reservation-step-mark"><span>03</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="12" width="38" height="26" rx="4"/><path d="M5 20h38M11 30h10"/></svg></div><div><h3>目標達成・購入のご案内</h3><p>無料予約の目標に達すると、メールで購入・支払いのご案内が届きます。無料予約と入金は別に数え、必要な入金数に達すると正式成立します。</p></div></li><li><div class="reservation-step-mark"><span>04</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m24 6 17 9v18l-17 9-17-9V15zM7 15l17 9 17-9M24 24v18M15 10l17 9"/></svg></div><div><h3>製造・お届け</h3><p>必要な入金を確認してから製造。選んだ方法で配送またはライブ会場でお渡しします。未成立の場合は製造せず、支払い済み代金を全額返金します。</p></div></li></ol><details class="fan-guide-fold"><summary>製造成立の具体例・詳しい条件を見る</summary><div class="fan-guide-body"><div class="reservation-minimum"><strong>最低製造個数は原則1デザイン25個。</strong><p>ただし、25個は製造する個数の基準であり、必ず25人の購入者が必要という意味でも、予約上限でもありません。販売価格・製造費・企画内容・アーティストの利益に応じて成立ラインを設定します。</p></div><div class="reservation-example"><p class="reservation-example-kicker">予約販売のシミュレーション / 基本例</p><h3>無料予約35件 → 入金25件 → 製造25個</h3><p class="reservation-example-intro">1件につき1個を予約・購入する場合。25件入金した場合の例です。</p><ol class="reservation-example-flow" aria-label="無料予約35件、入金案内、入金25件、製造25個"><li><span class="reservation-node-label">無料予約の目標</span><strong class="reservation-number">35<small>件</small></strong><span class="reservation-node-caption">達成したら案内へ</span></li><li><span class="reservation-node-label">購入・入金案内</span><svg class="reservation-mail" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="m7 14 17 14 17-14"/></svg><span class="reservation-node-caption">メールで支払いを案内</span></li><li><span class="reservation-node-label">必要な入金数</span><strong class="reservation-number">25<small>件</small></strong><span class="reservation-node-caption">正式成立の条件</span></li><li class="production-node"><span class="reservation-node-label">製造個数</span><strong class="reservation-number">25<small>個</small></strong><span class="reservation-node-caption">製造開始</span></li></ol><p class="reservation-outcome"><span aria-hidden="true">↓</span> ファンへお届け・アーティストへ利益還元</p><p class="reservation-example-note">※ 無料予約目標には、予約後に支払いを行わないファンがいる可能性も考慮します。予約や入金の上限を25個にするものではありません。</p></div><div class="reservation-example"><p class="reservation-example-kicker">予約販売のシミュレーション / 個別企画例</p><h3>無料予約15件 → 入金12件 → 製造25個</h3><p class="reservation-example-intro">12件分の購入代金で必要な製造費と利益を確保できる場合の例です。</p><ol class="reservation-example-flow" aria-label="無料予約15件、入金案内、入金12件、製造25個"><li><span class="reservation-node-label">無料予約の目標</span><strong class="reservation-number">15<small>件</small></strong><span class="reservation-node-caption">達成したら案内へ</span></li><li><span class="reservation-node-label">購入・入金案内</span><svg class="reservation-mail" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="m7 14 17 14 17-14"/></svg><span class="reservation-node-caption">メールで支払いを案内</span></li><li><span class="reservation-node-label">必要な入金数</span><strong class="reservation-number">12<small>件</small></strong><span class="reservation-node-caption">正式成立の条件</span></li><li class="production-node"><span class="reservation-node-label">製造個数</span><strong class="reservation-number">25<small>個</small></strong><span class="reservation-node-caption">製造開始</span></li></ol><p class="reservation-outcome"><span aria-hidden="true">↓</span> ファンへお届け・アーティストへ利益還元</p><div class="reservation-example-message"><strong>残り13個の取り扱いも事前に確認。</strong><p>製造費と必要な利益を確保できること、残り13個の費用負担・販売・保管などの取り扱いを事前に合意したうえで実施します。</p></div></div><p class="reservation-common-note">※ いずれも数量は一例です（1件につき1個の予約・入金を想定）。実際の成立ラインは企画ごとに設定します。</p><div class="reservation-benefits"><article class="reservation-benefit"><h3>ファンにとってのメリット</h3><ul><li>無料で予約できる</li><li>好きなアーティストの商品化を応援できる</li><li>企画限定のオリジナルグッズを購入できる</li><li>対応スマートフォンをかざして専用Webページを楽しめる</li><li>製造不成立の場合は支払い済み代金が返金される</li></ul></article><article class="reservation-benefit"><h3>アーティストにとってのメリット</h3><ul><li>商品の事前買取が不要（標準予約販売）</li><li>先行投資を抑えられる</li><li>売れ残りのリスクを抑えられる</li><li>ファンの需要を確認してから製造できる</li><li>利益を考慮した販売計画を立てられる</li><li>新曲・ライブに合わせた限定グッズを企画できる</li><li>専用Webページ制作もtouchCDに任せられる</li></ul></article></div></div></details><div class="reservation-refund"><strong>無料予約の時点では0円。</strong><p>必要な入金数に達しなかった場合は製造せず、お支払い済み代金を送料を含めて全額返金します。</p></div><a class="primary reservation-cta" href="#releases">作品を探して応援する ↗</a></section>
  
  <section id="product-examples" class="section-shell fan-gallery"><p class="fan-kicker">REAL PRODUCT</p><h2>実際に作ったtouchCD</h2><p class="fan-sub">透明なミニCDケース。取り外せるディスク。作品の世界観を細部まで。</p><div class="fan-real-grid"><figure><a href="/touchcd-jazz-front.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-front.webp" alt="実際に製作したtouchCDの表面・ジャケット" width="960" height="720" loading="lazy"></a><figcaption>表面・ジャケット</figcaption></figure><figure><a href="/touchcd-jazz-back.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-back.webp" alt="実際に製作したtouchCDのケース裏面" width="960" height="720" loading="lazy"></a><figcaption>ケース裏面</figcaption></figure><figure><a href="/touchcd-jazz-open.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-open.webp" alt="実際に製作したtouchCDの開いた状態" width="960" height="720" loading="lazy"></a><figcaption>開いた状態</figcaption></figure><figure><a href="/touchcd-jazz-both.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-both.webp" alt="実際に製作したtouchCDの表面と裏面" width="960" height="720" loading="lazy"></a><figcaption>表面と裏面</figcaption></figure></div><p class="fan-note">実物写真（トリミング・明るさ調整・QRコードぼかし済み）。ディスク表面、ケースの表面・裏面・内側・ディスク下の台紙をデザインできます。ディスク自体の裏面には印刷できません。</p></section>
  <section id="artist-consultation" class="section-shell fan-silver fan-artist"><div><p class="fan-kicker">FOR ARTISTS</p><h2>アーティストの方へ</h2><p>新曲・ライブ・周年記念を、ファンと一緒に形にしませんか？ 標準の予約販売なら制作費の前払い不要。専用音楽ページや利益試算、企画診断もご利用いただけます。</p></div><div class="fan-artist-actions"><a class="primary" href="/consultation">一緒にグッズを企画する ↗</a><a class="fan-text-link" href="/consultation#diagnosis">質問に答えて企画する ↗</a></div></section>
  <section id="questions" class="section-shell fan-faq"><h2>よくある質問</h2><details class="faq"><summary>touchCDとは何ですか？</summary><p>NFCを内蔵したミニCD型キーホルダーです。対応スマホをかざすと専用サイトや指定のURLが開きます。ミニディスク自体はCDプレーヤーで再生するものではありません。</p></details><details class="faq"><summary>予約時にお金はかかりますか？</summary><p>無料予約の時点では0円です。作品ごとの条件を満たした場合、認証済みメールアドレスへ支払い案内をお送りします。</p></details><details class="faq"><summary>製造が決まらなかったら？</summary><p>必要な入金数に達しない場合は製造せず、お支払い済みの方には送料を含む全額返金をご案内します。</p></details><details class="faq"><summary>どんなスマホで使えますか？</summary><p>NFC対応スマートフォンとインターネット通信が必要です。読み取り位置は機種により異なります。</p></details><details class="faq"><summary>A案の専用音楽サイトはいつまで使えますか？</summary><p>A案は最後のtouchCD販売日から5年間利用できる設計です。新作販売で期限が更新されます。新規販売・有料延長がなければ公開停止し、閲覧できなくなります。A案のNFC認証などの新機能は開発予定を含みます。各作品の正式な利用条件は予約前にご確認ください。</p></details><details class="faq"><summary>作品によって音楽サイトが違うのですか？</summary><p>A案は共通の更新型サイト、B案は作品ごとに独立した記念サイト、C案はその両方を組み合わせる設計、D案は既存の公式HP・SNS・音楽配信先に直接つなぐ方式です。作品・ライブ記念版では該当作品の内容を楽しめる予定です。正式な閲覧範囲・期間は各作品の予約前に確認してください。<a href="/consultation#plans">4つのプランの説明</a></p></details><details class="faq"><summary>すべての作品に限定音源やライブ映像がありますか？</summary><p>掲載内容は作品ごとに異なります。楽曲・映像・写真などの内容は各作品ページで確認してください。</p></details><details class="faq"><summary>受け取り方法・送料は？</summary><p>作品によって会場受取や自宅配送を選べます。送料・受取時期は各作品ページをご確認ください。</p></details><details class="faq"><summary>支払い方法・無料予約のキャンセルは？</summary><p>クレジットカード決済のみです。決済案内の準備前は作品ページからメール認証で無料予約をキャンセルできます。</p></details><details class="faq"><summary>支払い後のキャンセル・返品は？</summary><p>お客様都合のキャンセル・返品はお受けできません。不備がある場合などは特定商取引法に基づく表記をご確認ください。</p></details><p class="fan-note"><a href="/tokushoho">特定商取引法に基づく表記</a> ・ <a href="https://www.instagram.com/touchcdyasann/" target="_blank" rel="noopener noreferrer">公式Instagram</a></p></section>
  </main>`, {image:"/touchcd-studio-removed.webp",description:"好きなアーティストの音楽を、いつもそばに。スマホをかざすと専用音楽サイトが開くミニCDキーホルダーの先行予約サイト。"});
}

function artistPage(request, rows) {
  const artist = rows[0].campaign.artist;
  return shell(request, `<main class="artist-page fan-artist-directory"><div class="section-shell"><a class="crumb" href="/#releases">← すべての作品</a><div class="artist-heading"><span class="logo-disc" aria-hidden="true"></span><div><p class="fan-kicker">ARTIST / 作品一覧</p><h1>${escaped(artist)}</h1><p class="artist-directory-note">このアーティストのtouchCDを探す</p></div></div></div>${fanDiscovery(rows.filter(x=>!x.campaign.demo),"このアーティストの作品")}</main>`,
  { title: `${artist}｜touchCD`, description: `${artist}のtouchCD作品一覧`, image: rows[0].campaign.image || "/low-frequency.webp" });
}

const tokyoDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long", timeStyle: "short" });
const dateLabel = (value) => Number.isFinite(Date.parse(value)) ? tokyoDate.format(new Date(value)) : "";

function projectPage(request, data) {
  const { campaign, reserved, paid, reservationGoal, paidGoal, capacity, accepting, paymentDeadline } = data;
  const canReserve = accepting && reserved < capacity;
  const shipping = campaign.shippingFee !== null;
  const audioDate = dateLabel(campaign.audioAt);
  const music = campaign.music && allowedUrl(campaign.music) ? `<a class="secondary" href="${escaped(campaign.music)}" target="_blank" rel="noopener noreferrer">${audioDate ? "音源を聴く" : "楽曲を聴く"}</a>` : "";
  const contact = campaign.contact && allowedUrl(campaign.contact, true) ? `<a class="text-link" href="${escaped(campaign.contact)}">この作品について問い合わせる</a>` : "";
  const artistText = escaped(campaign.artist);
  const artistLink = campaign.visibility === "listed"
    ? `<a class="artist-link" href="/artists/${campaign.artistSlug}">${artistText}</a>`
    : `<span class="artist-link">${artistText}</span>`;
  const pickupDetail = escaped(campaign.pickup || "作品のお知らせでご案内します。");
  const stage = (label, count, goal, kind, note) => `<div class="reservation-stage">
    <div class="count-label"><span id="${kind}-label">${label}</span><span><strong id="${kind}-count">${count}</strong> / <span id="${kind}-target">${goal}</span>個</span></div>
    <progress id="${kind}-progress" aria-labelledby="${kind}-label" value="${Math.min(count, goal)}" max="${goal}"></progress>
    <p class="progress-note" id="${kind}-note">${note}</p>
  </div>`;
  const reservationNote = reserved >= reservationGoal ? "支払い案内の条件を達成しました。" : `あと${reservationGoal - reserved}個で支払い案内へ。`;
  const productionNote = paid >= paidGoal ? "製造条件を達成しました。" : `あと${paidGoal - paid}個分のお支払いで製造決定。`;
  return shell(request, `<main class="shell project-page" data-project="${escaped(campaign.slug)}" data-artist="${escaped(campaign.artistSlug)}">
  <a class="crumb" href="/#releases">作品一覧に戻る</a>
  <div class="project-heading">
    <div><p class="eyebrow">${campaign.demo ? "操作確認用のサンプル" : "touchCD 先行予約"}</p>
    <h1>${escaped(campaign.title)}</h1>${artistLink}
    ${campaign.eventInfo ? `<p class="event-info">${escaped(campaign.eventInfo)}</p>` : ""}</div>
    <div class="share-project"><button type="button" class="secondary" id="share-project">この作品をシェア</button><p id="share-result" role="status"></p></div>
  </div>
  <div class="project-layout">
    <figure class="product-image">${productImage(campaign, "project-image", true)}${campaign.demo ? '<figcaption>商品イメージ</figcaption>' : ""}</figure>
    <aside class="reservation-card" id="reserve" aria-label="予約状況">
      <div class="booking-top"><span class="pill" id="campaign-status">${data.status}</span><span>受付上限 ${capacity}個</span></div>
      <h2>先行予約</h2><p class="project-free-now"><strong>今のお支払い 0円</strong><span>条件達成後に購入案内</span></p><p class="price"><strong>${amount(campaign.price)}</strong><span>税込 / 1個</span></p>
      <div class="reservation-stages" aria-label="予約と入金の進捗"><p class="project-stage-intro">商品化までの2つの目標</p>
        ${stage("無料予約", reserved, reservationGoal, "reservation", reservationNote)}
        ${stage("入金済み", paid, paidGoal, "payment", productionNote)}
      </div>
      <dl class="details">
        <div><dt>予約締切</dt><dd>${escaped(dateLabel(campaign.deadline) || (campaign.demo ? "サンプル企画" : "未定"))}</dd></div>
        ${paymentDeadline ? `<div><dt>支払期限</dt><dd>${escaped(dateLabel(paymentDeadline))}</dd></div>` : ""}
        <div><dt>受取方法</dt><dd>会場受取${shipping ? ` / 自宅配送（送料 ${amount(campaign.shippingFee)} / 注文）` : ""}</dd></div>
      </dl>
      <button class="primary" type="button" id="open-reserve" disabled>無料で予約する</button>
      <p class="button-note" id="booking-note" role="status">${canReserve ? "予約時のお支払いは0円です。" : reserved >= capacity ? "予定数に達しました。" : "現在、予約を受け付けていません。"}</p>
      <p class="refund-note">製造不成立の場合は、お支払い済みの代金を送料を含めて全額返金します。</p><p class="project-share-hint">好きな作品をシェアして、商品化を応援できます。</p>
    </aside>
    <div class="project-main">
      <nav class="project-navigation" aria-label="作品ページ内"><a href="#about-release">作品紹介</a><a href="#fan-product-info">商品について</a>${campaign.releaseUpdate ? '<a href="#release-news">お知らせ</a>' : ""}<a href="#delivery">受取方法</a><a href="#audio">音楽・リンク</a><a href="#questions">FAQ</a></nav>
      <section class="story" id="about-release"><h2>作品について</h2><p>${escaped(campaign.story || "作品紹介を準備中です。")}</p></section>
      ${campaign.releaseUpdate ? `<section class="release-section" id="release-news"><h2>この作品のお知らせ</h2><p>${escaped(campaign.releaseUpdate)}</p></section>` : ""}
      <section class="release-section" id="fan-product-info"><h2>お届けするtouchCD</h2><div class="project-product-points"><article><span aria-hidden="true">◎</span><b>ミニCD型キーホルダー</b><p>ジャケットをグッズとして持ち歩けます。</p></article><article><span aria-hidden="true">NFC</span><b>スマホをかざす</b><p>対応端末でリンクを読み取ります。</p></article><article><span aria-hidden="true">♪</span><b>作品の世界へ</b><p>専用音楽サイトまたは指定URLが開きます。</p></article></div><p class="fan-project-small">掲載内容は企画により異なります。ディスクは通常のCDプレーヤーでは再生できません。</p><a class="text-link" href="/#music-example">音楽サイトの制作例を見る ↗</a></section><section class="release-section" id="delivery">
        <h2>受け取り方法</h2>
        <div class="delivery-options">
          <div><h3>会場受取</h3><p>${pickupDetail}</p><p>当日はtouchCDから届いた支払い完了メールの画面を会場スタッフにご提示ください。</p></div>
          ${shipping ? `<div><h3>自宅配送</h3><p>${escaped(campaign.shippingNote)}</p><p>送料 ${amount(campaign.shippingFee)}（税込・1注文）</p></div>` : ""}
        </div>
      </section>
      <section class="release-section" id="audio">
        <h2>かざして、音楽を聴く</h2>
        <p>受け取ったtouchCDに対応スマホをかざすと、作品に設定された専用サイトや外部リンクが開きます。公開内容は作品ごとに異なります。</p>
        ${audioDate ? `<p class="audio-date"><strong>${music ? "音源公開" : "音源公開予定"}</strong> ${escaped(audioDate)}</p>` : ""}
        ${music}
      </section>
    </div>
  </div>
  ${guide({
    payment: `予約が${reservationGoal}個集まったら、メールでお支払いをご案内します。`,
    production: `${paidGoal}個分のお支払いを確認したら製造します。完成後は${shipping ? "選んだ方法でお受け取りいただけます。" : "会場でお渡しします。"}`,
    receive: shipping ? "受け取る" : "会場で受け取る",
  })}
  <section class="project-support-callout"><div><h2>この作品を広める</h2><p>友達やファン仲間に作品ページを届けることも、商品化の応援になります。</p></div><a class="secondary" href="#share-project">共有ボタンへ ↑</a></section><section id="questions" class="question-section">
    <h2>よくある質問</h2>
    <details class="faq"><summary>無料予約をするとすぐに支払いが発生しますか？</summary><p>予約時は0円です。必要な無料予約数に達したら、認証済みのメールアドレスにお支払いを案内します。</p></details>
    <details class="faq"><summary>製造が決まらなかったら？</summary><p>お支払い前に終了した場合、料金はかかりません。お支払い済みの方には全額返金をご案内します。</p></details>
    <details class="faq"><summary>会場では何を提示すればいいですか？</summary><p>touchCDから届いた支払い完了メールの画面を会場スタッフにご提示ください。番号を覚える必要はありません。</p></details>
    <details class="faq"><summary>スマホのどこにかざしますか？</summary><p>NFCに対応したスマホの背面にかざしてください。読み取る位置は機種によって異なります。反応しづらいときは、ケースを外してもう一度お試しください。</p></details>
    <details class="faq"><summary>キャンセル・返品について</summary><p>決済案内の準備前は無料予約をキャンセルできます。準備後で未払いの場合はお問い合わせください。お支払い方法はクレジットカードのみです。お支払い後のお客様都合によるキャンセル・返品はお受けできません。商品に不備があった場合の対応は、<a class="text-link" href="/tokushoho">特定商取引法に基づく表記</a>をご確認ください。</p></details>
    ${contact}
  </section>
  <div class="mobile-booking" id="mobile-booking" hidden><span>${amount(campaign.price)} <small>税込 / 1個</small></span><button type="button" class="primary" id="mobile-reserve" disabled>無料で予約</button></div>
  </main>${siteAssets.booking}`, {
    title: `${campaign.title}｜${campaign.artist}｜touchCD`, description: campaign.story.slice(0, 120),
    image: campaign.image || "/low-frequency.webp", unlisted: campaign.visibility === "unlisted",
    cta: "予約内容を見る", ctaUrl: "#reserve",
  });
}

function notFound(request) {
  return shell(request, '<main class="section-shell not-found"><h1>作品が見つかりません</h1><a class="secondary" href="/#releases">作品一覧に戻る →</a></main>', { unlisted: true });
}


function pickupExample(request) {
  const message = receiptText({ ...sampleCampaigns[0], pickup: "ライブ当日 18:00〜20:00 / 会場受付（サンプル）" }, 1, "72D4963A");
  return shell(request, `<main class="shell pickup-example">
    <a class="crumb" href="/artists/yonagi/nami-no-atode">← サンプル企画</a>
    <h1>支払い完了メールの見本</h1>
    <section class="reservation-card" aria-label="サンプルメール">
      <p class="eyebrow">touchCD 会場受取</p>
      <h2>お支払い完了・会場受取のご案内</h2>
      <p class="receipt-example-body">${escaped(message)}</p>
    </section>
  </main>`, { title: "支払い完了メールの見本｜touchCD", unlisted: true });
}

function izumiWadaPreview(request, data = null) {
  const instagram = "https://www.instagram.com/singer_izumiwada/";
  const photos = [
    ["/touchcd-jazz-front.webp","表面・ジャケット","赤と黒のジャケットを収めた透明なミニCDケース"],
    ["/touchcd-jazz-back.webp","裏面・レコードデザイン","赤いレコードをモチーフにしたケースの裏面"],
    ["/touchcd-jazz-both.webp","表と裏のデザイン","表面と裏面のデザインを並べた写真"]
  ];
  const goal = data?.paidGoal ?? 25, reserveGoal = data?.reservationGoal ?? 35;
  const reserved = data?.reserved ?? 0, paid = data?.paid ?? 0;
  const price = data?.campaign.price ?? 3000;
  const reservationDeadline = data?.campaign.deadline || "2027-01-03T23:59:00+09:00";
  const paymentDeadline = data?.paymentDeadline || "2027-01-06T23:59:00+09:00";
  const deadlineText = dateLabel(reservationDeadline);
  const paymentText = dateLabel(paymentDeadline);
  const liveMap = "https://maps.app.goo.gl/fk9Xe1W17gVkM38V8?g_st=il";
  const stage = (label, count, target, kind, note) => `<div class="reservation-stage"><div class="count-label"><span id="${kind}-label">${label}</span><span><strong id="${kind}-count">${count}</strong> / <span id="${kind}-target">${target}</span>個</span></div><progress id="${kind}-progress" aria-labelledby="${kind}-label" value="${Math.min(count,target)}" max="${target}"></progress><p class="progress-note" id="${kind}-note">${note}</p></div>`;
  const booking = `<div class="izumi-reservation-panel"><div class="izumi-booking-header"><span class="pill" id="campaign-status">${escaped(data?.status || "受付準備中")}</span><span>受付上限なし</span></div><h3>無料予約で応援する</h3><div class="izumi-reservation-price"><strong>${amount(price)}<small> 税込／個</small></strong><span>今のお支払い 0円</span></div><div class="izumi-deadline-banner"><small>無料予約締切（日本時間）</small><strong>${escaped(deadlineText)}</strong></div>${data ? stage("無料予約",reserved,reserveGoal,"reservation",reserved>=reserveGoal?"支払い案内の条件を達成しました。":`あと${reserveGoal-reserved}個で支払い案内へ。`)+stage("入金済み",paid,goal,"payment",paid>=goal?"製造条件を達成しました。":`あと${goal-paid}個分のお支払いで製造決定。`) : '<p>予約受付の準備中です。製造には25個分の入金が必要です。</p>'}<p>無料予約が${reserveGoal}個に達したら、予約者にまとめてメールで決済URLをご案内します。入金が${goal}個分以上集まれば製造成立です。企画全体の販売上限はありません。</p><p class="izumi-schedule-note">支払い期限：${escaped(paymentText)}（日本時間）。決済案内は予約者へメールで送ります。お支払いはクレジットカードのみです。</p><div class="izumi-receive-grid"><div><b>ライブ会場受取</b><span>送料無料</span><small>${escaped(data?.campaign.pickup || "2027年2月24日（水）Music Bar Bridge（福岡市中央区浄水通5-10 ケインズ浄水B1F）。19:30開演。商品の受取時間・場所の詳細は予約者へご案内します。")}</small><a class="izumi-event-map" href="${liveMap}" target="_blank" rel="noopener noreferrer">会場の地図を見る ↗</a><small>ライブの入場料・飲食代は商品代金に含まれません。</small></div><div><b>自宅配送</b><span>送料500円／注文</span><small>無料予約時に郵便番号・配送先住所を入力</small></div></div><p class="izumi-checkout-note">製造不成立の場合、お支払い済みの商品代金・送料は全額返金します。<a href="/tokushoho">取引条件・お問い合わせ先</a></p><button type="button" class="izumi-main-button izumi-purchase-button" id="open-reserve" disabled>無料で予約する</button><p id="booking-note" role="status">${data?.accepting ? "予約時のお支払いは0円です。" : "現在、予約受付を準備中または停止中です。"}</p><button type="button" class="izumi-outline" data-cancel-reservation>無料予約をキャンセルする</button><button type="button" class="izumi-outline" id="share-project">この作品をシェア</button><p id="share-result" role="status"></p></div>`;
  return shell(request, `<main class="izumi-page section-shell" ${data ? `data-project="${escaped(data.campaign.slug)}" data-artist="${escaped(data.campaign.artistSlug)}"` : ""}>
    <a class="crumb" href="/#releases">← touchCD 作品一覧</a>
    <p class="izumi-preview-notice">無料予約から商品化へ｜お支払いは予約目標達成後にメールでご案内します。</p>
    <section class="izumi-hero">
      <figure class="izumi-hero-photo"><img src="/touchcd-jazz-both.webp" alt="A Jazz Date with Izumiの表面と裏面の実物写真" fetchpriority="high"><figcaption>実際に制作したtouchCD</figcaption></figure>
      <div class="izumi-hero-copy"><p class="izumi-overline">IZUMI WADA / JAZZ VOCAL</p><h1>A Jazz Date<br>with Izumi</h1><p class="izumi-artist-name">和田いづみ × touchCD</p><h2>ジャズの余韻を、<br>いつもそばに。</h2><p>心に残る歌声。赤と黒のアートワーク。音楽との出会いを、手のひらに収まる小さな作品に。</p><div class="izumi-tags"><span>ミニCD型キーホルダー</span><span>NFC搭載</span><span>作品へのリンク</span></div><div class="izumi-price"><small>販売価格</small><strong>${amount(price)}<span> 税込／個</span></strong><p>無料予約・製造成立25個以上・上限なし</p><p class="izumi-hero-deadline">予約締切：${escaped(deadlineText)}<br>会場受取：2027年2月24日（水）</p></div><a class="izumi-main-button izumi-purchase-button" href="#izumi-order">無料予約・受取方法を見る ↓</a><a class="izumi-outline" href="${instagram}" target="_blank" rel="noopener noreferrer">和田いづみさんのInstagram ↗</a></div>
    </section>
    <nav class="izumi-nav" aria-label="作品紹介ページ内"><a href="#izumi-story">2つのストーリー</a><a href="#izumi-product">商品写真</a><a href="#izumi-live">ライブ・受取会場</a><a href="#izumi-experience">タッチ体験</a><a href="/works/izumi-wada/artist">アーティスト紹介 ↗</a><a href="/works/izumi-wada/making">制作ストーリー ↗</a><a href="#izumi-faq">FAQ</a></nav>
    <section id="izumi-story" class="izumi-reading-links"><p class="izumi-overline">TWO STORIES</p><h2>この作品を、もっと深く知る。</h2><p>和田いづみさんの音楽の歩みと、touchCDのものづくり。二つの読み物を、それぞれ独立したページにまとめました。</p><div class="izumi-editorial-grid"><article class="izumi-editorial-card artist-editorial-card"><p class="izumi-overline">01 / ARTIST STORY</p><h3>これからも、<br>あなたのそばに音楽を。</h3><p>ジャズとの出会いから現在の活動、そして皆さんへの応援のお願い。和田いづみさんから皆さんへのメッセージをお届けします。</p><a class="izumi-outline" href="/works/izumi-wada/artist">アーティストのメッセージを読む ↗</a></article><article class="izumi-editorial-card making-editorial-card"><p class="izumi-overline">02 / BEHIND THE DESIGN</p><h3>ジャズの余韻を、<br>手のひらに。</h3><p>なぜ音楽をミニCDの形にするのか。赤と黒のデザイン、開閉するケース、タッチで音楽へつながる仕組み。制作側から伝えたいこと。</p><a class="izumi-outline" href="/works/izumi-wada/making">touchCDの制作ストーリーを読む ↗</a></article></div></section>
    <section id="izumi-product"><p class="izumi-overline">THE OBJECT</p><h2>小さなケースに、<br>作品の世界観を。</h2><div class="izumi-gallery">${photos.map(([src, label, alt]) => `<figure><img src="${src}" alt="${alt}" loading="lazy"><figcaption>${label}</figcaption></figure>`).join("")}</div><div class="izumi-value-grid"><article><span>01</span><h3>飾る・持ち歩く</h3><p>赤と黒のアートワークを、バッグや鍵につけて楽しむ。</p></article><article><span>02</span><h3>開いて楽しむ</h3><p>開閉する透明ケースと取り外せるミニディスク。小さな音楽グッズならではの楽しさ。</p></article><article><span>03</span><h3>音楽につながる</h3><p>対応スマホをかざして、作品へのリンクを読み取る。</p></article></div><p class="izumi-note">実物写真。ミニディスクは通常のCDプレーヤーで再生するものではありません。</p></section>
    <section id="izumi-experience" class="izumi-experience"><div><p class="izumi-overline">AFTER TOUCH</p><h2>かざした先に、<br>作品との続きがある。</h2><p>touchCDはNFC対応スマートフォンでリンクを読み取る音楽グッズ。アプリの追加インストールなしで、設定されたWebページを開く仕組みです。</p><p>この作品のリンク先は、購入者向けの内容として一般の商品紹介ページには掲載していません。公開範囲・収録内容・利用条件は販売時にご案内します。</p><small>購入者向けページの画面イメージです。</small></div><div class="izumi-touch-visual" role="img" aria-label="touchCDにスマホをかざして購入者向けの作品ページにつながる仕組みのイメージ"><figure><img src="/touchcd-jazz-front.webp" alt="" loading="lazy"><figcaption>touchCD</figcaption></figure><span class="izumi-touch-arrow" aria-hidden="true">→</span><div class="izumi-mock-phone" aria-hidden="true"><div class="izumi-phone-notch"></div><small>IZUMI WADA</small><div class="izumi-phone-art"><span>A Jazz Date<br>with Izumi</span><div class="izumi-record"></div></div><b>作品のページへ</b><span class="izumi-lock">購入者向けコンテンツ</span><small>画面イメージ</small></div></div></section>
    
    <section id="izumi-live" class="izumi-live-event"><p class="izumi-overline">LIVE / 会場受取のご案内</p><div class="izumi-event-grid"><figure class="izumi-live-flyer"><img src="/izumi-jazz-live-flyer.webp" alt="Jazz Live 公式フライヤー。2027年2月24日（水）19時30分開演、和田いづみ・石川雄一、Music Bar Bridge、ミュージックチャージ3,000円＋2オーダー。" width="440" height="613" loading="lazy" decoding="async"></figure><div class="izumi-event-details"><h2>和田いづみ × 石川雄一</h2><p>Vocal / Guitar</p><p class="izumi-event-datetime">2027年2月24日（水）19:30 開演</p><h3>Music Bar Bridge</h3><p>福岡市中央区浄水通5-10 ケインズ浄水B1F</p><p class="izumi-event-charge">Music Charge 3,000円＋2オーダー</p><p>ライブに関するお問い合わせ：<a href="tel:08091001201">080-9100-1201</a></p><a class="izumi-outline" href="${liveMap}" target="_blank" rel="noopener noreferrer">Googleマップで会場を見る ↗</a><a class="izumi-outline" href="https://bridge-josui.com/" target="_blank" rel="noopener noreferrer">会場公式サイト ↗</a></div></div><div class="izumi-event-pickup"><h3>このライブでtouchCDをお受け取りいただけます</h3><p>会場受取を選んだ方は、商品代金3,000円／個のみ（送料不要）。ライブのミュージックチャージ・飲食代・入場予約は別です。商品の受取時間・場所の詳細は予約者にメールでご案内します。当日はtouchCDから届いた支払い完了メールの画面を会場スタッフにご提示ください。来場できない方は自宅配送（送料500円／注文）も選べます。</p><a class="izumi-main-button" href="#izumi-order">無料予約・受取方法を選ぶ ↓</a></div></section>
    <section class="izumi-order" id="izumi-order"><p class="izumi-overline">COLLECT / SUPPORT</p><h2>お気に入りのジャズを、手元に。</h2><p>アートワークを手に取り、音楽とのつながりを楽しむ。ご自身のコレクションにも、ジャズが好きな方への贈り物にも。</p>${booking}<a class="izumi-outline" href="${instagram}" target="_blank" rel="noopener noreferrer">アーティストの活動を見る ↗</a></section>
    <section id="izumi-faq" class="izumi-faq"><h2>よくある質問</h2><details class="faq"><summary>音楽はどうやって聴くの？</summary><p>NFC対応スマートフォンをかざし、読み取ったリンクを開きます。接続先の詳細は販売時にご案内します。</p></details><details class="faq"><summary>本物のCDとして再生できますか？</summary><p>いいえ。ミニディスクは観賞用のグッズです。</p></details><details class="faq"><summary>いつ支払うのですか？</summary><p>無料予約の目標（${reserveGoal}個）を達成後、予約時のメールアドレスへ決済URLをまとめてご案内します。製造には${goal}個分以上の入金が必要です。</p></details><details class="faq"><summary>支払い方法は？</summary><p>クレジットカード決済のみです。</p></details><details class="faq"><summary>無料予約はキャンセルできますか？</summary><p>決済案内の準備前は、予約時のメールアドレスで認証して無料キャンセルできます。準備後で未払いの場合はお問い合わせください。</p></details><details class="faq"><summary>ライブ会場ではいつ受け取れますか？</summary><p>2027年2月24日（水）、Music Bar Bridgeのライブ当日です。19:30開演。商品受取の詳しい時間・場所はメールでお知らせします。当日は支払い完了メールの画面を会場スタッフにご提示ください。番号を覚える必要はありません。ライブの入場料・飲食代は商品代金とは別です。</p><a class="text-link" href="${liveMap}" target="_blank" rel="noopener noreferrer">会場の地図を見る ↗</a></details><details class="faq"><summary>配送先の住所はいつ入力しますか？</summary><p>自宅配送を選んだ方は、無料予約時に郵便番号と配送先住所をご入力ください。ライブ会場受取の場合は住所入力不要です。</p></details><details class="faq"><summary>何個まで販売しますか？</summary><p>企画全体の販売上限は設けません。25個分以上の入金で製造します。無料予約締切は${escaped(deadlineText)}です。ライブ会場受取日は2027年2月24日（水）です。</p></details><details class="faq"><summary>対応するスマートフォンは？</summary><p>NFCに対応した端末と通信環境が必要です。読み取り位置やリンクの開き方は機種によって異なります。</p></details></section>
    <div class="mobile-booking" id="mobile-booking" hidden><span>${amount(price)} <small>税込／個</small></span><button type="button" class="primary" id="mobile-reserve" disabled>無料で予約</button></div></main>${data ? siteAssets.booking : ""}`, { title:"A Jazz Date with Izumi｜和田いづみ × touchCD",description:"ジャズの余韻をいつもそばに。和田いづみさんのtouchCD作品紹介。",image:"/touchcd-jazz-front.webp",unlisted:false,cta:"無料予約",ctaUrl:"#izumi-order" });
}

function izumiStoryPage(request, kind) {
  const root="/works/izumi-wada";
  const instagram="https://www.instagram.com/singer_izumiwada/";
  const source="https://bridge-josui.com/event/k_9wzq8s9_3";
  const artist=kind==="artist";
  const title=artist?"和田いづみ — 音楽の歩み":"A Jazz Date with Izumi — touchCD制作ストーリー";
  const headline=artist?"これからも、<br>あなたのそばに<br>音楽を。":"音楽の余韻を、<br>手のひらに。";
  const lead=artist?"カフェでジャズに出会った日から、海を越えた録音、九州各地のステージへ。これからも歌を届けていくために、私の音楽の歩みと、皆さんへのお願いをお伝えします。":"ライブの時間が終わっても、音楽と出会った記憶は残る。そんな記憶を日常に持ち帰るための、小さな音楽グッズについて。";
  const chapters=artist?[
  {
    "no": "01",
    "label": "2002 / THE BEGINNING",
    "h": "私の音楽は、一つの生演奏との出会いから始まりました。",
    "body": [
      "はじめまして。ジャズボーカリストの和田いづみです。いつもライブに足を運んでくださる皆さん、そして、このページで初めて私を知ってくださった皆さんへ。私がどんなふうに音楽と出会い、今日まで歌ってきたのか、少しお話しさせてください。",
      "2002年、私はカフェでバーテンダーとして働いていました。そこでジャズピアニストの森山輝生さんの生演奏に出会ったことをきっかけに、ジャズボーカルに夢中になりました。",
      "音楽を聴くために特別な場所へ行かなくても、日常の中で思いがけず音楽に出会うことがあります。私自身も、そんな出会いから歌の世界に足を踏み入れた一人です。"
    ],
    "refs": [
      [
        "Music Bar Bridge・公演プロフィール",
        "https://bridge-josui.com/event/k_9wzq8s9_3"
      ]
    ]
  },
  {
    "no": "02",
    "label": "2004 / NEW YORK",
    "h": "海を越えて出会った、かけがえのない音楽仲間",
    "body": [
      "2004年、ニューヨークへ渡った私は、ギタリストの森山修さんと出会いました。一緒に曲を作り、オリジナル曲やジャズのスタンダードを録音しました。その音源はインディーズ音楽の紹介サイトや有線放送でも取り上げていただきました。",
      "音楽を通して出会う人たちと、演奏を重ねること。そして、その音楽がまだお会いしたことのない方にも届いていくこと。歌うことは、一人だけでは完結しないものです。",
      "ニューヨークで出会った森山さんとは、年月を経ても音楽を通してつながっています。これまで一緒に演奏してくださった方々とのご縁を、これからも大切にしていきたいです。"
    ],
    "refs": [
      [
        "Music Bar Bridge・公演プロフィール",
        "https://bridge-josui.com/event/k_9wzq8s9_3"
      ],
      [
        "本人ブログ・2022年8月の演奏予定",
        "https://ameblo.jp/izumiwada/entry-12756795302.html"
      ]
    ]
  },
  {
    "no": "03",
    "label": "2008–2009 / SWEDEN",
    "h": "北欧で録音した、私の最初のアルバム",
    "body": [
      "2008年にはスウェーデンへ。ベーシストの森泰人さん、Simon Westmanさん、Johan Borgströmさん、Sebastiaan Kapteinさんと録音に臨みました。ホールの舞台で演奏者が輪になり、一緒に音を重ねた録音です。",
      "その音源をまとめた『Just The Two Of Us』を2009年に発表し、2010年には全国流通となりました。海を越えて出会った演奏家たちと作った、私の最初のアルバムです。",
      "歌だけでなく、一緒に演奏する楽器の音にも耳を傾けていただけたら嬉しいです。ジャズの演奏には、音が重なり合う、その瞬間ならではの楽しさがあります。"
    ],
    "refs": [
      [
        "後藤誠のJAZZ研究室・2009年5月のアルバム評",
        "https://rifftide.exblog.jp/8246153/"
      ],
      [
        "森泰人公式サイト・ディスコグラフィー",
        "https://morimusic.net/"
      ],
      [
        "ORICON NEWS・アルバム情報",
        "https://www.oricon.co.jp/prof/508163/products/867317/1/"
      ]
    ]
  },
  {
    "no": "04",
    "label": "2009–2010 / DISCOGRAPHY",
    "h": "ジャズを知らない方にも、音楽を楽しんでほしい",
    "body": [
      "『Just The Two Of Us』には、ジャズのスタンダードだけでなく、ボサノヴァやポップスの曲も収録しています。エルトン・ジョンの「Your Song」、スティーヴィー・ワンダーの楽曲、森山修さんとの共作「Misty Rain」など、さまざまな曲を歌っています。",
      "ジャズに詳しくなくても、難しく考えずに聴いていただけたらと思います。知っている一曲から、まだ知らない一曲へ。好きな音楽に出会う入口は、いくつあってもいいと思います。",
      "このアルバムをきっかけに初めて私の歌を聴いてくださる方がいたら、ぜひご自身の好きな曲を見つけてみてください。"
    ],
    "tracks": [
      "Your Song",
      "Black Coffee",
      "Part-Time Lover",
      "Dindi",
      "Golden Lady",
      "Misty Rain",
      "Just The Two Of Us",
      "Moonglow"
    ],
    "refs": [
      [
        "ORICON NEWS・収録曲と発売情報",
        "https://www.oricon.co.jp/prof/508163/products/867317/1/"
      ],
      [
        "後藤誠のJAZZ研究室・選曲と歌唱への評価",
        "https://rifftide.exblog.jp/8246153/"
      ]
    ]
  },
  {
    "no": "05",
    "label": "2010 / POP MUSIC",
    "h": "一つのジャンルにとどまらず、歌を届ける",
    "body": [
      "2010年には、中村寛さんが手がけるポップユニット「天国」にボーカルとして参加しました。四季をテーマにした音楽で、ジャズとはまた違った楽曲の世界に触れる機会をいただきました。",
      "ジャズ、ボサノヴァ、ポップス、オリジナル曲。それぞれ違う魅力を持つ歌を、これからもいろいろな場所で聴いていただけたらと思います。"
    ],
    "refs": [
      [
        "Studio Soup・2010年のデビュー発表",
        "https://www.atpress.ne.jp/news/14208"
      ]
    ]
  },
  {
    "no": "06",
    "label": "2012–2014 / KYUSHU LIVE",
    "h": "九州の街で、皆さんと音楽を分かち合う",
    "body": [
      "海外での録音だけでなく、福岡や北九州をはじめ、九州各地で演奏してきました。ライブハウスやカフェ、地域の文化施設など、音楽を届ける場所はさまざまです。",
      "2014年には、石川雄一さんと宗像の「晩秋のララバイ ～Jazz in 宗像～」に出演しました。地域の皆さんに生演奏を聴いていただける機会も、私の活動の大切な一部です。",
      "ライブに足を運んでくださる方、演奏の場を作ってくださるお店の方、一緒に音楽を作ってくださる演奏家の皆さん。これからも、一つひとつの出会いを大切にしていきたいです。"
    ],
    "refs": [
      [
        "Jazz工房Nishimura・2012年公演案内",
        "https://blog.livedoor.jp/miles1950/archives/1673548.html"
      ],
      [
        "Jazz工房Nishimura・2013年公演記録",
        "https://blog.livedoor.jp/miles1950/archives/1748500.html"
      ],
      [
        "宗像市・海の道むなかた館年報（平成26年度）",
        "https://www.city.munakata.lg.jp/searoad/kiji0034296/3_4296_up_r8phn24y.pdf"
      ]
    ]
  },
  {
    "no": "07",
    "label": "2022–2023 / OLD FRIENDS & NEW PLACES",
    "h": "年月が経っても、音楽でまた出会える",
    "body": [
      "2022年には北九州で森山修さんとの演奏を案内し、2023年にも熊本や宮崎での公演を企画しました。ニューヨークで出会った仲間と、長い時間を経て九州でまた音楽を届けられることは、私の活動の中にある大切なご縁です。",
      "街の中のお店でも、自然に囲まれた場所でも、音楽を通して新しい人に出会うことができます。これからも、いろいろな場所で皆さんとお会いできたら嬉しいです。"
    ],
    "refs": [
      [
        "本人ブログ・2022年8月の演奏予定",
        "https://ameblo.jp/izumiwada/entry-12756795302.html"
      ],
      [
        "本人ブログ・2023年11月の演奏予定",
        "https://ameblo.jp/izumiwada/entry-12827313905.html"
      ]
    ]
  },
  {
    "no": "08",
    "label": "2023 / IN HER OWN WORDS",
    "h": "生演奏を、もっと身近なものにしたい",
    "body": [
      "2023年12月、グリーンルーム時代のJazzy Nightを一夜限りで復活させる公演をご案内しました。普段ライブに行かない方や、食事に訪れた方にも気軽に生演奏に触れていただけるよう、ミュージックチャージを1,000円にしました。",
      "私がカフェでジャズと出会ったように、今までライブを聴く機会がなかった方にも、音楽のある時間を楽しんでいただけたら嬉しいです。ジャズに詳しいかどうかを気にせず、まずはその場に流れる音を楽しんでください。",
      "同じ年の熊本での公演では、会場のオーナーが書いた小説から受けた着想を歌に生かしたいという思いをブログに綴りました。音楽以外の表現や人との出会いからも、新しいものを受け取りながら歌っていきたいです。"
    ],
    "refs": [
      [
        "本人ブログ・2023年12月 Jazzy Night",
        "https://ameblo.jp/izumiwada/entry-12831217510.html"
      ],
      [
        "本人ブログ・2023年2月の演奏予定",
        "https://ameblo.jp/izumiwada/entry-12788952942.html"
      ]
    ]
  },
  {
    "no": "09",
    "label": "2024–2026 / STILL SINGING",
    "h": "これからも歌を届けたい。皆さんにお願いがあります。",
    "body": [
      "ジャズに出会ってから、ニューヨーク、スウェーデン、そして九州のさまざまな場所へ。これまで音楽を通してたくさんの人と出会ってきました。2025年、2026年にも石川雄一さんとの公演が案内され、音楽を届ける活動は続いています。",
      "これからも、私の歌を聴いてくださる方とのつながりを大切にしながら、まだ私の音楽を知らない方にも出会っていきたいと思います。",
      "もし私の歌や活動に少しでも共感していただけたなら、皆さんのお力を貸していただけませんか。ライブへ足を運んでいただくこと、SNSで活動を知っていただくこと、このページを音楽好きの方に紹介していただくこと。その一つひとつが、音楽を広げるきっかけになります。",
      "今回は、私の音楽に触れるもう一つの入口として、touchCDという小さな音楽グッズもご紹介しています。作品に興味を持っていただけたら、ぜひ商品紹介もご覧ください。手元に迎えて応援していただけたら嬉しいです。",
      "最後まで読んでくださり、ありがとうございます。これからも、どうぞよろしくお願いいたします。"
    ],
    "refs": [
      [
        "本人ブログ・SNSでの告知について",
        "https://ameblo.jp/izumiwada/entry-12853856746.html"
      ],
      [
        "号外NET・2025年6月 潮騒ライブ",
        "https://munakata-fukutsu-koga.goguynet.jp/2025/06/08/shiosailive/"
      ],
      [
        "チャチャタウン小倉・2025年7月2日公演案内",
        "https://www.chachatown.com/eventinfo/5166.html"
      ],
      [
        "Music Bar Bridge・2026年7月公演案内",
        "https://bridge-josui.com/event/k_9wzq8s9_3"
      ],
      [
        "音めぐり・2026年11月18日公演情報",
        "https://mut.rip/concerts/166601/"
      ]
    ]
  }

  ]:[
    {no:"01",label:"OUR IDEA",h:"ライブが終わったあとも、音楽とつながるために",body:["お気に入りの歌を聴いた夜。演奏が終わって会場を出たあとも、そのときの音や空気が心に残ることがあります。何気ない日常のなかで、もう一度その音楽に出会いたいと思うこともあります。","touchCDが目指しているのは、そうした音楽とのつながりを、スマートフォンの画面だけで完結させず、手に取れる形にすることです。音楽を聴くための入口でありながら、部屋に飾ったり、バッグに付けたりして楽しめるもの。そんなグッズのあり方を、この作品からも伝えたいと考えています。"]},
    {no:"02",label:"ARTWORK",h:"赤と黒で表現された、小さなジャズの世界",body:["『A Jazz Date with Izumi』の実物には、赤と黒を基調とした印象的なジャケットが収められています。表面には文字と鍵盤を思わせるグラフィック。裏面には赤いレコードを思わせるデザイン。透明ケースを通して、それぞれ違った表情を楽しめます。","私たちがこのグッズの魅力として伝えたいのは、音楽のイメージが、目で見て手に触れられることです。ケースの表と裏で変わるデザインは、単なるロゴ入りのキーホルダーとは違い、一つの作品として眺める楽しさを生みます。"],photo:["/touchcd-jazz-both.webp","表面と裏面の実物写真"]},
    {no:"03",label:"PHYSICAL EXPERIENCE",h:"ケースを開くという、ちょっとした楽しみ",body:["ミニCDケースは開閉でき、中のディスクも取り外せます。普通の音楽CDを手にしたときのように、ジャケットを見て、ケースを開いて、中のデザインを眺めることができます。","音楽を配信で聴くことが当たり前になった今だからこそ、作品を手元に置くという体験にも価値があると考えています。大きなコレクション棚がなくても、鍵やバッグのそばに、好きな音楽を一つ置いておける。そこに小さな音楽グッズならではの楽しさがあります。"],photo:["/touchcd-jazz-front.webp","ジャケットの実物写真"]},
    {no:"04",label:"NFC / DIGITAL EXPERIENCE",h:"かざすだけで、作品へ戻れる入口",body:["手に取る楽しさに加えて、touchCDにはNFCによるリンクの読み取り機能があります。対応するスマートフォンを近づけ、表示されたリンクを開けば、設定された作品ページへ移動できます。","購入者向けのページそのものは、この紹介ページから直接開けるようにはしていません。ここでお伝えするのは、グッズとWebをつなげるという仕組みとその価値です。実際の掲載内容や閲覧条件については、販売前に確認し、ご案内します。"],photo:["/touchcd-jazz-back.webp","裏面の実物写真"]},
    {no:"05",label:"FOR MUSIC LOVERS",h:"好きな音楽を、手元に残すという選択",body:["音楽を聴くこと、ライブに行くこと、アーティストの活動を周りに紹介すること。音楽を楽しむ方法は一つではありません。touchCDも、その選択肢の一つになれたらと考えています。","このグッズを見かけたときに、音楽を思い出す。誰かに見せたときに、好きなアーティストの話が始まる。そんな日常のきっかけが積み重なっていくことを、制作側として大切にしています。"]}
  ];
  return shell(request,`<main class="izumi-page izumi-editorial-page ${artist?"izumi-artist-story-page":"izumi-making-story-page"} section-shell">
    <a class="crumb" href="${root}">← A Jazz Date with Izumi 商品紹介</a>
    <header class="izumi-editorial-hero${artist?" izumi-portrait-hero":""}">${artist?'<figure class="izumi-live-portrait"><img src="/izumi-wada-live.webp" width="400" height="602" alt="マイクを手に歌唱する和田いづみさんのライブ写真" fetchpriority="high" decoding="async"><figcaption>ライブでの歌唱風景（提供写真）</figcaption></figure>':""}<div class="izumi-editorial-headcopy"><p class="izumi-overline">${artist?"ARTIST STORY / IZUMI WADA":"MAKING STORY / touchCD EDITORIAL"}</p><h1>${headline}</h1><p class="izumi-editorial-subtitle">${artist?"和田いづみ　JAZZ VOCAL":"A Jazz Date with Izumi"}</p><p class="izumi-editorial-lead">${lead}</p><div class="izumi-editorial-author">${artist?"和田いづみ":"文・編集：touchCD"}</div>${artist?`<a class="izumi-main-button izumi-appeal-top" href="#izumi-support">応援する方法を見る ↓</a>`:""}</div>${artist?"":'<figure><img src="/touchcd-jazz-both.webp" alt="赤と黒のミニCD型キーホルダーの実物" fetchpriority="high"><figcaption>実際に制作されたtouchCD</figcaption></figure>'}</header>
    <nav class="izumi-contents" aria-label="記事の目次"><h2>目次</h2>${chapters.map(ch=>`<a href="#chapter-${ch.no}"><span>${ch.no}</span>${ch.h}</a>`).join("")}</nav>
    <div class="izumi-longread">${chapters.map(ch=>`<section id="chapter-${ch.no}"><p class="izumi-overline">${ch.label}</p><h2>${ch.h}</h2>${ch.body.map(t=>`<p>${t}</p>`).join("")}${ch.tracks?`<div class="izumi-album"><p class="izumi-overline">DISCOGRAPHY / 2009</p><h3>Just The Two Of Us</h3><p>公開済みのアルバム情報（touchCDの収録内容ではありません）</p><ol>${ch.tracks.map(t=>`<li>${escaped(t)}</li>`).join("")}</ol><a class="izumi-outline" href="https://www.oricon.co.jp/prof/508163/products/867317/1/" target="_blank" rel="noopener noreferrer">アルバム情報を見る ↗</a></div>`:""}${ch.refs?`<details class="izumi-chapter-sources"><summary>この章の参考資料（${ch.refs.length}件）</summary><ul>${ch.refs.map(([label,url])=>`<li><a href="${escaped(url)}" target="_blank" rel="noopener noreferrer">${escaped(label)} ↗</a></li>`).join("")}</ul></details>`:""}${ch.photo?`<figure><img src="${ch.photo[0]}" alt="${ch.photo[1]}" loading="lazy"><figcaption>${ch.photo[1]}</figcaption></figure>`:""}</section>`).join("")}</div>
    ${artist?`<section id="izumi-support" class="izumi-editorial-end izumi-support-message"><p class="izumi-overline">PLEASE SUPPORT MY MUSIC</p><h2>皆さんの応援が、<br>次の音楽につながります。</h2><p>これからも歌を届けていくために、皆さんのお力を貸していただけたら嬉しいです。無理のない形で、私の音楽を応援していただけませんか。</p><div class="izumi-support-options"><article><span>01</span><h3>作品を手に取る</h3><p>touchCDの商品紹介から無料予約をご確認いただけます。条件達成後にメールで決済をご案内します。</p><a class="izumi-main-button" href="${root}#izumi-order">作品・無料予約を見る ↗</a></article><article><span>02</span><h3>ライブでお会いする</h3><p>次の公演や日々の活動を、Instagramでご案内しています。</p><a class="izumi-outline" href="${instagram}" target="_blank" rel="noopener noreferrer">Instagramで活動を見る ↗</a></article><article><span>03</span><h3>音楽を広める</h3><p>このページを音楽好きな方に紹介していただくことも応援になります。</p><a class="izumi-outline" href="https://ameblo.jp/izumiwada/" target="_blank" rel="noopener noreferrer">ブログ・過去の活動を見る ↗</a></article></div><p class="izumi-message-signoff">これからも、歌を通して皆さんとお会いできますように。<br>和田いづみ</p></section>`:`<section class="izumi-editorial-end"><p class="izumi-overline">THE PRODUCT</p><h2>手のひらに、音楽を。</h2><p>実物の写真、使い方、販売情報は商品紹介ページへ。ご希望の方は商品紹介ページから無料予約をご確認ください。</p><a class="izumi-main-button" href="${root}#izumi-product">商品写真を見る ↗</a></section>`}
    <div class="izumi-editorial-cross"><a class="izumi-outline" href="${root}">商品紹介に戻る</a><a class="izumi-outline" href="${root}/${artist?"making":"artist"}">${artist?"touchCDの制作ストーリーへ":"和田いづみさんの紹介へ"} ↗</a></div>
    </main>`,{title:title+"｜touchCD",description:lead,image:artist?"/izumi-wada-live.webp":"/touchcd-jazz-front.webp",unlisted:false,cta:"商品紹介",ctaUrl:root});
}
