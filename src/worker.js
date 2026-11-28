const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function legacyCampaign(env) {
  if (!env.CAMPAIGN_JSON) return null;
  const campaign = JSON.parse(env.CAMPAIGN_JSON);
  const closesAt = Date.parse(campaign.deadline);
  if (!validSlug(campaign.id) || sampleCampaigns.some(({ id }) => campaign.id === id) ||
      ![campaign.title, campaign.artist, campaign.story, campaign.pickup].every((value) => typeof value === "string" && value.trim()) ||
      !Number.isSafeInteger(campaign.price) || campaign.price < 1 || !Number.isFinite(closesAt)) {
    throw new Error("Invalid CAMPAIGN_JSON");
  }
  return { ...campaign, demo: false, closesAt, artistSlug: "legacy", slug: campaign.id, visibility: "listed", reservationOpen: true };
}

function defaults(campaign) {
  if (isIzumiCampaign(campaign)) return { reservation_goal: 35, paid_goal: 25, capacity: 10000, offline_reserved: 0, offline_paid: 0 };
  return { reservation_goal: 15, paid_goal: 12, capacity: 25, offline_reserved: campaign.id === "studio-demo" ? 8 : campaign.demo ? 4 : 0, offline_paid: 0 };
}

async function getSettings(db, campaign) {
  const row = db && await db.prepare("SELECT * FROM campaign_settings WHERE campaign_id = ?").bind(campaign.id).first();
  return row || defaults(campaign);
}

