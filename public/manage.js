const $ = (id) => document.getElementById(id);
const login = $("login");
const editor = $("project-form");
const settings = $("settings");
const paymentSettings = $("payment-settings-form");
const guideDialog = $("payment-guide-dialog");
const status = $("admin-status");
const labels = { draft: "下書き", unlisted: "リンク限定", listed: "一覧掲載" };
const pathFor = ({ artistSlug, slug }) => `/artists/${artistSlug}/${slug}`;
let key = "";
let projects = [];
let reservations = [];
let selected = null;
let selectionRevision = 0;
const pickupSearch = $("pickup-search");
const compactCode = (value) => String(value || "").trim().replaceAll("-", "").toUpperCase();

async function api(path, body, method = "PUT") {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/manage/${path}`, {
    headers,
    ...(body && { method, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function renderList() {
  $("project-list").replaceChildren(...projects.map((project) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(project.id === selected));
    const heading = document.createElement("strong");
    heading.textContent = project.title;
    const details = document.createElement("span");
    details.textContent = `${project.artist} · ${project.demo ? "サンプル" : labels[project.visibility]}`;
    button.append(heading, details);
    button.addEventListener("click", () => select(project.id).catch(showError));
    li.append(button);
    return li;
  }));
}

function renderEditor(project) {
  $("editor-title").textContent = project?.title || "新しい作品";
  editor.hidden = Boolean(project && !project.managed);
  $("fixed-note").hidden = !editor.hidden;
  const showLink = project && project.visibility !== "draft";
  $("share-row").hidden = !showLink;
  if (showLink) $("view-project").href = pathFor(project);
  editor.reset();
  for (const input of editor.elements) {
    if (!input.name) continue;
    const field = input.name;
    if (["artist", "artistSlug", "slug"].includes(field)) input.readOnly = Boolean(project);
    if (!project || !Object.hasOwn(project, field)) continue;
    if (input.type === "checkbox") input.checked = project[field];
    else if (field === "deadline") input.value = project[field].slice(0, 16);
    else input.value = project[field];
  }
  updatePath();
}

function updatePath() {
  const { artistSlug, slug } = editor.elements;
  const path = pathFor({ artistSlug: artistSlug.value || "artist", slug: slug.value || "release" });
  $("path-preview").textContent = path;
}

function renderEntry(entry) {
  const li = document.createElement("li");
  li.className = "entry";
  const info = document.createElement("p");
  info.textContent = `${entry.name} · ${entry.email}`;
  const state = document.createElement("p");
  state.className = "entry-status";
  const receipt = entry.receipt_sent_at ? "支払い完了メール送信済み" :
    entry.paid_receipt_id ? "支払い完了メール未送信" : "メール未発行";
  state.textContent = entry.pickup_at ? "受取済み" : entry.paid ? `入金済み · ${receipt}` :
    entry.email_verified_at ? "アドレス認証済み · 入金待ち" : "旧予約 · 入金待ち";
  li.append(info, state);
  const projectId = selected;
  if (entry.paid) {
    const displayCode = document.createElement("p");
    displayCode.className = "pickup-entry-code";
    displayCode.textContent = `受取コード ${entry.pickup_code}`;
    li.append(displayCode);
    if (!entry.pickup_at) {
      const actions = document.createElement("div");
      actions.className = "entry-actions";
      if (compactCode(pickupSearch.value) === compactCode(entry.pickup_code)) {
        addEntryAction(actions, "受取済みにする", "pickup", projectId, { id: entry.id, code: pickupSearch.value }, "受取済みにしました。");
      }
      if (entry.paid_receipt_id && !entry.receipt_sent_at) {
        addEntryAction(actions, "支払い完了メールを再試行", "payment-receipt", projectId, { id: entry.id }, "支払い完了メールを送信しました。");
      }
      li.append(actions);
    }
  }
  if (entry.pickup_at) return li;
  const form = document.createElement("form");
  const quantityField = document.createElement("label");
  quantityField.textContent = "個数";
  const quantity = document.createElement("input");
  Object.assign(quantity, { type: "number", min: "1", max: "5", required: true, value: entry.quantity });
  quantityField.append(quantity);
  const paidField = document.createElement("label");
  paidField.className = "check-field";
  const paid = document.createElement("input");
  Object.assign(paid, { type: "checkbox", checked: Boolean(entry.paid) });
  paidField.append(paid, "入金済み");
  const save = document.createElement("button");
  Object.assign(save, { type: "submit", className: "small-button", textContent: "保存" });
  form.append(quantityField, paidField, save);
  li.append(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const result = await api(`reservation?id=${encodeURIComponent(projectId)}`, { id: entry.id, quantity: Number(quantity.value), paid: paid.checked });
      if (selected === projectId) await loadReservations(projectId);
      status.textContent = result.receipt === "pending" ? "入金は記録しました。メールは未送信です。予約一覧から再試行できます。" :
        result.receipt === "sent" ? "入金を記録し、支払い完了メールを送信しました。" : "予約内容を保存しました。";
    } catch (error) { showError(error); }
    finally { save.disabled = false; }
  });
  if (!entry.paid) li.append(renderPaymentActions(entry, projectId));
  return li;
}

function renderPaymentActions(entry, projectId) {
  const details = document.createElement("details");
  details.className = "payment-actions";
  const summary = document.createElement("summary");
  summary.textContent = "支払い案内";
  details.append(summary);
  const form = document.createElement("form");
  form.className = "payment-link-form";
  const label = document.createElement("label");
  label.textContent = entry.quantity > 1 ? `${entry.quantity}個分の個別決済リンク` : "個別決済リンク（必要な場合）";
  const url = document.createElement("input");
  Object.assign(url, { type: "url", maxLength: 1500, value: entry.payment_url || "", placeholder: "https://" });
  label.append(url);
  const save = document.createElement("button");
  Object.assign(save, { type: "submit", className: "small-button", textContent: "リンクを保存" });
  const preview = document.createElement("button");
  Object.assign(preview, { type: "button", className: "small-button", textContent: "案内文を作る" });
  form.append(label, save, preview);
  const feedback = document.createElement("p");
  feedback.setAttribute("role", "status");
  feedback.className = "field-note payment-feedback";
  details.append(form, feedback);
  let savedUrl = entry.payment_url || "";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    preview.disabled = true;
    feedback.textContent = "";
    try {
      await api(`payment-link?id=${encodeURIComponent(projectId)}`, { id: entry.id, checkout_url: url.value });
      savedUrl = url.value.trim();
      feedback.textContent = "個別決済リンクを保存しました。";
    } catch (error) { feedback.textContent = error.message; }
    finally { save.disabled = false; preview.disabled = false; }
  });
  preview.addEventListener("click", async () => {
    feedback.textContent = "";
    if (url.value.trim() !== savedUrl) {
      feedback.textContent = "変更したリンクを先に保存してください。";
      return;
    }
    preview.disabled = true;
    save.disabled = true;
    try { await showPaymentGuide(projectId, { id: entry.id }); }
    catch (error) { feedback.textContent = error.message; }
    finally { preview.disabled = false; save.disabled = false; }
  });
  return details;
}

function addEntryAction(container, label, route, projectId, body, success) {
  const button = document.createElement("button");
  Object.assign(button, { className: "small-button", type: "button", textContent: label });
  container.append(button);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`${route}?id=${encodeURIComponent(projectId)}`, body);
      if (selected === projectId) await loadReservations(projectId);
      status.textContent = success;
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  });
}

function renderEntries() {
  const filter = compactCode(pickupSearch.value);
  const matching = filter ? reservations.filter((entry) => compactCode(entry.pickup_code).includes(filter)) : reservations;
  $("entries").replaceChildren(...matching.map(renderEntry));
  if (!matching.length) {
    const empty = document.createElement("li");
    empty.textContent = filter ? "一致する受取コードはありません。" : "サイトからの予約はまだありません。";
    $("entries").append(empty);
  }
}

pickupSearch.addEventListener("input", renderEntries);

async function loadReservations(projectId) {
  const revision = ++selectionRevision;
  const result = await api(`settings?id=${encodeURIComponent(projectId)}`);
  if (selected !== projectId || revision !== selectionRevision) return;
  for (const input of settings.elements) {
    if (input.name && Object.hasOwn(result.settings, input.name)) input.value = result.settings[input.name];
  }
  reservations = result.reservations;
  $("download").hidden = !reservations.length;
  renderEntries();
  const { campaign, reserved, paid } = result.data;
  $("offline-label").textContent = campaign.demo ? "サンプルの予約数" : "サイト外で受け付けた予約数";
  $("offline-paid-label").textContent = campaign.demo ? "サンプルの入金数" : "サイト外で確認した入金数";
  $("overview").textContent = `無料予約 ${reserved}個 · 入金済み ${paid}個`;
  const { reservationGoal } = result.data;
  paymentSettings.elements.checkout_url.value = result.paymentSettings.checkout_url;
  paymentSettings.elements.deadline.value = result.paymentSettings.deadline.slice(0, 16);
  $("payment-progress").textContent = `無料予約 ${reserved}個 / 支払い案内を出す目標 ${reservationGoal}個。`;
  $("payment-example-controls").hidden = !campaign.demo;
  $("settings-panel").hidden = false;
  $("payment-panel").hidden = false;
  $("entries-panel").hidden = false;
}

async function select(id) {
  selected = id;
  pickupSearch.value = "";
  status.textContent = "";
  $("settings-panel").hidden = true;
  $("payment-panel").hidden = true;
  $("payment-settings-feedback").textContent = "";
  $("entries-panel").hidden = true;
  renderList();
  renderEditor(projects.find((p) => p.id === id));
  if (id) await loadReservations(id);
}

async function load(id) {
  const result = await api("projects");
  projects = result.projects;
  $("intake-note").hidden = result.intakeEnabled;
  $("mail-note").hidden = result.mailConfigured;
  $("workspace").hidden = false;
  login.hidden = true;
  $("admin-key").value = "";
  await select(id ?? projects[0]?.id ?? null);
}

function showError(error) {
  status.textContent = error.message;
  if (error.status === 401) {
    $("workspace").hidden = true;
    login.hidden = false;
  }
}

login.addEventListener("submit", (event) => {
  event.preventDefault();
  key = $("admin-key").value.trim();
  load().catch(showError);
});
$("new-project").addEventListener("click", () => {
  select(null).catch(showError);
  editor.elements.artist.focus();
});
editor.addEventListener("input", updatePath);
editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = editor.querySelector('button[type="submit"]');
  button.disabled = true;
  const id = selected;
  const fields = Object.fromEntries(new FormData(editor));
  const body = {
    ...fields, id, price: Number(fields.price),
    deadline: fields.deadline ? fields.deadline + ":00+09:00" : "",
    reservationOpen: fields.reservationOpen === "on",
  };
  try {
    const result = await api("projects", body);
    await load(result.id);
    status.textContent = "作品を保存しました。";
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});

settings.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = settings.querySelector("button");
  button.disabled = true;
  const id = selected;
  try {
    const body = Object.fromEntries([...new FormData(settings)].map(([name, value]) => [name, Number(value)]));
    await api(`settings?id=${encodeURIComponent(id)}`, body);
    if (id === selected) await loadReservations(id);
    status.textContent = "予約の条件を保存しました。";
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});

paymentSettings.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = paymentSettings.querySelector("button");
  const projectId = selected;
  const feedback = $("payment-settings-feedback");
  button.disabled = true;
  feedback.textContent = "";
  const { deadline, checkout_url } = Object.fromEntries(new FormData(paymentSettings));
  try {
    await api(`payment-settings?id=${encodeURIComponent(projectId)}`, {
      checkout_url, deadline: deadline ? deadline + ":00+09:00" : "",
    });
    if (selected === projectId) feedback.textContent = "支払い設定を保存しました。";
  } catch (error) { if (selected === projectId) feedback.textContent = error.message; }
  finally { button.disabled = false; }
});

async function showPaymentGuide(projectId, body) {
  const guide = await api(`payment-guide?id=${encodeURIComponent(projectId)}`, body, "POST");
  if (selected !== projectId) return;
  $("payment-guide-title").textContent = guide.demo ? "支払い案内の見本" : "支払い案内";
  $("payment-guide-note").textContent = guide.demo ? "この見本は送信や決済を行わずに文面を確認するためのものです。" :
    "文面をコピーして、予約者へ送ってください。";
  $("payment-guide-text").value = `件名：${guide.subject}\n\n${guide.text}`;
  $("payment-copy-status").textContent = "";
  guideDialog.showModal();
}

$("payment-example").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await showPaymentGuide(selected, { quantity: Number($("payment-example-quantity").value) }); }
  catch (error) { $("payment-settings-feedback").textContent = error.message; }
  finally { button.disabled = false; }
});
$("close-payment-guide").addEventListener("click", () => guideDialog.close());
$("copy-payment-guide").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("payment-guide-text").value);
    $("payment-copy-status").textContent = "コピーしました。";
  } catch {
    $("payment-guide-text").focus();
    $("payment-guide-text").select();
    $("payment-copy-status").textContent = "選択した文面をコピーしてください。";
  }
});

$("copy-url").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("view-project").href);
    status.textContent = "作品のURLをコピーしました。";
  } catch { status.textContent = "作品ページへのリンクを長押しして、URLをコピーしてください。"; }
});

function csvCell(value) {
  let cell = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]/u.test(cell)) cell = "'" + cell;
  return '"' + cell.replaceAll('"', '""') + '"';
}

$("download").addEventListener("click", () => {
  const rows = [["予約番号", "お名前", "メール", "個数", "入金済み", "受付日時", "メール認証", "受取コード", "受取日時"],
    ...reservations.map(({ id, name, email, quantity, paid, created_at, email_verified_at, pickup_code, pickup_at }) => [id, name, email, quantity, paid ? "はい" : "いいえ", created_at, email_verified_at, pickup_code, pickup_at])];
  const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `touchcd-${projects.find((p) => p.id === selected)?.slug || "reservations"}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

load().catch((error) => {
  if (error.status === 401) login.hidden = false;
  else showError(error);
});
