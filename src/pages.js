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
    ["支払い方法", "Stripeの決済画面に表示される方法をご利用いただけます。"],
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
  if (data.reserved >= data.capacity) return "予定数到達";
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

function card(data) {
  const { campaign, reserved, reservationGoal } = data;
  return `<article class="release-card"><a href="${releasePath(campaign)}">
    <div class="release-art">${productImage(campaign, "release-img")}<span class="card-status">${data.status}</span></div>
    <div class="release-detail"><div><p class="artist-tag">${escaped(campaign.artist)}</p><h3>${escaped(campaign.title)}</h3></div><span class="card-arrow" aria-hidden="true">↗</span></div>
    <div class="card-bottom"><span>${data.paid >= data.paidGoal ? "製造条件達成" : reserved >= reservationGoal ? `入金済み ${data.paid} / ${data.paidGoal}個` : `無料予約 ${reserved} / ${reservationGoal}個`}</span><strong>${amount(campaign.price)}</strong></div>
  </a></article>`;
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
  const accepting = releases.filter(x => x.accepting && x.reserved < x.capacity && x.paid < x.paidGoal);
  const ordered = [...accepting, ...releases.filter(x => !accepting.includes(x))];
  return shell(request, `<main class="fan-home">
  <section class="fan-hero shell">
    <div class="fan-copy"><p class="fan-kicker">MUSIC × NFC × GOODS</p><h1>音楽を、<br>手に取る。</h1><p class="fan-lead">好きなアーティストの音楽を、いつもそばに。</p><p>小さなCDケースに、大切な作品を。スマホをかざすだけで、音楽・映像・思い出につながるミニCDキーホルダー。</p></div>
    <figure class="fan-hero-art"><img src="/touchcd-studio-removed.webp" alt="実際のtouchCDを元にした、ディスクを取り外したケースの広告用画像" width="1200" height="800" fetchpriority="high"><figcaption>制作参考イメージ（実物を元にAI加工）</figcaption></figure>
    <div class="fan-actions"><a class="primary" href="#releases">作品を探す ↘</a><a class="secondary" href="#about-touchcd">touchCDとは？ ↓</a><p>ファンの予約から、作品が形になります。</p></div>
  </section>
  <section id="releases" class="section-shell releases fan-silver"><div class="section-head"><h2>作品一覧</h2><span>募集中 <strong>${accepting.length}</strong>件 / 全${releases.length}作品</span></div>
    ${ordered.length ? `<div class="release-grid">${ordered.map(card).join("")}</div>` : '<div class="fan-empty"><span class="fan-record" aria-hidden="true"></span><div><h3>次の作品を準備中</h3><p>新しい作品の公開をお楽しみに。</p></div></div>'}
    ${releases.length && !accepting.length ? '<p class="fan-list-note">現在予約受付中の作品はありません。次の募集をお楽しみに。</p>' : ''}
  </section>
  <section id="about-touchcd" class="section-shell fan-about"><p class="fan-kicker">WHAT IS touchCD?</p><h2>手に取る。かざす。楽しむ。</h2><p class="fan-sub">音楽と特別なコンテンツがつながる、ミニCDキーホルダーです。</p><div class="fan-how">
    <article><img src="/touchcd-jazz-front.webp" alt="実物の表面ジャケット" width="960" height="720" loading="lazy"><div><h3>手に取る</h3><p>好きなアーティストのジャケットを、グッズとして持ち歩く。</p></div></article>
    <article><div class="fan-symbol"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="13" y="5" width="22" height="38" rx="4"/><path d="M21 10h6M21 38h6M7 15a14 14 0 0 0 0 18M41 15a14 14 0 0 1 0 18"/></svg><span>NFC</span></div><div><h3>スマホをかざす</h3><p>NFC対応スマートフォンで読み取り、専用ページを開く。</p></div></article>
    <article><div class="fan-symbol"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="18"/><path d="m20 15 13 9-13 9Z"/></svg><span>MUSIC / MOVIE / SNS</span></div><div><h3>音楽を楽しむ</h3><p>作品ごとの楽曲、映像、写真、メッセージを楽しむ。</p></div></article>
  </div><p class="fan-note">掲載内容は作品ごとに異なります。NFC対応端末と通信環境が必要です。</p></section>
  <section id="guide" class="section-shell guide fan-silver reservation-explain"><p class="reservation-label">予約販売の仕組み</p><div class="section-head"><h2>ファンの「欲しい」から、<br>グッズが生まれる。</h2></div><p class="reservation-intro">あなたの無料予約が、好きなアーティストのグッズ化を後押しします。先に作るのではなく、欲しい人が集まってから作る。ファンの購入代金をもとに製造する仕組みなので、アーティストの先行投資や在庫リスクも抑えられます。</p><ol class="reservation-explain-steps"><li><div class="reservation-step-mark"><span>01</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7h30v34H9zM17 16h14M17 24h14M17 32h8"/><path d="m28 33 4 4 7-8"/></svg></div><div><h3>一緒に企画・目標設定</h3><p>アーティストとtouchCDがデザイン・専用Webページ・販売価格・納期などを相談し、製造費とアーティストへの利益還元を考えて目標を決めます。</p></div></li><li><div class="reservation-step-mark"><span>02</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 14h34v8a5 5 0 0 0 0 10v2H7v-2a5 5 0 0 0 0-10zM30 14v5m0 5v5m0 5v1"/></svg></div><div><h3>ファンから無料予約を受付</h3><p>専用予約ページから0円で予約できます。SNSやライブで見つけた作品のグッズ化を応援。この段階ではまだ製造しません。</p></div></li><li><div class="reservation-step-mark"><span>03</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="12" width="38" height="26" rx="4"/><path d="M5 20h38M11 30h10"/></svg></div><div><h3>目標達成・購入のご案内</h3><p>無料予約の目標に達すると、メールで購入・支払いのご案内が届きます。無料予約と入金は別に数え、必要な入金数に達すると正式成立します。</p></div></li><li><div class="reservation-step-mark"><span>04</span><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m24 6 17 9v18l-17 9-17-9V15zM7 15l17 9 17-9M24 24v18M15 10l17 9"/></svg></div><div><h3>製造・お届け</h3><p>必要な入金を確認してから製造。選んだ方法で配送またはライブ会場でお渡しします。未成立の場合は製造せず、支払い済み代金を全額返金します。</p></div></li></ol><div class="reservation-minimum"><strong>最低製造個数は原則1デザイン25個。</strong><p>ただし、25個は製造する個数の基準であり、必ず25人の購入者が必要という意味でも、予約上限でもありません。販売価格・製造費・企画内容・アーティストの利益に応じて成立ラインを設定します。</p></div><div class="reservation-example"><p class="reservation-example-kicker">予約販売のシミュレーション / 基本例</p><h3>無料予約35件 → 入金25件 → 製造25個</h3><p class="reservation-example-intro">1件につき1個を予約・購入する場合。25件入金した場合の例です。</p><ol class="reservation-example-flow" aria-label="無料予約35件、入金案内、入金25件、製造25個"><li><span class="reservation-node-label">無料予約の目標</span><strong class="reservation-number">35<small>件</small></strong><span class="reservation-node-caption">達成したら案内へ</span></li><li><span class="reservation-node-label">購入・入金案内</span><svg class="reservation-mail" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="m7 14 17 14 17-14"/></svg><span class="reservation-node-caption">メールで支払いを案内</span></li><li><span class="reservation-node-label">必要な入金数</span><strong class="reservation-number">25<small>件</small></strong><span class="reservation-node-caption">正式成立の条件</span></li><li class="production-node"><span class="reservation-node-label">製造個数</span><strong class="reservation-number">25<small>個</small></strong><span class="reservation-node-caption">製造開始</span></li></ol><p class="reservation-outcome"><span aria-hidden="true">↓</span> ファンへお届け・アーティストへ利益還元</p><p class="reservation-example-note">※ 無料予約目標には、予約後に支払いを行わないファンがいる可能性も考慮します。予約や入金の上限を25個にするものではありません。</p></div><div class="reservation-example"><p class="reservation-example-kicker">予約販売のシミュレーション / 個別企画例</p><h3>無料予約15件 → 入金12件 → 製造25個</h3><p class="reservation-example-intro">12件分の購入代金で必要な製造費と利益を確保できる場合の例です。</p><ol class="reservation-example-flow" aria-label="無料予約15件、入金案内、入金12件、製造25個"><li><span class="reservation-node-label">無料予約の目標</span><strong class="reservation-number">15<small>件</small></strong><span class="reservation-node-caption">達成したら案内へ</span></li><li><span class="reservation-node-label">購入・入金案内</span><svg class="reservation-mail" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="11" width="36" height="26" rx="4"/><path d="m7 14 17 14 17-14"/></svg><span class="reservation-node-caption">メールで支払いを案内</span></li><li><span class="reservation-node-label">必要な入金数</span><strong class="reservation-number">12<small>件</small></strong><span class="reservation-node-caption">正式成立の条件</span></li><li class="production-node"><span class="reservation-node-label">製造個数</span><strong class="reservation-number">25<small>個</small></strong><span class="reservation-node-caption">製造開始</span></li></ol><p class="reservation-outcome"><span aria-hidden="true">↓</span> ファンへお届け・アーティストへ利益還元</p><div class="reservation-example-message"><strong>残り13個の取り扱いも事前に確認。</strong><p>製造費と必要な利益を確保できること、残り13個の費用負担・販売・保管などの取り扱いを事前に合意したうえで実施します。</p></div></div><p class="reservation-common-note">※ いずれも数量は一例です（1件につき1個の予約・入金を想定）。実際の成立ラインは企画ごとに設定します。</p><div class="reservation-benefits"><article class="reservation-benefit"><h3>ファンにとってのメリット</h3><ul><li>無料で予約できる</li><li>好きなアーティストの商品化を応援できる</li><li>企画限定のオリジナルグッズを購入できる</li><li>対応スマートフォンをかざして専用Webページを楽しめる</li><li>製造不成立の場合は支払い済み代金が返金される</li></ul></article><article class="reservation-benefit"><h3>アーティストにとってのメリット</h3><ul><li>商品の事前買取が不要（標準予約販売）</li><li>先行投資を抑えられる</li><li>売れ残りのリスクを抑えられる</li><li>ファンの需要を確認してから製造できる</li><li>利益を考慮した販売計画を立てられる</li><li>新曲・ライブに合わせた限定グッズを企画できる</li><li>専用Webページ制作もtouchCDに任せられる</li></ul></article></div><div class="reservation-refund"><strong>無料予約の時点では0円。</strong><p>必要な入金数に達しなかった場合は製造せず、お支払い済み代金を送料を含めて全額返金します。</p></div><a class="primary reservation-cta" href="#releases">作品を探して応援する ↗</a></section>
  <section id="music-example" class="section-shell fan-music"><div><p class="fan-kicker">MUSIC SITE / 制作実例</p><h2>タッチした先にも、<br>アーティストの世界観を。</h2><p>実際に制作した ippuku Jazz Live &amp; Party の音楽サイト。レコード型プレーヤー、ライブ映像、出演アーティストの紹介などを掲載しています。</p><a class="primary" href="https://ippuku-event.cdman1106.workers.dev/?v=8" target="_blank" rel="noopener noreferrer">実際のサイトを体験する ↗</a><small>画面内を上下にスワイプできます。再生・表示ができない場合は直接開いてください。</small></div><div class="fan-device"><div class="fan-camera" aria-hidden="true"></div><iframe src="https://ippuku-event.cdman1106.workers.dev/?v=8" title="実際に制作した限定音楽サイト" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; encrypted-media; fullscreen" allowfullscreen referrerpolicy="no-referrer"></iframe></div></section>
  <section id="product-examples" class="section-shell fan-gallery"><p class="fan-kicker">REAL PRODUCT</p><h2>実際に作ったtouchCD</h2><p class="fan-sub">透明なミニCDケース。取り外せるディスク。作品の世界観を細部まで。</p><div class="fan-real-grid"><figure><a href="/touchcd-jazz-front.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-front.webp" alt="実際に製作したtouchCDの表面・ジャケット" width="960" height="720" loading="lazy"></a><figcaption>表面・ジャケット</figcaption></figure><figure><a href="/touchcd-jazz-back.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-back.webp" alt="実際に製作したtouchCDのケース裏面" width="960" height="720" loading="lazy"></a><figcaption>ケース裏面</figcaption></figure><figure><a href="/touchcd-jazz-open.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-open.webp" alt="実際に製作したtouchCDの開いた状態" width="960" height="720" loading="lazy"></a><figcaption>開いた状態</figcaption></figure><figure><a href="/touchcd-jazz-both.webp" target="_blank" rel="noopener noreferrer"><img src="/touchcd-jazz-both.webp" alt="実際に製作したtouchCDの表面と裏面" width="960" height="720" loading="lazy"></a><figcaption>表面と裏面</figcaption></figure></div><p class="fan-note">実物写真（トリミング・明るさ調整・QRコードぼかし済み）。ディスク表面、ケースの表面・裏面・内側・ディスク下の台紙をデザインできます。ディスク自体の裏面には印刷できません。</p></section>
  <section id="artist-consultation" class="section-shell fan-silver fan-artist"><div><p class="fan-kicker">FOR ARTISTS</p><h2>アーティストの方へ</h2><p>新曲・ライブ・周年記念を、ファンと一緒に形にしませんか？ 標準の予約販売なら制作費の前払い不要。専用音楽ページや利益試算、企画診断もご利用いただけます。</p></div><div class="fan-artist-actions"><a class="primary" href="/consultation">一緒にグッズを企画する ↗</a><a class="fan-text-link" href="/consultation#diagnosis">質問に答えて企画する ↗</a></div></section>
  <section id="questions" class="section-shell fan-faq"><h2>よくある質問</h2><details class="faq"><summary>touchCDとは何ですか？</summary><p>NFCを内蔵したミニCD型キーホルダーです。対応スマホをかざすと作品専用ページが開きます。ミニディスク自体はCDプレーヤーで再生するものではありません。</p></details><details class="faq"><summary>予約時にお金はかかりますか？</summary><p>無料予約の時点では0円です。作品ごとの条件を満たした場合、認証済みメールアドレスへ支払い案内をお送りします。</p></details><details class="faq"><summary>製造が決まらなかったら？</summary><p>必要な入金数に達しない場合は製造せず、お支払い済みの方には送料を含む全額返金をご案内します。</p></details><details class="faq"><summary>どんなスマホで使えますか？</summary><p>NFC対応スマートフォンとインターネット通信が必要です。読み取り位置は機種により異なります。</p></details><details class="faq"><summary>A案の専用音楽サイトはいつまで使えますか？</summary><p>A案は最後のtouchCD販売日から5年間利用できる設計です。新作販売で期限が更新されます。新規販売・有料延長がなければ公開停止し、閲覧できなくなります。A案のNFC認証などの新機能は開発予定を含みます。各作品の正式な利用条件は予約前にご確認ください。</p></details><details class="faq"><summary>作品によって音楽サイトが違うのですか？</summary><p>A案は共通の更新型サイト、B案は作品ごとに独立した記念サイト、C案はその両方を組み合わせる設計、D案は既存の公式HP・SNS・音楽配信先に直接つなぐ方式です。作品・ライブ記念版では該当作品の内容を楽しめる予定です。正式な閲覧範囲・期間は各作品の予約前に確認してください。<a href="/consultation#plans">4つのプランの説明</a></p></details><details class="faq"><summary>すべての作品に限定音源やライブ映像がありますか？</summary><p>掲載内容は作品ごとに異なります。楽曲・映像・写真などの内容は各作品ページで確認してください。</p></details><details class="faq"><summary>受け取り方法・送料は？</summary><p>作品によって会場受取や自宅配送を選べます。送料・受取時期は各作品ページをご確認ください。</p></details><details class="faq"><summary>支払い後のキャンセル・返品は？</summary><p>お客様都合のキャンセル・返品はお受けできません。不備がある場合などは特定商取引法に基づく表記をご確認ください。</p></details><p class="fan-note"><a href="/tokushoho">特定商取引法に基づく表記</a> ・ <a href="https://www.instagram.com/touchcdyasann/" target="_blank" rel="noopener noreferrer">公式Instagram</a></p></section>
  </main>`, {image:"/touchcd-studio-removed.webp",description:"好きなアーティストの音楽を、いつもそばに。スマホをかざすと専用音楽サイトが開くミニCDキーホルダーの先行予約サイト。"});
}

