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
  const real = data.filter(({ campaign }) => !campaign.demo);
  const releases = real.length ? real : data;
  return shell(request, `<main>
    <section class="hero shell">
      <div class="hero-copy"><p class="eyebrow"><span aria-hidden="true"></span> ミニCDキーホルダーの先行予約</p>
      <h1>音楽を、<br>手に取る。</h1>
      <p class="hero-description">好きなアーティストのジャケットを、小さなCDに。スマホをかざせば、あの曲がまた聴ける。</p>
      <a class="primary hero-button" href="#releases">作品を探す <span aria-hidden="true">↘</span></a> <a class="secondary hero-button" href="/consultation">アーティスト向け無料相談 <span aria-hidden="true">↗</span></a></div>
      <div class="hero-visual"><img src="/low-frequency.webp" alt="黒いレコードの上に置いた、黄緑のジャケットのミニCDキーホルダー" fetchpriority="high"></div>
    </section>
    <section id="releases" class="section-shell releases"><div class="section-head"><h2>作品一覧</h2><span>${releases.length}作品</span></div>
    <div class="release-grid">${releases.map(card).join("")}</div></section>
    <section class="guide section-shell" id="artist-consultation"><div class="section-head"><h2>アーティストの方へ</h2></div><p>一緒にグッズ・イベントを企画しませんか？新曲・ライブ・周年記念を、音楽やSNSにつながるミニCDに。標準の予約販売なら制作費の前払いは不要です。</p><p>制作費の前払い不要（標準予約販売）。まずは取り分やグッズの使い方を確認し、企画が決まっていなくても無料で相談できます。</p><a class="primary hero-button" href="/consultation">一緒にグッズ・イベントを企画する <span aria-hidden="true">↗</span></a></section>
    ${guide()}
  </main>`);
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
