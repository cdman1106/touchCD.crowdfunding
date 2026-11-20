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

async function sendMail(env, to, subject, body, idempotencyKey) {
  if (!mailReady(env)) return false;
  try {
    if (env.MAIL_PROVIDER === "gmail") return await sendGmail(env, to, subject, body, idempotencyKey);
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text: body }),
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
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function encodedSubject(subject) {
  const characters = Array.from(subject);
  const chunks = [];
  for (let i = 0; i < characters.length; i += 10) {
    chunks.push("=?UTF-8?B?" + base64Utf8(characters.slice(i, i + 10).join("")) + "?=");
  }
  return chunks.join("\r\n ");
}

function gmailMessage(from, to, subject, body, messageKey) {
  const [type, id] = messageKey.split("/");
  const message = [
    `From: touchCD <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodedSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${type}.${id}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...base64Utf8(body).match(/.{1,76}/g),
  ].join("\r\n");
  return base64Utf8(message).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sendGmail(env, to, subject, body, messageKey) {
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
    body: JSON.stringify({ raw: gmailMessage(from, to, subject, body, messageKey) }),
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

async function startVerification(request, env, campaign) {
  if (campaign.demo || !bookingOpen(env, campaign)) return json({ error: "現在、予約を受け付けていません。" }, 409);
  const body = await readBody(request);
  const email = asEmail(body?.email);
  if (!validEmail(email)) return json({ error: "メールアドレスをご確認ください。" }, 400);
  const { reserved, capacity } = await publicData(env, campaign);
  if (reserved >= capacity) return json({ error: "予定数に達しました。" }, 409);
  const now = Date.now();
  const id = crypto.randomUUID();
  const code = randomCode();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const [digest, addressKey, ipKey] = await Promise.all([
    emailDigest(env, [campaign.id, id, email, code]),
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
  const sent = await sendMail(env, email, "【touchCD】予約のメール認証コード",
    [`認証コード：${code}`, "予約画面にこの6桁を入力してください。有効期限は10分です。", "心当たりがない場合は、このメールを破棄してください。"].join("\n\n"), `verification/${id}`);
  if (!sent) {
    await env.DB.prepare("DELETE FROM email_verifications WHERE id = ?").bind(id).run();
    return json({ error: "認証メールを送れませんでした。少し時間をおいてお試しください。" }, 503);
  }
  return json({ verificationId: id });
}

function receiptText(campaign, quantity, code) {
  return [
    "お支払いを確認しました。",
    "当日は受付でこのメールをお見せください。",
    `受取コード：${code}`,
    `作品：${campaign.title} / ${campaign.artist}`,
    `個数：${quantity}個`,
    `お支払い金額：${amount(campaign.price * quantity)}（税込）`,
    `受取案内：${campaign.pickup}`,
    "製造条件を満たさなかった場合は、別途返金をご案内します。",
    "touchCD",
  ].join("\n");
}

async function deliverReceipt(env, campaign, id) {
  const db = env.DB;
  const receipt = await db.prepare(`
    SELECT p.id, p.message, p.sent_at, r.email FROM reservations r
    JOIN payment_receipts p ON p.id = r.paid_receipt_id
    WHERE r.id = ? AND r.campaign_id = ? AND r.paid = 1
  `).bind(id, campaign.id).first();
  if (!receipt) return "unavailable";
  if (receipt.sent_at) return "sent";
  if (!mailReady(env)) return "pending";
  const delivered = await sendMail(env, receipt.email, "【touchCD】お支払い完了・会場受取のご案内",
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
    WHERE id = ? AND campaign_id = ? AND paid = 1 AND pickup_at IS NULL
  `).bind(new Date().toISOString(), form.id, campaign.id).run();
  return result.meta.changes ? json({ saved: true }) : json({ error: "受取済み、入金未確認、または予約が見つかりません。" }, 409);
}
