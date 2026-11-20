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

function statusFor(data) {
  if (data.campaign.demo) return "サンプル";
  if (data.paid >= data.paidGoal) return "製造決定";
  if (data.reserved >= data.capacity) return "予定数到達";
  if (data.accepting) return "予約受付中";
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
    <div class="release-art">${productImage(campaign, "release-img")}<span class="card-status">${statusFor(data)}</span></div>
    <div class="release-detail"><div><p class="artist-tag">${escaped(campaign.artist)}</p><h3>${escaped(campaign.title)}</h3></div><span class="card-arrow" aria-hidden="true">↗</span></div>
    <div class="card-bottom"><span>無料予約 ${reserved} / ${reservationGoal}個</span><strong>${amount(campaign.price)}</strong></div>
  </a></article>`;
}

function guide(steps = {}) {
  const { payment = "所定の予約数に届いた作品は、メールでお支払いをご案内します。", production = "必要な入金数に達したら製造し、作品ページに記載の会場でお渡しします。" } = steps;
  return `<section class="guide section-shell" id="guide"><div class="section-head"><h2>予約の流れ</h2></div>
  <ol class="steps">
    <li><span class="step-index" aria-hidden="true">01</span><div><h3>無料で予約</h3><p>作品を選び、希望個数とメールアドレスを登録します。</p></div></li>
    <li><span class="step-index" aria-hidden="true">02</span><div><h3>お支払い</h3><p>${payment}</p></div></li>
    <li><span class="step-index" aria-hidden="true">03</span><div><h3>会場で受取</h3><p>${production}</p></div></li>
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
      <a class="primary hero-button" href="#releases">作品を探す <span aria-hidden="true">↘</span></a></div>
      <div class="hero-visual"><img src="/low-frequency.webp" alt="黒いレコードの上に置いた、黄緑のジャケットのミニCDキーホルダー" fetchpriority="high"></div>
    </section>
    <section id="releases" class="section-shell releases"><div class="section-head"><h2>作品一覧</h2><span>${releases.length}作品</span></div>
    ${releases.length ? `<div class="release-grid">${releases.map(card).join("")}</div>` : '<p>現在、先行予約を受け付けている作品はありません。</p>'}</section>
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

function projectPage(request, data) {
  const { campaign, reserved, paid, reservationGoal, paidGoal, capacity, accepting } = data;
  const collecting = reserved >= reservationGoal || paid >= paidGoal;
  const current = collecting ? paid : reserved;
  const target = collecting ? paidGoal : reservationGoal;
  const canReserve = accepting && reserved < capacity;
  const date = Number.isFinite(Date.parse(campaign.deadline)) ? new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", dateStyle: "long", timeStyle: "short",
  }).format(new Date(campaign.deadline)) : campaign.demo ? "サンプル企画" : "日時は作品のお知らせでご案内";
  const music = campaign.music && allowedUrl(campaign.music) ? `<a class="secondary" href="${escaped(campaign.music)}" target="_blank" rel="noopener noreferrer">楽曲を聴く <span aria-hidden="true">↗</span></a>` : "";
  const contact = campaign.contact && allowedUrl(campaign.contact, true) ? `<a class="text-link" href="${escaped(campaign.contact)}">お問い合わせ ↗</a>` : "";
  const artistText = escaped(campaign.artist);
  const artistLink = campaign.visibility === "listed"
    ? `<a class="artist-link" href="/artists/${campaign.artistSlug}">${artistText} <span aria-hidden="true">↗</span></a>`
    : `<span class="artist-link">${artistText}</span>`;
  return shell(request, `<main class="shell project-page" data-project="${escaped(campaign.slug)}" data-artist="${escaped(campaign.artistSlug)}">
  <a class="crumb" href="/#releases">← 作品一覧</a>
  <div class="project-heading"><p class="eyebrow"><span aria-hidden="true"></span>${campaign.demo ? "サンプル作品" : "touchCD 先行予約"}</p>
  <h1>${escaped(campaign.title)}</h1>${artistLink}</div>
  <div class="project-layout">
    <figure class="product-image">${productImage(campaign, "project-image", true)}${campaign.demo ? '<figcaption>商品イメージ</figcaption>' : ""}</figure>
    <aside class="reservation-card" id="reserve">
      <div class="booking-top"><span class="pill" id="campaign-status">${statusFor(data)}</span><span>${capacity}個限定</span></div>
      <h2>先行予約</h2><p class="price"><strong>${amount(campaign.price)}</strong><span>税込 / 1個</span></p>
      <div class="count-label"><span id="progress-label">${collecting ? "入金済み" : "無料予約"}</span><span><strong id="reservation-count">${current}</strong> / <span id="reservation-target">${target}</span>個</span></div>
      <progress id="progress" aria-labelledby="progress-label" value="${current}" max="${target}"></progress>
      <p class="progress-note" id="progress-note">${collecting ? `無料予約${reserved}個 / ${paidGoal}個分の入金で製造` : `無料予約${reservationGoal}個で、お支払いをご案内`}</p>
      <dl class="details"><div><dt>受付締切</dt><dd>${escaped(date)}</dd></div><div><dt>受取方法</dt><dd>${escaped(campaign.pickup || "会場受取")}</dd></div></dl>
      <button class="primary" type="button" id="open-reserve" disabled>無料で予約する <span aria-hidden="true">→</span></button>
      <p class="button-note" id="booking-note" role="status">${canReserve ? "予約時のお支払いはありません" : reserved >= capacity ? "予定数に達しました" : "現在、予約を受け付けていません"}</p>
    </aside>
    <section class="story"><h2>作品について</h2><p>${escaped(campaign.story)}</p>${music}${contact}</section>
  </div>
  ${guide({ payment: `予約が${reservationGoal}個集まったら、メールでご案内します。`, production: `${paidGoal}個分のお支払いが確認できたら製造し、会場でお渡しします。` })}
  <details class="faq"><summary>当日の受取方法は？</summary><p>お支払い完了メールを受付でご提示ください。スタッフがメールに記載された受取コードを確認します。</p></details>
  <details class="faq"><summary>製造が決まらなかったら？</summary><p>お支払い前に終了した場合、料金はかかりません。お支払い後に製造条件を満たさなかった場合は全額返金します。</p></details>
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
