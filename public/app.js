const $ = (id) => document.getElementById(id);
const set = (id, text) => { $(id).textContent = text; };
const money = (amount) => `¥${amount.toLocaleString("ja-JP")}`;
const form = $("booking-form");
if (form) initializeBooking();
function initializeBooking() {
  const dialog = $("booking-dialog");
  const quantity = $("quantity");
  const delivery = $("fulfillment-field");
  const address = $("shipping-address");
  const shippingFields = $("shipping-address-fields");
  const view = document.querySelector("[data-project]");
  const params = new URLSearchParams({ artist: view.dataset.artist, project: view.dataset.project });
  let data;
  let demoCount = 0;
  let verificationId = null;
  let reservation = null;
  let round = 0;
  const demoCode = "246810";
  const verification = $("verification-form");

  function render() {
    const { campaign, reservationGoal, paidGoal, capacity, reserved, paid, accepting } = data;
    const booked = data.unlimited ? reserved + demoCount : Math.min(capacity, reserved + demoCount);
    const canReserve = accepting && (data.unlimited || booked < capacity);
    set("reservation-count", booked);
    set("reservation-note", booked >= reservationGoal ? "支払い案内の条件を達成しました。" : `あと${reservationGoal - booked}個で支払い案内へ。`);
    $("reservation-progress").max = reservationGoal;
    set("reservation-target", reservationGoal);
    $("reservation-progress").value = Math.min(booked, reservationGoal);
    set("payment-count", paid);
    set("payment-note", paid >= paidGoal ? "製造条件を達成しました。" : `あと${paidGoal - paid}個分のお支払いで製造決定。`);
    $("payment-progress").max = paidGoal;
    set("payment-target", paidGoal);
    $("payment-progress").value = Math.min(paid, paidGoal);
    $("open-reserve").disabled = !canReserve;
    $("mobile-reserve").disabled = !canReserve;
    $("mobile-booking").hidden = !canReserve;
    set("booking-note", canReserve ? "予約時のお支払いは0円です。" :
      !data.unlimited && booked >= capacity ? "予定数に達しました。" : "現在、予約を受け付けていません。");
    set("campaign-status", campaign.demo && !data.unlimited && booked >= capacity ? "サンプル・予定数到達" : data.status);
  }

  function updateTotal() {
    const shipping = form.elements.fulfillment.value === "shipping" && !delivery.disabled;
    const fee = shipping ? data.campaign.shippingFee : 0;
    const showAddress = shipping && !data.campaign.demo && !data.addressAtPayment;
    address.hidden = !shipping || data.addressAtPayment;
    $("shipping-later-note").hidden = !shipping || !data.addressAtPayment;
    address.disabled = !showAddress;
    shippingFields.hidden = !showAddress;
    $("shipping-preview-note").hidden = !data.campaign.demo;
    set("form-total", `今のお支払い 0円 ／ 後日のお支払い予定 ${money(data.campaign.price * Number(quantity.value) + fee)}（税込${shipping ? `・送料${money(fee)}込み` : ""}）`);
  }

  function openBooking() {
    if (!data || $("open-reserve").disabled || dialog.open) return;
    round++;
    form.reset();
    verification.reset();
    verification.hidden = true;
    $("receipt-example-link").hidden = true;
    $("form-intro").hidden = false;
    $("submit-reserve").disabled = false;
    $("verify-reserve").disabled = false;
    $("resend-code").disabled = false;
    $("change-email").disabled = false;
    $("booking-success").hidden = true;
    $("cancel-after-booking").hidden = true;
    form.hidden = false;
    set("form-error", "");
    const remaining = data.unlimited ? 5 : data.capacity - data.reserved - demoCount;
    quantity.replaceChildren(...Array.from({ length: Math.min(5, remaining) }, (_, i) => new Option(`${i + 1}個`, i + 1)));
    document.querySelectorAll(".customer-field").forEach((field) => {
      const hidden = data.campaign.demo && !field.classList.contains("preview-field");
      field.hidden = hidden;
      field.querySelector("input").disabled = hidden;
    });
    set("form-intro", data.campaign.demo ? "確認版では、入力したメールアドレスをサーバーに送りません。認証コードは次の画面に表示されます。" : "今お支払いいただく金額は0円です。後日のお支払いはクレジットカードのみです。");
    $("resend-code").hidden = data.campaign.demo;
    set("submit-reserve", data.campaign.demo ? "確認コードを表示する" : "認証コードを受け取る");
    delivery.hidden = data.campaign.shippingFee == null;
    delivery.disabled = delivery.hidden;
    if (!delivery.hidden) set("shipping-option", `自宅配送（送料 ${money(data.campaign.shippingFee)}）`);
    updateTotal();
    dialog.showModal();
  }

  $("open-reserve").addEventListener("click", openBooking);
  $("mobile-reserve").addEventListener("click", openBooking);
  delivery.addEventListener("change", updateTotal);
  $("share-project").addEventListener("click", async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        set("share-result", "作品ページのURLをコピーしました。");
      }
    } catch (error) {
      if (error.name !== "AbortError") set("share-result", "ブラウザの共有機能からURLをコピーしてください。");
    }
  });

  dialog.addEventListener("close", () => {
    round++;
    reservation = null;
    verificationId = null;
    form.reset();
    verification.reset();
    set("verification-note", "");
  });
  $("close-reserve").addEventListener("click", () => dialog.close());
  $("finish-reserve").addEventListener("click", () => dialog.close());
  quantity.addEventListener("change", updateTotal);

  $("change-email").addEventListener("click", () => {
    round++;
    $("submit-reserve").disabled = false;
    $("resend-code").disabled = false;
    $("verify-reserve").disabled = false;
    verification.hidden = true;
    $("form-intro").hidden = false;
    form.hidden = false;
    form.elements.email.disabled ? quantity.focus() : form.elements.email.focus();
  });

  async function api(path, body) {
    const response = await fetch(`/api/${path}?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "もう一度お試しください。");
    return result;
  }

  async function prepareCode(target, message) {
    const current = round;
    target.disabled = true;
    set(message, "");
    try {
      const result = data.campaign.demo ? { verificationId: "demo" } : await api("verify-email", { email: reservation.email });
      if (current !== round || !dialog.open) return;
      verificationId = result.verificationId;
      form.hidden = true;
      $("form-intro").hidden = true;
      verification.hidden = false;
      verification.reset();
      set("verification-error", "");
      set("verification-note", data.campaign.demo ? `確認版のサンプルコードは ${demoCode} です。` :
        `${reservation.email} に6桁の認証コードを送りました。有効期限は10分です。`);
      verification.elements.code.focus();
    } catch (error) {
      if (current === round) set(message, error.message || "メールを送れませんでした。");
    } finally {
      if (current === round) target.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    reservation = { ...values, quantity: Number(values.quantity), price: data.campaign.price, shippingFee: values.fulfillment === "shipping" ? data.campaign.shippingFee : 0, consent: values.consent === "yes" };
    prepareCode($("submit-reserve"), "form-error");
  });

  $("resend-code").addEventListener("click", () => prepareCode($("resend-code"), "verification-error"));
  verification.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = round;
    const submit = $("verify-reserve");
    const code = verification.elements.code.value.trim();
    submit.disabled = true;
    $("resend-code").disabled = true;
    $("change-email").disabled = true;
    set("verification-error", "");
    try {
      if (data.campaign.demo) {
        if (code !== demoCode) throw new Error("サンプルコードをもう一度ご確認ください。");
        demoCount += reservation.quantity;
        set("success-text", "メール認証と無料予約の流れを体験できました。");
        set("booking-reference", reservation.fulfillment === "shipping" ? "自宅配送のサンプル予約です。メール送信や支払いは発生しません。" : "会場受取のサンプル予約です。メール送信や支払いは発生しません。");
        $("receipt-example-link").hidden = reservation.fulfillment === "shipping";
        render();
      } else {
        const result = await api("reservations", { ...reservation, verificationId, code });
        if (current !== round || !dialog.open) return;
        set("success-text", "メール認証が完了し、無料予約を受け付けました。条件を満たしたら同じアドレスへお支払いをご案内します。");
        set("booking-reference", `予約番号 ${result.id.slice(0, 8).toUpperCase()} ／ ${reservation.fulfillment === "shipping" ? "自宅配送" : "会場受取"}（番号を覚える必要はありません）`);
        $("cancel-after-booking").hidden = false;
        loadCampaign().catch(() => {});
      }
      verification.hidden = true;
      $("booking-success").hidden = false;
      $("finish-reserve").focus();
    } catch (error) {
      if (current === round) set("verification-error", error.message || "もう一度お試しください。");
    } finally {
      if (current === round) {
        submit.disabled = false;
        $("resend-code").disabled = false;
        $("change-email").disabled = false;
      }
    }
  });

  const cancelDialog = $("cancel-dialog");
  const cancelEmailForm = $("cancel-email-form");
  const cancelCodeForm = $("cancel-code-form");
  let cancelEmail = "", cancelId = "", cancelRound = 0;
  const resetCancel = () => {
    cancelRound++;
    cancelEmail = ""; cancelId = "";
    cancelEmailForm.reset(); cancelCodeForm.reset();
    cancelEmailForm.hidden = false; cancelCodeForm.hidden = true;
    cancelEmailForm.querySelector("button").disabled = false;
    cancelCodeForm.querySelector("button").disabled = false;
    $("cancel-restart").disabled = false;
    set("cancel-result", "");
  };
  const cancelButtons = [...document.querySelectorAll("[data-cancel-reservation]")];
  if (!cancelButtons.some(button => !button.closest("#cancel-after-booking"))) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "secondary"; button.textContent = "無料予約をキャンセルする";
    $("share-project").before(button); cancelButtons.push(button);
  }
  cancelButtons.forEach(button => button.addEventListener("click", () => {
    if (!data || data.campaign.demo || cancelDialog.open) return;
    if (dialog.open) dialog.close();
    resetCancel(); cancelDialog.showModal();
  }));
  $("cancel-close").addEventListener("click", () => cancelDialog.close());
  cancelDialog.addEventListener("close", resetCancel);
  $("cancel-restart").addEventListener("click", resetCancel);
  cancelEmailForm.addEventListener("submit", async event => {
    event.preventDefault();
    const current = cancelRound, button = cancelEmailForm.querySelector("button");
    button.disabled = true; set("cancel-result", "");
    try {
      const email = cancelEmailForm.elements.email.value.trim();
      const result = await api("cancel-code", { email });
      if (current !== cancelRound || !cancelDialog.open) return;
      cancelEmail = email; cancelId = result.verificationId;
      cancelEmailForm.hidden = true; cancelCodeForm.hidden = false;
      set("cancel-result", "認証コードを送信しました。有効期限は10分です。");
      cancelCodeForm.elements.code.focus();
    } catch (error) { if (current === cancelRound) set("cancel-result", error.message); }
    finally { if (current === cancelRound) button.disabled = false; }
  });
  cancelCodeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const current = cancelRound, button = cancelCodeForm.querySelector("button");
    button.disabled = true; $("cancel-restart").disabled = true; set("cancel-result", "");
    try {
      await api("cancel-reservation", { email: cancelEmail, verificationId: cancelId, code: cancelCodeForm.elements.code.value.trim() });
      loadCampaign().catch(() => {});
      if (current !== cancelRound || !cancelDialog.open) return;
      cancelCodeForm.hidden = true;
      set("cancel-result", "無料予約をキャンセルしました。お支払いは発生しません。");
    } catch (error) { if (current === cancelRound) set("cancel-result", error.message); }
    finally { if (current === cancelRound) { button.disabled = false; $("cancel-restart").disabled = false; } }
  });

  async function loadCampaign() {
    const response = await fetch(`/api/campaign?${params}`);
    if (!response.ok) throw new Error("予約状況を取得できませんでした。");
    data = await response.json();
    render();
  }

  loadCampaign().catch((error) => set("booking-note", error.message));
}

document.querySelectorAll("[data-fan-discovery]").forEach(root => {
  const grid = root.querySelector("[data-fan-grid]");
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll("[data-release-card]"));
  const input = root.querySelector("[data-fan-search]"), sort = root.querySelector("[data-fan-sort]");
  const buttons = Array.from(root.querySelectorAll("[data-fan-filter]"));
  let state = "all";
  const normalize = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
  function renderCatalog() {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    const ordered = [...cards];
    if (sort.value === "deadline") ordered.sort((a,b) => Number(b.dataset.state === "open") - Number(a.dataset.state === "open") || Number(a.dataset.deadline) - Number(b.dataset.deadline));
    let count = 0;
    for (const card of ordered) {
      const match = (state === "all" || state === card.dataset.state) && terms.every(term => normalize(card.dataset.search).includes(term));
      card.hidden = !match;
      if (match) count++;
      grid.append(card);
    }
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.fanFilter === state)));
    root.querySelector("[data-fan-count]").textContent = count + "作品";
    root.querySelector("[data-fan-no-results]").hidden = count !== 0;
  }
  input.addEventListener("input", renderCatalog);
  sort.addEventListener("change", renderCatalog);
  buttons.forEach(button => button.addEventListener("click", () => { state = button.dataset.fanFilter; renderCatalog(); }));
  root.querySelector("[data-fan-reset]").addEventListener("click", () => { state = "all"; input.value = ""; sort.value = "default"; renderCatalog(); input.focus(); });
});