async function getCounts(db, campaign) {
  if (!db || campaign.demo) return { reserved: 0, paid: 0 };
  return db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS reserved,
    COALESCE(SUM(quantity * paid), 0) AS paid FROM reservations WHERE campaign_id = ?`).bind(campaign.id).first();
}

async function publicData(env, campaign) {
  const [settings, counts, payment, lifecycle] = await Promise.all([
    campaign.settings || getSettings(env.DB, campaign),
    campaign.counts || getCounts(env.DB, campaign),
    env.DB && !campaign.counts && !campaign.demo ? getPaymentSettings(env.DB, campaign) : null,
    env.DB && !campaign.demo ? automationState(env.DB,campaign.id) : null,
  ]);
  const reserved = counts.reserved + settings.offline_reserved;
  const paid = counts.paid + settings.offline_paid;
  const accepting = campaign.demo || bookingOpen(env, campaign);
  const data = {
    campaign: {
      id: campaign.id, artistSlug: campaign.artistSlug, slug: campaign.slug, visibility: campaign.visibility, demo: campaign.demo, title: campaign.title, artist: campaign.artist, story: campaign.story,
      pickup: campaign.pickup, price: campaign.price, deadline: campaign.deadline,
      music: Number.isFinite(Date.parse(campaign.audioAt)) && Date.parse(campaign.audioAt) > Date.now() ? "" : campaign.music,
      eventInfo: campaign.eventInfo, audioAt: campaign.audioAt, releaseUpdate: campaign.releaseUpdate,
      shippingNote: campaign.shippingNote, shippingFee: campaign.shippingFee ?? null,
      image: campaign.image, contact: campaign.contact,
    },
    reservationGoal: settings.reservation_goal, paidGoal: settings.paid_goal,
    capacity: settings.capacity, unlimited: isIzumiCampaign(campaign), addressAtPayment: false, reserved, paid, accepting: accepting && !lifecycle?.outcome, outcome:lifecycle?.outcome||null, paymentDeadline: payment?.deadline || "",
  };
  return { ...data, status: statusFor(data) };
}


const adminEmail = env => asEmail(env.ADMIN_EMAIL);
async function requestAdminCode(request, env) {
  if (!env.DB || !mailReady(env) || !validEmail(adminEmail(env))) return json({error:"管理者ログインの設定が必要です。"},503);
  const now = Date.now(), db = env.DB;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = await emailDigest(env, ["admin-login", "ip", ip]);
  const globalKey = await emailDigest(env, ["admin-login", "global"]);
  for (const [key, limit] of [[ipKey, 3], [globalKey, 6]]) {
    const result = await throttle(db,key,now,60*60_000,limit).run();
    if (!result.meta.changes) return json({error:"送信回数が上限に達しました。時間をおいてください。"},429);
  }
  const id = crypto.randomUUID(), code = randomCode() + randomCode().slice(0,2);
  const digest = await emailDigest(env, ["admin-code", id, code]);
  await db.batch([
    db.prepare("DELETE FROM admin_challenges WHERE expires_at <= ?").bind(now),
    db.prepare("INSERT INTO admin_challenges(id,digest,expires_at,attempts) VALUES (?,?,?,0)").bind(id,digest,now+10*60_000),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now)
  ]);
  const sent = await sendMail(env,adminEmail(env),"【touchCD】管理者ログイン認証コード","管理者ログインコード："+code+"\n有効期限は10分です。第三者には教えないでください。", "admin-login/"+id);
  if (!sent) {
    await db.prepare("DELETE FROM admin_challenges WHERE id = ?").bind(id).run();
    return json({error:"認証メールを送信できませんでした。"},503);
  }
  return json({id});
}
async function verifyAdminCode(request,env) {
  if (!env.DB || !mailReady(env) || !validEmail(adminEmail(env))) return json({error:"ログインできません。"},503);
  const body=await readBody(request);
  if (!uuidLike(body?.id) || typeof body.code !== "string" || !/^\d{8}$/.test(body.code)) return json({error:"8桁の認証コードをご確認ください。"},400);
  const db=env.DB,now=Date.now(),digest=await emailDigest(env,["admin-code",body.id,body.code]);
  const token=crypto.randomUUID()+crypto.randomUUID();
  const sessionDigest=await emailDigest(env,["admin-session",token]);
  const check="id = ? AND expires_at > ? AND attempts < 5";
  const [failed, saved] = await db.batch([
    db.prepare("UPDATE admin_challenges SET attempts = attempts + 1 WHERE "+check+" AND digest <> ?").bind(body.id,now,digest),
    db.prepare("INSERT INTO admin_sessions(digest,expires_at) SELECT ?,? WHERE EXISTS (SELECT 1 FROM admin_challenges WHERE "+check+" AND digest = ?)").bind(sessionDigest,now+2*60*60_000,body.id,now,digest),
    db.prepare("DELETE FROM admin_challenges WHERE "+check+" AND digest = ?").bind(body.id,now,digest)
  ]);
  if (!saved.meta.changes) return json({error:"認証コードが違うか期限切れです。"},401);
  return json({token});
}

async function authorized(request, env) {
  const token = env.ADMIN_TOKEN;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ") || header.length > 1024) return false;
  const presented = header.slice(7);
  if (env.DB && mailReady(env) && /^[a-f0-9-]{72}$/.test(presented)) {
    const digest = await emailDigest(env, ["admin-session",presented]);
    const session = await env.DB.prepare("SELECT 1 FROM admin_sessions WHERE digest = ? AND expires_at > ?").bind(digest,Date.now()).first();
    if (session) return true;
  }
  if (!token || token.length < 24) return false;
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice(7))),
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
  ]);
  let difference = 0;
  const actualBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  for (let i = 0; i < actualBytes.length; i++) difference |= actualBytes[i] ^ expectedBytes[i];
  return difference === 0;
}

async function readBody(request, maxBytes = 18000) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); } catch { return null; }
}

async function reserve(request, env, campaign) {
  if (campaign.demo || !bookingOpen(env, campaign)) return json({ error: "現在、予約を受け付けていません。" }, 409);

  const form = await readBody(request);
  const name = typeof form?.name === "string" ? form.name.trim() : "";
  const email = asEmail(form?.email);
  const { quantity, verificationId, code, fulfillment = "pickup" } = form || {};
  const shipping = fulfillment === "shipping";
  const shippingFee = campaign.shippingFee ?? null;
  const postalCode = shipping && typeof form.postalCode === "string" ? form.postalCode.trim().replace("-", "") : "";
  const shippingAddress = shipping && typeof form.shippingAddress === "string" ? form.shippingAddress.trim() : "";
  if (!["pickup", "shipping"].includes(fulfillment) || (shipping &&
      (shippingFee === null || !/^\d{7}$/.test(postalCode) || !shippingAddress || shippingAddress.length > 240 || /[\x00-\x1f\x7f]/.test(shippingAddress)))) {
    return json({ error: "受取方法と、配送先の郵便番号・住所をご確認ください。" }, 400);
  }
  if (shipping && form.shippingFee !== shippingFee) {
    return json({ error: "送料が更新されました。ページを開き直してください。" }, 409);
  }
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name) || !validEmail(email) ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 5 || form?.consent !== true) {
    return json({ error: "入力内容と連絡先の利用への同意をご確認ください。" }, 400);
  }
  if (!uuidLike(verificationId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return json({ error: "メールで受け取った6桁の認証コードを入力してください。" }, 400);
  }
  if (form.price !== campaign.price) return json({ error: "価格が更新されました。ページを開き直してください。" }, 409);

  const db = env.DB;
  const time = new Date().toISOString();
  const digest = await emailDigest(env, [campaign.id, verificationId, email, code]);
  const id = crypto.randomUUID();
  const attempt = db.prepare(`
    UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ? AND campaign_id = ? AND email = ?
      AND expires_at > unixepoch('subsec') * 1000 AND attempts < 5 AND digest <> ?
  `).bind(verificationId, campaign.id, email, digest);
  const insert = db.prepare(`
    INSERT INTO reservations (id, campaign_id, name, email, quantity, created_at, email_verified_at,
      fulfillment, shipping_fee, postal_code, shipping_address)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM email_verifications WHERE id = ? AND campaign_id = ? AND email = ? AND digest = ?
      AND expires_at > unixepoch('subsec') * 1000 AND attempts < 5)
    AND ? > unixepoch('subsec') * 1000 AND (? = 0 OR EXISTS (
      SELECT 1 FROM projects WHERE id = ? AND reservation_open = 1 AND visibility <> 'draft'
      AND (julianday(deadline) > julianday('now') OR (? = 1 AND deadline = '')) AND price = ? AND (? = 0 OR shipping_fee = ?)
    )) AND (? = 1 OR
      (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ?) + ? +
      COALESCE((SELECT offline_reserved FROM campaign_settings WHERE campaign_id = ?), 0) <=
      COALESCE((SELECT capacity FROM campaign_settings WHERE campaign_id = ?), ?))
    ON CONFLICT(campaign_id, email) DO NOTHING
  `).bind(id, campaign.id, name, email, quantity, time, time, fulfillment, shipping ? shippingFee : 0, postalCode, shippingAddress,
    verificationId, campaign.id, email, digest, campaign.closesAt, Number(Boolean(campaign.managed)), campaign.id, Number(isIzumiCampaign(campaign)), campaign.price,
    Number(shipping), shippingFee, Number(isIzumiCampaign(campaign)),
    campaign.id, quantity, campaign.id, campaign.id, defaults(campaign).capacity);
  const consume = db.prepare("DELETE FROM email_verifications WHERE id = ? AND EXISTS (SELECT 1 FROM reservations WHERE id = ?)")
    .bind(verificationId, id);
  const [, saved] = await db.batch([attempt, insert, consume]);
  if (!saved.meta.changes) {
    const verification = await db.prepare("SELECT attempts, expires_at, digest FROM email_verifications WHERE id = ? AND campaign_id = ? AND email = ?")
      .bind(verificationId, campaign.id, email).first();
    if (!verification || verification.expires_at <= Date.now() || verification.attempts >= 5 || verification.digest !== digest) {
      return json({ error: "認証コードが違うか、期限が切れています。最新のメールをご確認ください。" }, 422);
    }
    return json({ error: "受付が終了したか、同じメールアドレスで受付済みです。変更の際はお問い合わせください。" }, 409);
  }
  const confirmationSent = await sendMail(env,email,"【touchCD】無料予約完了", [name+" 様","無料予約を受け付けました。現時点のお支払いは0円です。","作品："+campaign.title,"予約番号："+id.slice(0,8).toUpperCase(),"予約個数："+quantity+"個","受取方法："+(shipping?"自宅配送":"会場受取"),"成立条件を満たした場合は、このメールアドレスに支払い案内を送ります。","無料予約のキャンセルは予約ページからメール認証で行えます。","予約ページ："+new URL("/artists/"+campaign.artistSlug+"/"+campaign.slug,request.url).href].join("\n\n"),"reservation-confirmation/"+id);
  return json({ id, confirmationSent }, 201);
}

async function cancelReservation(request, env, campaign) {
  if (campaign.demo || !env.DB || !mailReady(env)) return json({ error: "現在キャンセル手続きを利用できません。お問い合わせください。" }, 503);
  const body = await readBody(request);
  const email = asEmail(body?.email);
  const { verificationId, code } = body || {};
  if (!validEmail(email) || !uuidLike(verificationId) || typeof code !== "string" || !/^\d{6}$/.test(code)) return json({ error: "メールアドレスと6桁の認証コードをご確認ください。" }, 400);
  const db = env.DB;
  const digest = await emailDigest(env, ["cancel", campaign.id, verificationId, email, code]);
  const check = "id = ? AND campaign_id = ? AND email = ? AND expires_at > unixepoch('subsec') * 1000 AND attempts < 5";
  const args = [verificationId, campaign.id, email];
  const attempt = db.prepare("UPDATE email_verifications SET attempts = attempts + 1 WHERE " + check + " AND digest <> ?").bind(...args, digest);
  const remove = db.prepare("DELETE FROM reservations WHERE campaign_id = ? AND email = ? AND paid = 0 AND COALESCE(payment_url, '') = '' AND paid_receipt_id IS NULL AND pickup_at IS NULL AND NOT EXISTS (SELECT 1 FROM payment_receipts WHERE reservation_id = reservations.id) AND EXISTS (SELECT 1 FROM email_verifications WHERE " + check + " AND digest = ?)").bind(campaign.id, email, ...args, digest);
  const consume = db.prepare("DELETE FROM email_verifications WHERE " + check + " AND digest = ?").bind(...args, digest);
  const [, removed, verified] = await db.batch([attempt, remove, consume]);
  if (!verified.meta.changes) return json({ error: "認証コードが違うか、期限が切れています。最新のメールをご確認ください。" }, 422);
  if (!removed.meta.changes) return json({ error: "キャンセル可能な無料予約がありません。決済案内の準備後で未払いの場合はお問い合わせください。" }, 409);
  const confirmationSent = await sendMail(env,email,"【touchCD】無料予約キャンセル完了","作品："+campaign.title+"\n無料予約をキャンセルしました。お支払いは発生していません。","reservation-cancel/"+verificationId);
  return json({ cancelled: true, confirmationSent });
}

async function lookupReservations(request, env, campaign) {
  if (campaign.demo || !env.DB || !mailReady(env)) return json({error:"現在予約確認を利用できません。"},503);
  const body=await readBody(request),email=asEmail(body?.email),{verificationId,code}=body||{};
  if(!validEmail(email)||!uuidLike(verificationId)||typeof code!=="string"||!/^\d{6}$/.test(code))return json({error:"メールアドレスと6桁の認証コードをご確認ください。"},400);
  const db=env.DB,digest=await emailDigest(env,["lookup",campaign.id,verificationId,email,code]);
  const check="id = ? AND campaign_id = ? AND email = ? AND expires_at > unixepoch('subsec') * 1000 AND attempts < 5";
  const args=[verificationId,campaign.id,email];
  const attempt=db.prepare("UPDATE email_verifications SET attempts=attempts+1 WHERE "+check+" AND digest<>?").bind(...args,digest);
  const select=db.prepare("SELECT r.quantity,r.paid,r.fulfillment,r.shipping_fee,r.pickup_at,o.unit_price,o.deadline,o.token,o.guide_sent_at,f.status AS refund_status,a.outcome,d.status AS delivery_change_status,d.deadline AS delivery_deadline,d.token AS delivery_token,d.sent_at AS delivery_sent_at FROM reservations r LEFT JOIN stripe_orders o ON o.reservation_id=r.id LEFT JOIN automation_refunds f ON f.reservation_id=r.id LEFT JOIN automation_campaigns a ON a.campaign_id=r.campaign_id LEFT JOIN delivery_changes d ON d.reservation_id=r.id WHERE r.campaign_id=? AND r.email=? AND EXISTS (SELECT 1 FROM email_verifications WHERE "+check+" AND digest=?) ORDER BY r.created_at DESC LIMIT 100").bind(campaign.id,email,...args,digest);
  const consume=db.prepare("DELETE FROM email_verifications WHERE "+check+" AND digest=?").bind(...args,digest);
  const [,rows,verified]=await db.batch([attempt,select,consume]);
  if(!verified.meta.changes)return json({error:"認証コードが違うか、有効期限が切れています。"},422);
  const now=Date.now()/1000;
  return json({reservations:rows.results.map(r=>{
    const eligible=!r.outcome&&!r.paid&&stripeReady(env)&&r.guide_sent_at&&r.deadline>now&&/^[a-f0-9-]{72}$/.test(r.token||"");
    return {quantity:r.quantity,fulfillment:r.fulfillment,paid:Boolean(r.paid),received:Boolean(r.pickup_at),total:r.unit_price==null?null:r.unit_price*r.quantity+r.shipping_fee,deadline:r.deadline?new Date(r.deadline*1000).toISOString():null,deliveryChangeStatus:r.delivery_change_status||null,deliveryPaymentPath:r.paid&&r.delivery_change_status==="issued"&&r.delivery_sent_at&&r.delivery_deadline>now&&/^[a-f0-9-]{72}$/.test(r.delivery_token||"")?"/delivery-payment/"+r.delivery_token:null,status:r.refund_status==="succeeded"?"返金済み":r.outcome==="failed"?(r.paid?"製造不成立・返金対応中":"製造不成立"):r.paid?(r.pickup_at?(r.fulfillment==="shipping"?"発送済み":"受取済み"):"入金済み"):r.deadline&&r.deadline<=now?"支払期限終了":eligible?"お支払い受付中":"支払い案内待ち",paymentPath:eligible?"/payment/"+r.token:null};
  })});
}

async function saveSettings(request, db, campaign) {
  const body = await readBody(request);
  const goal = body?.reservation_goal;
  const paidGoal = body?.paid_goal;
  const capacity = body?.capacity;
  const offlineReserved = body?.offline_reserved;
  const offlinePaid = body?.offline_paid;
  if (![goal, paidGoal, capacity, offlineReserved, offlinePaid].every(Number.isInteger) ||
      paidGoal < 1 || goal < paidGoal || capacity < goal || capacity > 10000 ||
      offlinePaid < 0 || offlineReserved < offlinePaid || offlineReserved > capacity) {
    return json({ error: "入金目標 ≤ 無料予約目標 ≤ 予約上限の順に設定してください。外部入金数は外部予約数以下にしてください。" }, 400);
  }
  const result = await db.prepare(`
    INSERT INTO campaign_settings (campaign_id, reservation_goal, paid_goal, capacity, offline_reserved, offline_paid)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE ? = 1 OR (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ?) + ? <= ?
    ON CONFLICT(campaign_id) DO UPDATE SET reservation_goal = excluded.reservation_goal,
      paid_goal = excluded.paid_goal, capacity = excluded.capacity, offline_reserved = excluded.offline_reserved,
      offline_paid = excluded.offline_paid
  `).bind(campaign.id, goal, paidGoal, capacity, offlineReserved, offlinePaid, Number(isIzumiCampaign(campaign)), campaign.id, offlineReserved, capacity).run();
  return result.meta.changes ? json({ saved: true }) : json({ error: "既存の予約数を下回る上限には変更できません。" }, 409);
}

async function editReservation(request, env, campaign, verifiedStripe = false) {
  const body = await readBody(request);
  const { id, quantity, paid } = body || {};
  if (!uuidLike(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 5 || typeof paid !== "boolean") {
    return json({ error: "予約内容をご確認ください。" }, 400);
  }
  const db = env.DB;
  const entry = await db.prepare("SELECT name, fulfillment, shipping_fee FROM reservations WHERE id = ? AND campaign_id = ?").bind(id, campaign.id).first();
  if (!entry) return json({ error: "予約が見つかりません。" }, 404);
  const receiptId = crypto.randomUUID();
  const updated = db.prepare(`
    UPDATE reservations SET quantity = ?, paid = ?, payment_url = CASE WHEN quantity = ? THEN payment_url ELSE '' END, paid_receipt_id = CASE
      WHEN ? = 0 THEN NULL
      WHEN email_verified_at IS NOT NULL THEN COALESCE(paid_receipt_id, ?)
      ELSE NULL END
    WHERE campaign_id = ? AND id = ? AND pickup_at IS NULL AND (NOT EXISTS (SELECT 1 FROM stripe_orders WHERE reservation_id = reservations.id) OR ? = 1) AND (paid = 0 OR ? = 0 OR quantity = ?) AND (? = 1 OR
      (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ? AND id <> ?) + ? +
      COALESCE((SELECT offline_reserved FROM campaign_settings WHERE campaign_id = ?), 0) <=
      COALESCE((SELECT capacity FROM campaign_settings WHERE campaign_id = ?), ?))
  `).bind(quantity, Number(paid), quantity, Number(paid), receiptId, campaign.id, id, Number(verifiedStripe), Number(paid), quantity, Number(isIzumiCampaign(campaign)),
    campaign.id, id, quantity, campaign.id, campaign.id, defaults(campaign).capacity);
  const allocate = db.prepare(`
    INSERT INTO pickup_numbers (reservation_id, campaign_id, number)
    SELECT r.id, r.campaign_id, COALESCE((SELECT MAX(n.number) FROM pickup_numbers n WHERE n.campaign_id = r.campaign_id), 0) + 1
    FROM reservations r WHERE r.id = ? AND r.campaign_id = ? AND r.paid = 1 AND r.fulfillment = 'pickup'
    AND r.paid_receipt_id = ?
    ON CONFLICT(reservation_id) DO NOTHING
  `).bind(id, campaign.id, receiptId);
  const queued = db.prepare(`
    INSERT INTO payment_receipts (id, reservation_id, message, created_at)
    SELECT ?, r.id, CASE WHEN r.fulfillment = 'pickup' THEN REPLACE(?, '受取コード：__TOUCHCD_PICKUP_NUMBER__', '受取コード：' || CAST(n.number AS TEXT)) ELSE ? END, ?
    FROM reservations r LEFT JOIN pickup_numbers n ON n.reservation_id = r.id
    WHERE r.id = ? AND r.campaign_id = ? AND r.paid_receipt_id = ?
  `).bind(receiptId, receiptText(campaign, quantity, "__TOUCHCD_PICKUP_NUMBER__", entry), receiptText(campaign, quantity, "", entry), Date.now(), id, campaign.id, receiptId);
  const [result] = await db.batch([updated, allocate, queued]);
  if (!result.meta.changes) return json({ error: "受取済み、上限超過、または入金済みの個数変更に該当します。" }, 409);
  const receipt = paid ? await deliverReceipt(env, campaign, id) : "unavailable";
  return json({ saved: true, receipt });
}

const mediaTypes = {
  "/": "text/html; charset=utf-8",
  "/manage": "text/html; charset=utf-8",
  "/site.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/consultation": "text/html; charset=utf-8",
  "/consultation.css": "text/css; charset=utf-8",
  "/consultation.js": "text/javascript; charset=utf-8",
  "/mockup.js": "text/javascript; charset=utf-8",
  "/consultation-attachments.js": "text/javascript; charset=utf-8",
  "/touchcd-studio-front.webp": "image/webp",
  "/touchcd-studio-removed.webp": "image/webp",
  "/touchcd-music-site-example.webp": "image/webp",
  "/touchcd-studio-back.webp": "image/webp",
  "/touchcd-studio-open.webp": "image/webp",
  "/touchcd-studio-both.webp": "image/webp",
  "/touchcd-jazz-front.webp": "image/webp",
  "/izumi-wada-live.webp": "image/webp",
  "/izumi-jazz-live-flyer.webp": "image/webp",
  "/touchcd-jazz-back.webp": "image/webp",
  "/touchcd-jazz-open.webp": "image/webp",
  "/touchcd-jazz-both.webp": "image/webp",
  "/touchcd-reference-open.webp": "image/webp",
  "/touchcd-reference-front.webp": "image/webp",
  "/manage.js": "text/javascript; charset=utf-8",
  "/cd-keychain.webp": "image/webp",
  "/low-frequency.webp": "image/webp",
};

function assetResponse(request, pathname, asset, status = 200) {
  return new Response(request.method === "HEAD" ? null : typeof asset === "string" ? asset : Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0)), {
    status,
    headers: {
      "Content-Type": mediaTypes[pathname],
      "Cache-Control": pathname.endsWith(".webp") ? "public, max-age=3600" : "no-cache",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https: blob:; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; frame-src " + (pathname === "/consultation" || (pathname === "/" && new URL(request.url).pathname === "/") ? "https://ippuku-event.cdman1106.workers.dev" : "'none'"),
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      ...(pathname === "/manage" ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const { pathname, origin } = url;
  const route = parseRelease(pathname);
  // BEGIN TEMPORARY SANDBOX QA -- no live Stripe credentials, no reservation writes.
  if(pathname.startsWith("/api/sandbox-qa/")&&request.method==="GET"){
    const input=pathname.slice("/api/sandbox-qa/".length);
    if(!/^[a-f0-9]{64}$/.test(input))return json({error:"not found"},404);
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input))),b=>b.toString(16).padStart(2,"0")).join("");
    if(hash!=="641eebfe66ede3a7352b7e79dbf55bb182db7ccb95592732fb513ecdb3dbcfbe")return json({error:"not found"},404);
    const db=env.DB;
    await db.prepare("CREATE TABLE IF NOT EXISTS sandbox_qa_results(id TEXT PRIMARY KEY, stage TEXT, auth_ok INTEGER DEFAULT 0, checkout_ok INTEGER DEFAULT 0, expired_ok INTEGER DEFAULT 0, payment_ok INTEGER DEFAULT 0, decline_ok INTEGER DEFAULT 0, refund_ok INTEGER DEFAULT 0, methods TEXT, error_code TEXT)").run();
    const claim=await db.prepare("INSERT OR IGNORE INTO sandbox_qa_results(id,stage) VALUES(?,'started')").bind(hash).run();
    if(!claim.meta.changes)return json({error:"already used"},409);
    let stage="key", checkout=null;
    const key=env.STRIPE_TEST_SECRET_KEY;
    const call=async(path,params,idempotency)=>{
      if(typeof key!=="string"||!/^sk_test_/.test(key))throw Error("not_test_key");
      const response=await fetch("https://api.stripe.com/v1/"+path,{method:params?"POST":"GET",headers:{Authorization:"Bearer "+key,...(params?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(idempotency?{"Idempotency-Key":idempotency}:{})},...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(12000)});
      const data=await response.json();
      if(!response.ok){const error=Error("stripe_http_"+response.status);error.stripeCode=data.error?.code;error.stripeParam=data.error?.param;error.stripeType=data.error?.type;error.stripeMessage=String(data.error?.message||"").replace(/(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9_]+/g,"[redacted]");throw error;}
      return data;
    };
    const flag=async(column)=>{await db.prepare("UPDATE sandbox_qa_results SET "+column+"=1 WHERE id=?").bind(hash).run();};
    const unique="touchcd-sandbox-qa-"+hash;
    try{
      if(typeof key!=="string"||!key.startsWith("sk_test_"))throw Error("not_test_key");
      stage="account";
      const account=await call("account");
      if(account.id!=="acct_1UdUvZFZj6W6MV5A")throw Error("wrong_sandbox_account");
      await flag("auth_ok");
      stage="checkout";
      checkout=await call("checkout/sessions",{mode:"payment","excluded_payment_method_types[0]":"konbini","line_items[0][price_data][currency]":"jpy","line_items[0][price_data][unit_amount]":"3000","line_items[0][price_data][product_data][name]":"touchCD SANDBOX TEST","line_items[0][quantity]":"1","line_items[1][price_data][currency]":"jpy","line_items[1][price_data][unit_amount]":"500","line_items[1][price_data][product_data][name]":"TEST shipping","line_items[1][quantity]":"1",success_url:stripeOrigin+"/",cancel_url:stripeOrigin+"/","adaptive_pricing[enabled]":"false",expires_at:String(Math.floor(Date.now()/1000)+1860),"metadata[touchcd_qa]":"sandbox"},unique+"-checkout");
      if(checkout.livemode!==false||checkout.amount_total!==3500||checkout.currency!=="jpy"||checkout.status!=="open"||checkout.payment_status!=="unpaid")throw Error("checkout_mismatch");
      await flag("checkout_ok");
      await db.prepare("UPDATE sandbox_qa_results SET methods=? WHERE id=?").bind(JSON.stringify(checkout.payment_method_types),hash).run();
      stage="expiry";
      const expired=await call("checkout/sessions/"+encodeURIComponent(checkout.id)+"/expire",{},unique+"-expire");
      if(expired.livemode!==false||expired.status!=="expired"||expired.payment_status!=="unpaid")throw Error("expiry_mismatch");
      await flag("expired_ok");
      stage="payment";
      const payment=await call("payment_intents",{amount:"3500",currency:"jpy","payment_method_types[0]":"card",payment_method:"pm_card_visa",confirm:"true",return_url:stripeOrigin+"/",description:"touchCD sandbox QA; no real money","metadata[touchcd_qa]":"sandbox"},unique+"-pay");
      if(payment.livemode!==false||payment.status!=="succeeded"||payment.amount_received!==3500||payment.currency!=="jpy")throw Error("payment_mismatch");
      await flag("payment_ok");
      stage="refund";
      const refund=await call("refunds",{payment_intent:payment.id,amount:"3500","metadata[touchcd_qa]":"sandbox"},unique+"-refund");
      if(refund.livemode!==false||refund.payment_intent!==payment.id||refund.amount!==3500||refund.currency!=="jpy"||refund.status!=="succeeded")throw Error("refund_mismatch");
      const charge=await call("charges/"+encodeURIComponent(payment.latest_charge));
      if(charge.livemode!==false||!charge.refunded||charge.amount_refunded!==3500)throw Error("refund_reconcile_mismatch");
      await flag("refund_ok");
      stage="decline";
      let declined=false;
      try{await call("payment_intents",{amount:"3500",currency:"jpy","payment_method_types[0]":"card",payment_method:"pm_card_chargeDeclined",confirm:"true",return_url:stripeOrigin+"/",description:"touchCD sandbox decline QA"},unique+"-decline");}catch(e){if(e.stripeCode==="card_declined")declined=true;else throw e;}
      if(!declined)throw Error("decline_not_detected");
      await flag("decline_ok");
      await db.prepare("UPDATE sandbox_qa_results SET stage='complete' WHERE id=?").bind(hash).run();
      return json({complete:true,live_charge:0});
    }catch(e){
      if(checkout?.livemode===false&&stage==="checkout"){try{await call("checkout/sessions/"+encodeURIComponent(checkout.id)+"/expire",{},unique+"-expire");}catch{}}
      await db.prepare("UPDATE sandbox_qa_results SET stage=?,error_code=? WHERE id=?").bind(stage,[e.stripeCode||e.message,e.stripeType,e.stripeParam,e.stripeMessage].filter(Boolean).join(" / ").slice(0,400),hash).run();
      return json({error:"sandbox test stopped",stage},503);
    }
  }
  // END TEMPORARY SANDBOX QA
  if (pathname === "/api/stripe/webhook" && request.method === "POST") return stripeWebhook(request,env);
  const deliveryInvite=pathname.match(/^\/delivery-payment\/([a-f0-9-]{72})$/);
  if(deliveryInvite)return startDeliveryCheckout(request,env,deliveryInvite[1]);
  const invite = pathname.match(/^\/payment\/([a-f0-9-]{72})$/);
  if (invite) return startStripeCheckout(request,env,invite[1]);
  if (["GET", "HEAD"].includes(request.method)) {
    if (pathname === "/tokushoho") return assetResponse(request, "/", commerceDisclosure(request, env));
    if (pathname === "/pickup-example") return assetResponse(request, "/", pickupExample(request));
    if (["/preview/izumi-wada", "/works/izumi-wada"].includes(pathname)) {
      const campaign = await findCampaign(env, { id: izumiCampaignId });
      return assetResponse(request, "/", izumiWadaPreview(request, campaign ? await publicData(env, campaign) : null));
    }
    if (["/preview/izumi-wada/artist", "/works/izumi-wada/artist"].includes(pathname)) return assetResponse(request, "/", izumiStoryPage(request, "artist"));
    if (["/preview/izumi-wada/making", "/works/izumi-wada/making"].includes(pathname)) return assetResponse(request, "/", izumiStoryPage(request, "making"));
    if (pathname === "/") {
      const rows = await catalog(env);
      const real = rows.filter((project) => !project.demo);
      const visible = real.length ? real : rows;
      return assetResponse(request, "/", home(request, await Promise.all(visible.map((p) => publicData(env, p)))));
    }
    if (route) {
      if (route.project) {
        const project = await findCampaign(env, route);
        if (project) return assetResponse(request, "/", isIzumiCampaign(project) ? izumiWadaPreview(request, await publicData(env, project)) : projectPage(request, await publicData(env, project)));
      } else {
        const rows = await catalog(env, route.artist);
        if (rows.length) return assetResponse(request, "/", artistPage(request, await Promise.all(rows.map((p) => publicData(env, p)))));
      }
      return assetResponse(request, "/", notFound(request), 404);
    }
    if (Object.hasOwn(mediaTypes, pathname)) return assetResponse(request, pathname, siteAssets[pathname]);
  }
  if (!pathname.startsWith("/api/")) return assetResponse(request, "/", notFound(request), 404);
  if (request.method !== "GET" && request.headers.get("Origin") !== origin) return json({ error: "操作を確認できません。" }, 403);
  if (pathname === "/api/consultation" && request.method === "POST") return submitConsultation(request, env);
  if (pathname === "/api/admin-login/request" && request.method === "POST") return requestAdminCode(request,env);
  if (pathname === "/api/admin-login/verify" && request.method === "POST") return verifyAdminCode(request,env);
  if (pathname === "/api/admin-login/logout" && request.method === "POST") {
    if (env.DB && mailReady(env)) {
      const token = (request.headers.get("Authorization") || "").slice(7);
      if (/^[a-f0-9-]{72}$/.test(token)) await env.DB.prepare("DELETE FROM admin_sessions WHERE digest = ?").bind(await emailDigest(env,["admin-session",token])).run();
    }
    return json({loggedOut:true});
  }
  const artist = url.searchParams.get("artist");
  const project = url.searchParams.get("project");
  const id = url.searchParams.get("id");
  if ((pathname === "/api/campaign" && request.method === "GET") ||
      (["/api/reservations", "/api/verify-email", "/api/cancel-code", "/api/cancel-reservation", "/api/lookup-code", "/api/lookup-reservations"].includes(pathname) && request.method === "POST")) {
    const campaign = await findCampaign(env, { artist, project });
    if (!campaign) return json({ error: "作品が見つかりません。" }, 404);
    if (pathname === "/api/campaign") return json(await publicData(env, campaign));
    if (pathname === "/api/verify-email") return startVerification(request, env, campaign);
    if (pathname === "/api/lookup-code") return startVerification(request, env, campaign, false, true);
    if (pathname === "/api/lookup-reservations") return lookupReservations(request, env, campaign);
    if (pathname === "/api/cancel-code") return startVerification(request, env, campaign, true);
    if (pathname === "/api/cancel-reservation") return cancelReservation(request, env, campaign);
    return reserve(request, env, campaign);
  }

  if (pathname.startsWith("/api/manage/")) {
    const previewAccess = env.PREVIEW_DEMO_ADMIN === "1" && env.RESERVATIONS_OPEN !== "1";
    if (!previewAccess && !(await authorized(request, env))) return json({ error: "管理キーを確認してください。" }, 401);
    if (!env.DB) return json({ error: "予約データベースの接続が必要です。" }, 503);
    if (pathname === "/api/manage/projects") {
      if (request.method === "GET") return json({ projects: await catalog(env, null, true), intakeEnabled: intakeOpen(env), mailConfigured: mailReady(env) });
      if (request.method === "PUT") return saveProject(request, env);
    }
    const campaign = await findCampaign(env, { id }, true);
    if (!campaign) return json({ error: "作品が見つかりません。" }, 404);
    if (pathname === "/api/manage/automation" && request.method === "PUT") {if(previewAccess)return json({error:"本番管理画面で設定してください。"},403);return saveAutomation(request,env,campaign);}
    const lifecycle=await automationState(env.DB,campaign.id);
    if(lifecycle?.outcome && request.method==="PUT" && ["/api/manage/payment-settings","/api/manage/settings","/api/manage/reservation","/api/manage/stripe-guide","/api/manage/payment-link"].includes(pathname))return json({error:"製造判定済みのため変更できません。"},409);
    if(lifecycle?.outcome==="failed"&&["/api/manage/pickup","/api/manage/shipped","/api/manage/payment-receipt"].includes(pathname))return json({error:"製造不成立の企画です。"},409);
    if (pathname === "/api/manage/settings" && request.method === "GET") {
      const [settings, data, paymentSettings, entries] = await Promise.all([
        getSettings(env.DB, campaign), publicData(env, campaign), getPaymentSettings(env.DB, campaign),
        env.DB.prepare(`SELECT r.id, r.name, r.email, r.quantity, r.paid, r.created_at, r.email_verified_at,
          r.pickup_at, r.paid_receipt_id, r.payment_url, r.fulfillment, r.shipping_fee, r.postal_code,
          r.shipping_address, dc.status AS delivery_change_status, dc.sent_at AS delivery_change_sent_at, dc.paid_at AS delivery_change_paid_at, dc.shipping_name AS delivery_shipping_name, dc.amount AS delivery_change_amount, rf.status AS refund_status, rf.amount AS refund_amount, p.sent_at AS receipt_sent_at, n.number AS pickup_number, so.guide_sent_at AS stripe_guide_sent_at, CASE WHEN so.reservation_id IS NULL THEN 0 ELSE 1 END AS stripe_managed FROM reservations r
          LEFT JOIN payment_receipts p ON p.id = r.paid_receipt_id
          LEFT JOIN pickup_numbers n ON n.reservation_id = r.id
          LEFT JOIN stripe_orders so ON so.reservation_id = r.id
          LEFT JOIN delivery_changes dc ON dc.reservation_id = r.id
          LEFT JOIN automation_refunds rf ON rf.reservation_id = r.id
          WHERE r.campaign_id = ? ORDER BY r.created_at DESC`).bind(campaign.id).all(),
      ]);
      return json({ settings, data, paymentSettings, automation:await automationOverview(env.DB,campaign.id), stripeConfigured:stripeReady(env), reservations: entries.results.map((entry) => ({ ...entry, pickup_code: entry.paid && entry.fulfillment === "pickup" ? String(entry.pickup_number ?? pickupCode(entry.id)) : null })) });
    }
    if (pathname === "/api/manage/payment-settings" && request.method === "PUT") return savePaymentSettings(request, env.DB, campaign);
    if (pathname === "/api/manage/delivery-change" && request.method === "PUT") {if(previewAccess)return json({error:"本番管理画面で操作してください。"},403);return issueDeliveryChange(request,env,campaign);}
    if (pathname === "/api/manage/stripe-guide" && request.method === "PUT") return issueStripeGuide(request,env,campaign);
    if (pathname === "/api/manage/payment-link" && request.method === "PUT") return savePaymentLink(request, env.DB, campaign);
    if (pathname === "/api/manage/payment-guide" && request.method === "POST") return draftPaymentGuide(request, env, campaign);
    if (pathname === "/api/manage/settings" && request.method === "PUT") return saveSettings(request, env.DB, campaign);
    if (pathname === "/api/manage/reservation" && request.method === "PUT") return editReservation(request, env, campaign);
    if (pathname === "/api/manage/pickup" && request.method === "PUT") return markPickedUp(request, env.DB, campaign);
    if (pathname === "/api/manage/shipped" && request.method === "PUT") return markShipped(request, env, campaign);
    if (pathname === "/api/manage/payment-receipt" && request.method === "PUT") {
      const body = await readBody(request);
      if (!uuidLike(body?.id)) return json({ error: "予約番号をご確認ください。" }, 400);
      const receipt = await deliverReceipt(env, campaign, body.id);
      if (receipt === "sent") return json({ receipt });
      return json({ error: receipt === "pending" ? "メールを送信できませんでした。配信設定を確認してから再試行してください。" :
        "送信待ちの支払い完了メールはありません。" }, 409);
    }
  }
  return json({ error: "ページが見つかりません。" }, 404);
}

const migrationLedger = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
const verifiedDatabases = new WeakSet();

async function initializeEmptyDatabase(db) {
  const existing = await db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') LIMIT 1`).bind().first();
  if (existing) return false;
  // All statements are idempotent, so simultaneous first requests can safely race.
  await db.batch([
    db.prepare(migrationLedger).bind(),
    ...initialSchema.map((sql) => db.prepare(sql).bind()),
    ...initialMigrations.map((name) => db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(name)),
  ]);
  return true;
}

