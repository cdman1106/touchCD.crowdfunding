const codeLifetimeMs = 10 * 60_000;
const resendDelayMs = 60_000;
const pickupCode = (id) => id.replaceAll("-", "").slice(0, 12).toUpperCase().match(/.{1,4}/g).join("-");
const asEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const validEmail = (email) => email.length <= 254 && /^[^\s\x00-\x1f\x7f@,<>]+@[^\s\x00-\x1f\x7f@,<>]+\.[^\s\x00-\x1f\x7f@,<>]+$/.test(email);
const uuidLike = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function mailReady(env) {
  if (!(env.EMAIL_VERIFICATION_SECRET?.length >= 32)) return false;
  if (env.MAIL_PROVIDER === "gmail") {
    return Boolean(validEmail(asEmail(env.GMAIL_FROM)) && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
  }
  if (env.MAIL_PROVIDER === "cloudflare") {
    return Boolean(env.EMAIL && validEmail(asEmail(env.MAIL_FROM)));
  }
  return Boolean((!env.MAIL_PROVIDER || env.MAIL_PROVIDER === "resend") && env.RESEND_API_KEY && env.MAIL_FROM);
}
const intakeOpen = (env) => env.RESERVATIONS_OPEN === "1" && mailReady(env);
const bookingOpen = (env, campaign) => Boolean(env.DB && intakeOpen(env) && campaign.reservationOpen && Date.now() < campaign.closesAt);

async function emailDigest(env, values) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.EMAIL_VERIFICATION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(values)));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomCode() {
  const random = new Uint32Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= 4_294_000_000);
  return String(random[0] % 1_000_000).padStart(6, "0");
}

async function sendMail(env, to, subject, body, idempotencyKey, replyTo = "", attachments = []) {
  if (!mailReady(env)) return false;
  try {
    if (env.MAIL_PROVIDER === "gmail") return await sendGmail(env, to, subject, body, idempotencyKey, replyTo, attachments);
    if (env.MAIL_PROVIDER === "cloudflare") {
      await env.EMAIL.send({
        from: env.MAIL_FROM,
        to,
        subject,
        text: body,
        ...(replyTo ? { replyTo } : {}),
        ...(attachments.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content, type: "image/jpeg", disposition: "attachment" })) } : {}),
      });
      return true;
    }
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text: body, ...(replyTo ? { reply_to: replyTo } : {}), ...(attachments.length ? { attachments: attachments.map(a=>({filename:a.filename,content:a.content})) } : {}) }),
      signal: AbortSignal.timeout(6500),
    });
    if (!result.ok) console.warn("Mail provider response", result.status);
    return result.ok;
  } catch {
    console.warn("Mail provider unavailable");
    return false;
  }
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);
}

function encodedSubject(subject) {
  const characters = Array.from(subject);
  const chunks = [];
  for (let i = 0; i < characters.length; i += 10) {
    chunks.push("=?UTF-8?B?" + base64Utf8(characters.slice(i, i + 10).join("")) + "?=");
  }
  return chunks.join("\r\n ");
}