function artistPage(request, rows) {
  const artist = rows[0].campaign.artist;
  return shell(request, `<main class="section-shell artist-page"><a class="crumb" href="/#releases">← 作品一覧</a>
    <div class="artist-heading"><span class="logo-disc" aria-hidden="true"></span><h1>${escaped(artist)}</h1></div>
    <div class="section-head"><h2>作品</h2><span>${rows.length}作品</span></div><div class="release-grid">${rows.map(card).join("")}</div></main>`,
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
      <h2>先行予約</h2><p class="price"><strong>${amount(campaign.price)}</strong><span>税込 / 1個</span></p>
      <div class="reservation-stages" aria-label="予約と入金の進捗">
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
      <p class="refund-note">製造が決まらなかった場合、お支払い済みの代金は全額返金します。</p>
    </aside>
    <div class="project-main">
      <nav class="project-navigation" aria-label="作品ページ内"><a href="#about-release">作品</a><a href="#delivery">受取</a><a href="#audio">音源</a><a href="#questions">よくある質問</a></nav>
      <section class="story" id="about-release"><h2>作品について</h2><p>${escaped(campaign.story || "作品紹介を準備中です。")}</p></section>
      ${campaign.releaseUpdate ? `<section class="release-section"><h2>この作品のお知らせ</h2><p>${escaped(campaign.releaseUpdate)}</p></section>` : ""}
      <section class="release-section" id="delivery">
        <h2>受け取り方法</h2>
        <div class="delivery-options">
          <div><h3>会場受取</h3><p>${pickupDetail}</p><p>受付で支払い完了メールの受取コードをご提示ください。</p></div>
          ${shipping ? `<div><h3>自宅配送</h3><p>${escaped(campaign.shippingNote)}</p><p>送料 ${amount(campaign.shippingFee)}（税込・1注文）</p></div>` : ""}
        </div>
      </section>
      <section class="release-section" id="audio">
        <h2>かざして、音楽を聴く</h2>
        <p>受け取ったtouchCDに対応スマホをかざすと、作品の音楽ページが開きます。</p>
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
  <section id="questions" class="question-section">
    <h2>よくある質問</h2>
    <details class="faq"><summary>無料予約をするとすぐに支払いが発生しますか？</summary><p>予約時は0円です。必要な無料予約数に達したら、認証済みのメールアドレスにお支払いを案内します。</p></details>
    <details class="faq"><summary>製造が決まらなかったら？</summary><p>お支払い前に終了した場合、料金はかかりません。お支払い済みの方には全額返金をご案内します。</p></details>
    <details class="faq"><summary>会場では何を提示すればいいですか？</summary><p>支払い完了メールに記載の受取コードを受付でご提示ください。</p></details>
    <details class="faq"><summary>スマホのどこにかざしますか？</summary><p>NFCに対応したスマホの背面にかざしてください。読み取る位置は機種によって異なります。反応しづらいときは、ケースを外してもう一度お試しください。</p></details>
    <details class="faq"><summary>キャンセル・返品について</summary><p>お支払い後のお客様都合によるキャンセル・返品はお受けできません。商品に不備があった場合の対応は、<a class="text-link" href="/tokushoho">特定商取引法に基づく表記</a>をご確認ください。</p></details>
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
  const message = receiptText({ ...sampleCampaigns[0], pickup: "ライブ当日 18:00〜20:00 / 会場受付（サンプル）" }, 1, "72D4-963A-01CB");
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
