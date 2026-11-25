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
  const [settings, counts, payment] = await Promise.all([
    campaign.settings || getSettings(env.DB, campaign),
    campaign.counts || getCounts(env.DB, campaign),
    env.DB && !campaign.counts && !campaign.demo ? getPaymentSettings(env.DB, campaign) : null,
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
    capacity: settings.capacity, reserved, paid, accepting, paymentDeadline: payment?.deadline || "",
  };
  return { ...data, status: statusFor(data) };
}

async function authorized(request, env) {
  const token = env.ADMIN_TOKEN;
  const header = request.headers.get("Authorization") || "";
  if (!token || token.length < 24 || !header.startsWith("Bearer ") || header.length > 1024) return false;
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

async function readBody(request) {
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
    if (size > 18000) {
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
      AND julianday(deadline) > julianday('now') AND price = ? AND (? = 0 OR shipping_fee = ?)
    )) AND
      (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ?) + ? +
      COALESCE((SELECT offline_reserved FROM campaign_settings WHERE campaign_id = ?), 0) <=
      COALESCE((SELECT capacity FROM campaign_settings WHERE campaign_id = ?), ?)
    ON CONFLICT(campaign_id, email) DO NOTHING
  `).bind(id, campaign.id, name, email, quantity, time, time, fulfillment, shipping ? shippingFee : 0, postalCode, shippingAddress,
    verificationId, campaign.id, email, digest, campaign.closesAt, Number(Boolean(campaign.managed)), campaign.id, campaign.price,
    Number(shipping), shippingFee,
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
  return json({ id }, 201);
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
    WHERE (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ?) + ? <= ?
    ON CONFLICT(campaign_id) DO UPDATE SET reservation_goal = excluded.reservation_goal,
      paid_goal = excluded.paid_goal, capacity = excluded.capacity, offline_reserved = excluded.offline_reserved,
      offline_paid = excluded.offline_paid
  `).bind(campaign.id, goal, paidGoal, capacity, offlineReserved, offlinePaid, campaign.id, offlineReserved, capacity).run();
  return result.meta.changes ? json({ saved: true }) : json({ error: "既存の予約数を下回る上限には変更できません。" }, 409);
}

async function editReservation(request, env, campaign) {
  const body = await readBody(request);
  const { id, quantity, paid } = body || {};
  if (!uuidLike(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 5 || typeof paid !== "boolean") {
    return json({ error: "予約内容をご確認ください。" }, 400);
  }
  const db = env.DB;
  const entry = await db.prepare("SELECT fulfillment, shipping_fee FROM reservations WHERE id = ? AND campaign_id = ?").bind(id, campaign.id).first();
  if (!entry) return json({ error: "予約が見つかりません。" }, 404);
  const receiptId = crypto.randomUUID();
  const updated = db.prepare(`
    UPDATE reservations SET quantity = ?, paid = ?, payment_url = CASE WHEN quantity = ? THEN payment_url ELSE '' END, paid_receipt_id = CASE
      WHEN ? = 0 THEN NULL
      WHEN email_verified_at IS NOT NULL THEN COALESCE(paid_receipt_id, ?)
      ELSE NULL END
    WHERE campaign_id = ? AND id = ? AND pickup_at IS NULL AND (paid = 0 OR ? = 0 OR quantity = ?) AND
      (SELECT COALESCE(SUM(quantity), 0) FROM reservations WHERE campaign_id = ? AND id <> ?) + ? +
      COALESCE((SELECT offline_reserved FROM campaign_settings WHERE campaign_id = ?), 0) <=
      COALESCE((SELECT capacity FROM campaign_settings WHERE campaign_id = ?), ?)
  `).bind(quantity, Number(paid), quantity, Number(paid), receiptId, campaign.id, id, Number(paid), quantity,
    campaign.id, id, quantity, campaign.id, campaign.id, defaults(campaign).capacity);
  const queued = db.prepare(`
    INSERT INTO payment_receipts (id, reservation_id, message, created_at)
    SELECT ?, id, ?, ? FROM reservations WHERE id = ? AND campaign_id = ? AND paid_receipt_id = ?
  `).bind(receiptId, receiptText(campaign, quantity, pickupCode(id), entry), Date.now(), id, campaign.id, receiptId);
  const [result] = await db.batch([updated, queued]);
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
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https:; script-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
  if (["GET", "HEAD"].includes(request.method)) {
    if (pathname === "/tokushoho") return assetResponse(request, "/", commerceDisclosure(request, env));
    if (pathname === "/pickup-example") return assetResponse(request, "/", pickupExample(request));
    if (pathname === "/") {
      const rows = await catalog(env);
      const real = rows.filter((project) => !project.demo);
      const visible = real.length ? real : rows;
      return assetResponse(request, "/", home(request, await Promise.all(visible.map((p) => publicData(env, p)))));
    }
    if (route) {
      if (route.project) {
        const project = await findCampaign(env, route);
        if (project) return assetResponse(request, "/", projectPage(request, await publicData(env, project)));
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
  const artist = url.searchParams.get("artist");
  const project = url.searchParams.get("project");
  const id = url.searchParams.get("id");
  if ((pathname === "/api/campaign" && request.method === "GET") ||
      (["/api/reservations", "/api/verify-email"].includes(pathname) && request.method === "POST")) {
    const campaign = await findCampaign(env, { artist, project });
    if (!campaign) return json({ error: "作品が見つかりません。" }, 404);
    if (pathname === "/api/campaign") return json(await publicData(env, campaign));
    if (pathname === "/api/verify-email") return startVerification(request, env, campaign);
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
    if (pathname === "/api/manage/settings" && request.method === "GET") {
      const [settings, data, paymentSettings, entries] = await Promise.all([
        getSettings(env.DB, campaign), publicData(env, campaign), getPaymentSettings(env.DB, campaign),
        env.DB.prepare(`SELECT r.id, r.name, r.email, r.quantity, r.paid, r.created_at, r.email_verified_at,
          r.pickup_at, r.paid_receipt_id, r.payment_url, r.fulfillment, r.shipping_fee, r.postal_code,
          r.shipping_address, p.sent_at AS receipt_sent_at FROM reservations r
          LEFT JOIN payment_receipts p ON p.id = r.paid_receipt_id
          WHERE r.campaign_id = ? ORDER BY r.created_at DESC`).bind(campaign.id).all(),
      ]);
      return json({ settings, data, paymentSettings, reservations: entries.results.map((entry) => ({ ...entry, pickup_code: entry.paid && entry.fulfillment === "pickup" ? pickupCode(entry.id) : null })) });
    }
    if (pathname === "/api/manage/payment-settings" && request.method === "PUT") return savePaymentSettings(request, env.DB, campaign);
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
  if (verifiedDatabases.has(db)) return;
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
  verifiedDatabases.add(db);
}

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      if (env.DB && (pathname === "/" || pathname.startsWith("/artists/") || pathname.startsWith("/api/"))) {
        await ensureReleaseDetails(env.DB);
      }
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
      return json({ error: "一時的に利用できません。時間をおいてお試しください。" }, 503);
    }
  },
};
