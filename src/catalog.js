const artistPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const izumiCampaignId = "izumi-wada-jazz-date";
const izumiShippingSchedule = "2027年2月25日（木）〜3月3日（水）に順次発送予定（日本国内のみ）";
const postalDeliveryNote = "日本郵便・定形外郵便。発送後2〜3配達日程度が目安（土日祝日は原則配達なし）。追跡番号・日時指定・郵便局の損害補償なし。地域等により遅れる場合があります。";
const isIzumiCampaign = (campaign) => campaign?.id === izumiCampaignId;
const releasePath = (campaign) => isIzumiCampaign(campaign) ? "/works/izumi-wada" : `/artists/${campaign.artistSlug}/${campaign.slug}`;
const validSlug = (value) => typeof value === "string" && value.length >= 2 && value.length <= 48 && artistPattern.test(value);
const parseRelease = (path) => {
  const [,collection,artist,project,...rest] = path.split("/");
  if (collection !== "artists" || !validSlug(artist) || rest.length || (project !== undefined && !validSlug(project))) return null;
  return { artist, project };
};
const visibilityOptions = ["draft", "unlisted", "listed"];

const sampleCampaigns = [{
  id: "studio-demo",
  artistSlug: "yonagi",
  slug: "nami-no-atode",
  demo: true,
  title: "波のあとで",
  artist: "夜凪",
  story: "海辺の街で生まれた夜凪の『波のあとで』。ライブで聴いたあの曲を、赤い夕陽のジャケットと一緒に持ち帰る。透明なミニCDケースに、作品へのリンクをしのばせました。",
  eventInfo: "夜凪ワンマン「波のあとで」／サンプル公演",
  pickup: "公演当日 18:00〜20:00／ライブ会場の物販卓",
  audioAt: "2027-01-30T18:00:00+09:00",
  releaseUpdate: "この作品で無料予約と受取方法の選択を体験できます。",
  shippingNote: "公演後、順次発送予定（国内のみ）",
  shippingFee: 500,
  price: 2500,
  image: "/cd-keychain.webp",
  visibility: "listed",
}, {
  id: "studio-demo-two",
  artistSlug: "teionshitsu",
  slug: "low-frequency",
  demo: true,
  title: "LOW FREQUENCY",
  artist: "低音室",
  story: "暗がりに波紋を描くような低音と電子音。『LOW FREQUENCY』のジャケットを閉じ込めた、ライブ限定のミニCDキーホルダーです。",
  pickup: "ライブ会場の物販卓",
  price: 2500,
  image: "/low-frequency.webp",
  visibility: "listed",
}];

const projectSelect = `SELECT p.*, a.name AS artist_name FROM projects p
  JOIN artists a ON a.slug = p.artist_slug`;

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id, artistSlug: row.artist_slug, slug: row.slug, title: row.title, artist: row.artist_name,
    story: row.story, pickup: row.pickup, price: row.price, deadline: row.deadline, image: row.image,
    music: row.music, contact: row.contact, visibility: row.visibility,
    eventInfo: row.event_info, audioAt: row.audio_at, releaseUpdate: row.release_update,
    shippingNote: row.shipping_note, shippingFee: row.shipping_fee,
    reservationOpen: Boolean(row.reservation_open), managed: true, closesAt: row.id === izumiCampaignId && !row.deadline ? Number.MAX_SAFE_INTEGER : Date.parse(row.deadline),
  };
}