function gmailMessage(from, to, subject, body, messageKey, replyTo = "", attachments = []) {
  const [type, id] = messageKey.split("/");
  const headers = [
    `From: touchCD <${from}>`,
    `To: <${to}>`,
    ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
    `Subject: ${encodedSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${type}.${id}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
  ];
  const wrap = value => (value.match(/.{1,76}/g)||[]).join("\r\n");
  const plain = ["Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",wrap(base64Utf8(body))].join("\r\n");
  const boundary = "touchCD-"+id;
  const message = attachments.length
    ? [...headers,'Content-Type: multipart/mixed; boundary="'+boundary+'"',"","--"+boundary,plain,...attachments.flatMap(a=>["--"+boundary,'Content-Type: image/jpeg; name="'+a.filename+'"',"Content-Transfer-Encoding: base64",'Content-Disposition: attachment; filename="'+a.filename+'"',"",wrap(a.content)]),"--"+boundary+"--",""].join("\r\n")
    : [...headers,plain].join("\r\n");
  return base64Utf8(message).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sendGmail(env, to, subject, body, messageKey, replyTo = "", attachments = []) {
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!token.ok) {
    console.warn("Gmail token response", token.status);
    return false;
  }
  const { access_token: accessToken } = await token.json();
  if (typeof accessToken !== "string" || !accessToken) return false;
  const from = asEmail(env.GMAIL_FROM);
  const result = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(from)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: gmailMessage(from, to, subject, body, messageKey, replyTo, attachments) }),
    signal: AbortSignal.timeout(6500),
  });
  if (!result.ok) console.warn("Gmail send response", result.status);
  return result.ok;
}

function throttle(db, key, now, window, limit) {
  return db.prepare(`
    INSERT INTO email_rate_limits (scope_key, expires_at, count) VALUES (?, ?, 1)
    ON CONFLICT(scope_key) DO UPDATE SET
      count = CASE WHEN email_rate_limits.expires_at <= ? THEN 1 ELSE email_rate_limits.count + 1 END,
      expires_at = CASE WHEN email_rate_limits.expires_at <= ? THEN excluded.expires_at ELSE email_rate_limits.expires_at END
    WHERE email_rate_limits.expires_at <= ? OR email_rate_limits.count < ?
  `).bind(key, now + window, now, now, now, limit);
}

async function startVerification(request, env, campaign, cancel = false) {
  if (campaign.demo || (cancel ? !env.DB || !mailReady(env) : !bookingOpen(env, campaign))) return json({ error: "現在、予約を受け付けていません。" }, 409);
  const body = await readBody(request);
  const email = asEmail(body?.email);
  if (!validEmail(email)) return json({ error: "メールアドレスをご確認ください。" }, 400);
  const { reserved, capacity, unlimited } = await publicData(env, campaign);
  if (!cancel && !unlimited && reserved >= capacity) return json({ error: "予定数に達しました。" }, 409);
  const now = Date.now();
  const id = crypto.randomUUID();
  const code = randomCode();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const [digest, addressKey, ipKey] = await Promise.all([
    emailDigest(env, cancel ? ["cancel", campaign.id, id, email, code] : [campaign.id, id, email, code]),
    emailDigest(env, ["email", email]),
    emailDigest(env, ["ip", ip]),
  ]);

  const ipWindow = await throttle(env.DB, ipKey, now, 15 * 60_000, 45).run();
  if (!ipWindow.meta.changes) return json({ error: "送信回数が上限に達しました。時間をおいてお試しください。" }, 429);
  const addressWindow = await throttle(env.DB, addressKey, now, 60 * 60_000, 5).run();
  if (!addressWindow.meta.changes) return json({ error: "送信回数が上限に達しました。時間をおいてお試しください。" }, 429);
  // Bounded cleanup avoids retaining expired codes and stale rate-limit keys.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_rate_limits WHERE scope_key IN (SELECT scope_key FROM email_rate_limits WHERE expires_at <= ? LIMIT 50)").bind(now),
    env.DB.prepare("DELETE FROM email_verifications WHERE id IN (SELECT id FROM email_verifications WHERE expires_at <= ? LIMIT 50)").bind(now),
  ]);
  const issued = await env.DB.prepare(`
    INSERT INTO email_verifications (id, campaign_id, email, digest, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, email) DO UPDATE SET id = excluded.id, digest = excluded.digest,
      issued_at = excluded.issued_at, expires_at = excluded.expires_at, attempts = 0
    WHERE email_verifications.issued_at <= ?
  `).bind(id, campaign.id, email, digest, now, now + codeLifetimeMs, now - resendDelayMs).run();
  if (!issued.meta.changes) return json({ error: "続けて送る場合は、約1分お待ちください。" }, 429);
  const sent = await sendMail(env, email, cancel ? "【touchCD】無料予約キャンセルの認証コード" : "【touchCD】予約のメール認証コード",
    [`認証コード：${code}`, cancel ? "キャンセル画面にこの6桁を入力してください。有効期限は10分です。" : "予約画面にこの6桁を入力してください。有効期限は10分です。", "心当たりがない場合は、このメールを破棄してください。"].join("\n\n"), `verification/${id}`);
  if (!sent) {
    await env.DB.prepare("DELETE FROM email_verifications WHERE id = ?").bind(id).run();
    return json({ error: "認証メールを送れませんでした。少し時間をおいてお試しください。" }, 503);
  }
  return json({ verificationId: id });
}

function receiptText(campaign, quantity, code, entry = {}) {
  const shipping = entry.fulfillment === "shipping";
  const delivery = shipping
    ? [`受取方法：自宅配送（送料 ${amount(entry.shipping_fee)}）`, `発送案内：${campaign.shippingNote || "製造成立後にご案内します。"}`]
    : ["製造が決まった場合、当日は受付でこのメールをお見せください。", `受取コード：${code}`, `受取案内：${campaign.pickup}`];
  return [
    "お支払いを確認しました。",

    `作品：${campaign.title} / ${campaign.artist}`,
    `個数：${quantity}個`,
    `お支払い金額：${amount(campaign.price * quantity + (entry.shipping_fee || 0))}（税込）`,
    ...delivery,
    "製造条件を満たさなかった場合は、別途返金をご案内します。",
    "touchCD",
  ].join("\n");
}

async function deliverReceipt(env, campaign, id) {
  const db = env.DB;
  const receipt = await db.prepare(`
    SELECT p.id, p.message, p.sent_at, r.email, r.fulfillment FROM reservations r
    JOIN payment_receipts p ON p.id = r.paid_receipt_id
    WHERE r.id = ? AND r.campaign_id = ? AND r.paid = 1
  `).bind(id, campaign.id).first();
  if (!receipt) return "unavailable";
  if (receipt.sent_at) return "sent";
  if (!mailReady(env)) return "pending";
  const method = receipt.fulfillment === "shipping" ? "自宅配送" : "会場受取";
  const delivered = await sendMail(env, receipt.email, `【touchCD】お支払い完了・${method}のご案内`,
    receipt.message, `paid-receipt/${receipt.id}`);
  if (!delivered) return "pending";
  await db.prepare("UPDATE payment_receipts SET sent_at = ? WHERE id = ? AND sent_at IS NULL")
    .bind(new Date().toISOString(), receipt.id).run();
  return "sent";
}

async function markPickedUp(request, db, campaign) {
  const form = await readBody(request);
  if (!uuidLike(form?.id) || typeof form.code !== "string" ||
      form.code.replaceAll("-", "").toUpperCase().trim() !== pickupCode(form.id).replaceAll("-", "")) {
    return json({ error: "受取コードをご確認ください。" }, 400);
  }
  const result = await db.prepare(`
    UPDATE reservations SET pickup_at = ?
    WHERE id = ? AND campaign_id = ? AND paid = 1 AND pickup_at IS NULL AND fulfillment = 'pickup'
  `).bind(new Date().toISOString(), form.id, campaign.id).run();
  return result.meta.changes ? json({ saved: true }) : json({ error: "受取済み、入金未確認、または予約が見つかりません。" }, 409);
}

async function markShipped(request, env, campaign) {
  const form = await readBody(request);
  if (!uuidLike(form?.id)) return json({ error: "予約番号をご確認ください。" }, 400);
  const result = await env.DB.prepare(`
    UPDATE reservations SET pickup_at = ?
    WHERE id = ? AND campaign_id = ? AND paid = 1 AND pickup_at IS NULL AND fulfillment = 'shipping'
      AND (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ? AND paid = 1)
        + COALESCE((SELECT offline_paid FROM campaign_settings WHERE campaign_id = ?), 0)
        >= COALESCE((SELECT paid_goal FROM campaign_settings WHERE campaign_id = ?), ?)
  `).bind(new Date().toISOString(), form.id, campaign.id, campaign.id, campaign.id, campaign.id, defaults(campaign).paid_goal).run();
  return result.meta.changes ? json({ saved: true }) :
    json({ error: "入金済みの配送注文は、製造成立後に一度だけ発送済みを記録できます。" }, 409);
}


async function submitConsultation(request, env) {
  const form = await readBody(request, 5800000);
  const artist = typeof form?.artist === "string" ? form.artist.trim() : "";
  const email = asEmail(form?.email);
  const summary = typeof form?.summary === "string" ? form.summary.trim() : "";
  const safeReply = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email) && !email.includes("..");
  if (!artist || artist.length > 80 || /[\x00-\x1f\x7f]/.test(artist) ||
      !validEmail(email) || !safeReply || !summary || summary.length > 12000 ||
      form?.consent !== true || form?.website !== "") {
    return json({ error: "アーティスト名・メールアドレス・送信内容・同意をご確認ください。内容が長すぎる場合は短くしてお試しください。" }, 400);
  }
  const attachments = form.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 8 || attachments.some(a => !a || typeof a.filename !== "string" || !/^(?:jacket|disc|back|inner|tray|reference-[1-8]|touchCD-preview)\.jpg$/.test(a.filename) || typeof a.content !== "string" || a.content.length > 670000 || !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(a.content) || a.content.length % 4 !== 0) || new Set(attachments.map(a=>a.filename)).size!==attachments.length || attachments.reduce((n,a)=>n+a.content.length,0)>5600000) return json({error:"添付画像の形式・枚数・サイズをご確認ください。"},400);
  if (!env.DB || !mailReady(env)) return json({ error: "現在、相談フォームを利用できません。相談内容をコピーして cdman1106@gmail.com へ直接ご連絡ください。" }, 503);
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const [ipKey, addressKey, globalKey] = await Promise.all([
    emailDigest(env, ["consultation", "ip", ip]),
    emailDigest(env, ["consultation", "email", email]),
    emailDigest(env, ["consultation", "global"]),
  ]);
  for (const [key, window, limit] of [[ipKey, 15 * 60_000, 5], [addressKey, 60 * 60_000, 3], [globalKey, 24 * 60 * 60_000, 80]]) {
    const result = await throttle(env.DB, key, now, window, limit).run();
    if (!result.meta.changes) return json({ error: "送信回数が上限に達しました。時間をおいてお試しください。" }, 429);
  }
  await env.DB.prepare("DELETE FROM email_rate_limits WHERE scope_key IN (SELECT scope_key FROM email_rate_limits WHERE expires_at <= ? LIMIT 50)").bind(now).run();
  const id = crypto.randomUUID();
  const body = ["touchCD 企画相談フォームからのお問い合わせ", "アーティスト名：" + artist, "返信先：" + email, "受付番号：" + id, "", "以下は相談者の入力・選択内容です。", "添付画像："+attachments.length+"枚",summary].join("\n");
  const sent = await sendMail(env, "cdman1106@gmail.com", "【touchCD】無料企画相談", body, "consultation/" + id, email, attachments);
  return sent ? json({ sent: true, attachmentCount: attachments.length }, 201) : json({ error: "メールを送信できませんでした。時間をおいてお試しください。" }, 503);
}