async function ensureReleaseDetails(db) {
  if (verifiedDatabases.has(db)) { await ensureAutomation(db); return; }
  const ledger = await db.prepare("SELECT name FROM sqlite_schema WHERE name = 'd1_migrations'").bind().first();
  const applied = ledger && await db.prepare("SELECT name FROM d1_migrations WHERE name = ?").bind(releaseMigration).first();
  if (!applied && !(await initializeEmptyDatabase(db))) {
    for (let attempt = 0; ; attempt++) {
      const [projects, reservations] = await Promise.all([
        db.prepare("PRAGMA table_info(projects)").all(),
        db.prepare("PRAGMA table_info(reservations)").all(),
      ]);
      const columns = {
        projects: new Set(projects.results.map(({ name }) => name)),
        reservations: new Set(reservations.results.map(({ name }) => name)),
      };
      const pending = releaseColumns.filter(({ table, column }) => !columns[table].has(column));
      try {
        await db.batch([
          db.prepare(migrationLedger).bind(),
          ...pending.map(({ sql }) => db.prepare(sql).bind()),
          db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(releaseMigration),
        ]);
        break;
      } catch (error) {
        // Another request may have applied the migration after the schema read.
        if (attempt > 0 || !/duplicate column name/i.test(error.message)) throw error;
      }
    }
  }
  await ensureAutomation(db);
  verifiedDatabases.add(db);
}

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(runPaymentAutomation(env));},
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      if (env.DB && (pathname === "/" || pathname.startsWith("/artists/") || pathname.startsWith("/works/") || pathname.startsWith("/preview/") || pathname.startsWith("/payment/") || pathname.startsWith("/delivery-payment/") || pathname.startsWith("/api/"))) {
        await ensureReleaseDetails(env.DB);
      }
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Request failed", error instanceof Error ? error.name : "Unknown error");
      return json({ error: "一時的に利用できません。時間をおいてお試しください。" }, 503);
    }
  },
};