async function catalog(env, artist = null, managed = false) {
  const samples = env.SHOW_DEMO_CAMPAIGNS === "0" ? [] : sampleCampaigns.filter((project) => !artist || artist === project.artistSlug);
  const legacy = legacyCampaign(env);
  if (legacy && (!artist || artist === legacy.artistSlug)) samples.push(legacy);
  if (!env.DB) return samples;
  const clauses = [];
  const args = [];
  if (!managed) clauses.push("p.visibility = 'listed'");
  if (artist) { clauses.push("p.artist_slug = ?"); args.push(artist); }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const aggregated = `SELECT p.*, a.name AS artist_name, cs.reservation_goal, cs.paid_goal,
    cs.capacity, cs.offline_reserved, cs.offline_paid,
    COALESCE(r.reserved, 0) AS reserved, COALESCE(r.paid, 0) AS paid
    FROM projects p JOIN artists a ON a.slug = p.artist_slug
    LEFT JOIN campaign_settings cs ON cs.campaign_id = p.id
    LEFT JOIN (SELECT campaign_id, SUM(quantity) AS reserved, SUM(quantity * paid) AS paid
      FROM reservations GROUP BY campaign_id) r ON r.campaign_id = p.id`;
  const query = env.DB.prepare((managed ? projectSelect : aggregated) + where + " ORDER BY p.created_at DESC, p.id DESC");
  const { results } = args.length ? await query.bind(...args).all() : await query.all();
  const projects = results.map((row) => {
    const campaign = fromRow(row);
    if (managed) return campaign;
    const { reservation_goal, paid_goal, capacity, offline_reserved, offline_paid, reserved, paid } = row;
    return {
      ...campaign,
      settings: reservation_goal ? { reservation_goal, paid_goal, capacity, offline_reserved, offline_paid } : defaults(campaign),
      counts: { reserved, paid },
    };
  });
  return [...projects, ...samples];
}

async function findCampaign(env, { id, artist, project } = {}, includeDraft = false) {
  const samples = env.SHOW_DEMO_CAMPAIGNS === "0" ? [] : sampleCampaigns;
  const fixed = [legacyCampaign(env), ...samples].filter(Boolean);
  if (!id && !artist && !project) return fixed[0];
  const sample = fixed.find((item) => id ? item.id === id : item.artistSlug === artist && item.slug === project);
  if (sample) return sample;
  if (!env.DB || (!id && (!validSlug(artist) || !validSlug(project)))) return null;
  const condition = id ? "p.id = ?" : "p.artist_slug = ? AND p.slug = ?";
  const visibility = includeDraft ? "" : " AND p.visibility <> 'draft'";
  const row = await env.DB.prepare(projectSelect + " WHERE " + condition + visibility)
    .bind(...(id ? [id] : [artist, project])).first();
  return fromRow(row);
}

function allowedUrl(value, email = false) {
  if (!value) return true;
  try { return new URL(value).protocol === "https:" || (email && new URL(value).protocol === "mailto:"); }
  catch { return false; }
}

