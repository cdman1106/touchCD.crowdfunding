async function getPaymentSettings(db, campaign) {
  const row = await db.prepare("SELECT checkout_url, deadline FROM project_payment_settings WHERE campaign_id = ?").bind(campaign.id).first();
  return row || { checkout_url: "", deadline: "" };
}

function parseCheckoutUrl(input) {
  if (typeof input !== "string" || input.length > 1500 || /[\x00-\x1f\x7f]/.test(input)) return null;
  const value = input.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname ? url.href : null;
  } catch { return null; }
}

function validPaymentDeadline(value) {
  if (typeof value !== "string") return false;
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(value)) return false;
  const jst = Date.parse(value) + 9 * 60 * 60_000;
  return Number.isFinite(jst) && new Date(jst).toISOString().slice(0, 19) === value.slice(0, 19);
}

async function savePaymentSettings(request, db, campaign) {
  const body = await readBody(request);
  const checkoutUrl = parseCheckoutUrl(body?.checkout_url);
  const deadline = body?.deadline;
  if (checkoutUrl === null || !validPaymentDeadline(deadline)) {
    return json({ error: "決済リンクは https:// から始まるURL、期限は日本時間で入力してください。" }, 400);
  }
  await db.prepare(`
    INSERT INTO project_payment_settings (campaign_id, checkout_url, deadline)
    VALUES (?, ?, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET checkout_url = excluded.checkout_url, deadline = excluded.deadline
  `).bind(campaign.id, checkoutUrl, deadline).run();
  return json({ saved: true });
}

async function savePaymentLink(request, db, campaign) {
  const body = await readBody(request);
  const url = parseCheckoutUrl(body?.checkout_url);
  if (!uuidLike(body?.id) || url === null) return json({ error: "予約情報と決済リンクをご確認ください。" }, 400);
  const result = await db.prepare(`
    UPDATE reservations SET payment_url = ? WHERE id = ? AND campaign_id = ? AND paid = 0
  `).bind(url, body.id, campaign.id).run();
  return result.meta.changes ? json({ saved: true }) : json({ error: "未入金の予約が見つかりません。" }, 409);
}

const paymentDate = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", dateStyle: "long", timeStyle: "short",
});

function paymentGuide(campaign, { name, quantity, price, fulfillment, shipping_fee = 0 }, deadline, link, disclosureUrl, demo = false) {
  const shipping = fulfillment === "shipping";
  const subject = `【touchCD】${campaign.title}のお支払いのご案内`;
  const text = [
    `${name} 様`,
    "",
    "touchCDの無料予約が規定数に達しました。以下の内容でお支払いをお願いします。",
    "",
    `作品：${campaign.title} / ${campaign.artist}`,
    `予約個数：${quantity}個`,
    `お支払い合計：${amount(price * quantity + shipping_fee)}（税込${shipping ? `・送料 ${amount(shipping_fee)}込み` : ""}）`,
    `お支払い期限：${paymentDate.format(new Date(deadline))}（日本時間）`,
    `お受け取り：${shipping ? `自宅配送（${campaign.shippingNote || "成立後に発送案内"}）` : campaign.pickup}`,
    "",
    "お支払い方法：クレジットカード決済（Stripe）のみ",
    "お支払い後のお客様都合によるキャンセル・返品はお受けできません。",
    `返品・不良品対応（特定商取引法に基づく表記）：${disclosureUrl}`,
    `決済リンク：${link}`,
    "",
    "お支払いの際は、無料予約に使ったメールアドレスをご入力ください。",
    ...(shipping && isIzumiCampaign(campaign) ? ["無料予約時に登録した住所へ配送します。住所に変更がある場合や未登録の場合は、決済前にお問い合わせください。"] : []),
    "入金を確認できましたら、お支払い完了メールをお送りします。",
    "必要な入金数に達せず製造が決まらなかった場合は、返金をご案内します。",
    "touchCD",
  ].join("\n");
  return { subject, text, demo };
}

async function draftPaymentGuide(request, env, campaign) {
  const body = await readBody(request);
  const settings = await getPaymentSettings(env.DB, campaign);
  const disclosureUrl = new URL("/tokushoho", request.url).href;
  if (campaign.demo) {
    const quantity = body?.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) return json({ error: "見本の個数を選んでください。" }, 400);
    const deadline = settings.deadline || new Date(Date.now() + 3 * 86400_000).toISOString();
    return json(paymentGuide(campaign, { name: "サンプル", quantity, price: campaign.price }, deadline, "［見本の決済リンク］", disclosureUrl, true));
  }
  if (!uuidLike(body?.id)) return json({ error: "案内を作る予約を選んでください。" }, 400);
  const [state, entry] = await Promise.all([
    publicData(env, campaign),
    env.DB.prepare("SELECT name, quantity, paid, payment_url, fulfillment, shipping_fee FROM reservations WHERE id = ? AND campaign_id = ?")
      .bind(body.id, campaign.id).first(),
  ]);
  if (!entry || entry.paid) return json({ error: "未入金の予約が見つかりません。" }, 409);
  if (state.reserved < state.reservationGoal) {
    return json({ error: `無料予約が${state.reservationGoal}個に達してから案内を作成できます。現在は${state.reserved}個です。` }, 409);
  }
  if (!(Date.parse(settings.deadline) > Date.now())) return json({ error: "作品の支払期限に今より後の日時を設定してください。" }, 409);
  const link = entry.payment_url || (entry.quantity === 1 && entry.shipping_fee === 0 ? settings.checkout_url : "");
  if (!link) {
    return json({ error: entry.shipping_fee > 0 ? "送料込みの金額で作成した個別決済リンクを保存してください。" : entry.quantity > 1 ? `${entry.quantity}個分の個別決済リンクをこの予約に保存してください。` :
      "作品の共通決済リンク、またはこの予約の個別決済リンクを保存してください。" }, 409);
  }
  // Persist the link before exposing a payment guide to prevent a cancellation race.
  const locked = await env.DB.prepare("UPDATE reservations SET payment_url = ? WHERE id = ? AND campaign_id = ? AND paid = 0 AND COALESCE(payment_url, '') = ?").bind(link, body.id, campaign.id, entry.payment_url || "").run();
  if (!locked.meta.changes) return json({ error: "予約がキャンセルされたか、更新されました。最新の予約一覧をご確認ください。" }, 409);
  return json(paymentGuide(campaign, { ...entry, price: campaign.price }, settings.deadline, link, disclosureUrl));
}