async function saveProject(request, env) {
  const form = await readBody(request);
  if (!form || typeof form !== "object") return json({ error: "入力項目を確認してください。" }, 400);
  const { id, price, visibility, reservationOpen } = form;
  const fields = {};
  for (const [key, limit] of Object.entries({
    artistSlug: 48, slug: 48, artist: 100, title: 100, story: 1800, pickup: 250,
    deadline: 32, image: 1000, music: 1000, contact: 1000,
  })) {
    if (typeof form[key] !== "string" || form[key].trim().length > limit) {
      return json({ error: "入力内容が長すぎるか、形式が正しくありません。" }, 400);
    }
    fields[key] = form[key].trim();
  }
  const { artistSlug, slug, artist, title, story, pickup, deadline, image, music, contact } = fields;
  if (!validSlug(artistSlug) || !validSlug(slug) || [legacyCampaign(env), ...sampleCampaigns].some((sample) => sample?.artistSlug === artistSlug) ||
      !artist || !title || !Number.isSafeInteger(price) || price < 1 || price > 1000000 ||
      !visibilityOptions.includes(visibility) || typeof reservationOpen !== "boolean") {
    return json({ error: "アーティスト名、公開設定、作品名、価格、URL識別名をご確認ください。" }, 400);
  }
  const details = {};
  for (const [key, max] of Object.entries({ eventInfo: 250, audioAt: 32, releaseUpdate: 1200, shippingNote: 250 })) {
    if (!Object.hasOwn(form, key)) continue;
    if (typeof form[key] !== "string" || form[key].trim().length > max) {
      return json({ error: "公演情報・お知らせ・発送案内の入力内容をご確認ください。" }, 400);
    }
    details[key] = form[key].trim();
  }
  const current = id ? await findCampaign(env, { id }, true) : null;
  if (id && (!current?.managed || current.artistSlug !== artistSlug || current.slug !== slug || current.artist !== artist)) {
    return json({ error: "既存作品のURLとアーティスト名は固定です。" }, 409);
  }
  const { eventInfo = "", audioAt = "", releaseUpdate = "", shippingNote = "", shippingFee = null } = {
    ...current,
    ...details,
    ...(Object.hasOwn(form, "shippingFee") ? { shippingFee: form.shippingFee } : {}),
  };
  if (!validPaymentDeadline(audioAt) || (shippingFee !== null &&
      (!Number.isInteger(shippingFee) || shippingFee < 0 || shippingFee > 100000 || !shippingNote))) {
    return json({ error: "音源公開予定日と、配送の送料・発送案内をご確認ください。" }, 400);
  }
  const closesAt = Date.parse(deadline);
  if ((deadline && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(deadline) || !Number.isFinite(closesAt))) ||
      !allowedUrl(image) || !allowedUrl(music) || !allowedUrl(contact, true)) {
    return json({ error: "締切日時とURLをご確認ください。画像・楽曲のURLは https:// で入力してください。" }, 400);
  }
  if (reservationOpen && (visibility === "draft" || !story || !pickup || !contact || !image || (!(isIzumiCampaign(current) && !deadline) && (!Number.isFinite(closesAt) || closesAt <= Date.now())))) {
    return json({ error: "受付を始めるには公開設定、作品紹介、画像、未来の締切、受取案内、問い合わせ先を設定してください。" }, 400);
  }
  const args = [title, story, pickup, price, deadline, image, music, contact, visibility, Number(reservationOpen),
    eventInfo, audioAt, releaseUpdate, shippingNote, shippingFee];
  if (id) {
    const changed = await env.DB.prepare(`UPDATE projects SET title = ?, story = ?, pickup = ?, price = ?,
      deadline = ?, image = ?, music = ?, contact = ?, visibility = ?, reservation_open = ?,
      event_info = ?, audio_at = ?, release_update = ?, shipping_note = ?, shipping_fee = ?
      WHERE id = ? AND (price = ? OR (
        NOT EXISTS (SELECT 1 FROM reservations WHERE campaign_id = ?) AND
        COALESCE((SELECT offline_reserved FROM campaign_settings WHERE campaign_id = ?), 0) = 0
      ))`).bind(...args, id, price, id, id).run();
    if (!changed.meta.changes) return json({ error: "予約が入った作品の価格は変更できません。" }, 409);
    return json({ id, url: releasePath(current) });
  }
  const projectId = crypto.randomUUID();
  const artistInsert = env.DB.prepare("INSERT INTO artists (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING").bind(artistSlug, artist);
  const projectInsert = env.DB.prepare(`
    INSERT INTO projects (id, artist_slug, slug, title, story, pickup, price, deadline, image, music, contact, visibility, reservation_open,
      event_info, audio_at, release_update, shipping_note, shipping_fee)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM artists WHERE slug = ? AND name = ?)
    ON CONFLICT(artist_slug, slug) DO NOTHING
  `).bind(projectId, artistSlug, slug, ...args, artistSlug, artist);
  const [, created] = await env.DB.batch([artistInsert, projectInsert]);
  if (!created.meta.changes) return json({ error: "URLが使用済みか、同じアーティストURLに別の名前が登録されています。" }, 409);
  return json({ id: projectId, url: releasePath(fields) }, 201);
}
