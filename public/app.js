const $ = (id) => document.getElementById(id);
const set = (id, text) => { $(id).textContent = text; };
const money = (amount) => `¥${amount.toLocaleString("ja-JP")}`;
const form = $("booking-form");
if (form) initializeBooking();
function initializeBooking() {
  const dialog = $("booking-dialog");
  const quantity = $("quantity");
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
    const booked = Math.min(capacity, reserved + demoCount);
    const collectingPayment = booked >= reservationGoal || paid >= paidGoal;
    const canReserve = accepting && booked < capacity;
    set("progress-label", collectingPayment ? "入金済み" : "無料予約");
    set("reservation-count", collectingPayment ? paid : booked);
    set("reservation-target", collectingPayment ? paidGoal : reservationGoal);
    set("progress-note", collectingPayment ?
      `無料予約${booked}個 / ${paidGoal}個分の入金で製造` :
      `無料予約${reservationGoal}個で、お支払いをご案内`);
    const bar = $("progress");
    bar.max = collectingPayment ? paidGoal : reservationGoal;
    bar.value = collectingPayment ? paid : booked;
    if (!campaign.demo && paid >= paidGoal) set("campaign-status", "製造決定");
    else if (booked >= capacity) set("campaign-status", "予定数到達");
    $("open-reserve").disabled = !canReserve;
    set("booking-note", canReserve ? "予約時のお支払いはありません" :
      booked >= capacity ? "予定数に達しました" : "現在、予約を受け付けていません");
  }

  function updateTotal() {
    set("form-total", `後日のお支払い予定額 ${money(data.campaign.price * Number(quantity.value))}（税込）`);
  }

  $("open-reserve").addEventListener("click", () => {
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
    form.hidden = false;
    set("form-error", "");
    const remaining = data.capacity - data.reserved - demoCount;
    quantity.replaceChildren(...Array.from({ length: Math.min(5, remaining) }, (_, i) => new Option(`${i + 1}個`, i + 1)));
    document.querySelectorAll(".customer-field").forEach((field) => {
      const hidden = data.campaign.demo && !field.classList.contains("preview-field");
      field.hidden = hidden;
      field.querySelector("input").disabled = hidden;
    });
    set("form-intro", data.campaign.demo ? "確認版では、入力したメールアドレスをサーバーに送りません。認証コードは次の画面に表示されます。" : "今お支払いいただく金額は0円です。");
    $("resend-code").hidden = data.campaign.demo;
    $("submit-reserve").firstChild.textContent = data.campaign.demo ? "確認コードを表示する " : "認証コードを受け取る ";
    updateTotal();
    dialog.showModal();
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
    reservation = { ...values, quantity: Number(values.quantity), price: data.campaign.price, consent: values.consent === "yes" };
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
        set("booking-reference", "実際のメール送信や支払いは発生しません。");
        $("receipt-example-link").hidden = false;
        render();
      } else {
        const result = await api("reservations", { ...reservation, verificationId, code });
        if (current !== round || !dialog.open) return;
        set("success-text", "メール認証が完了し、無料予約を受け付けました。条件を満たしたら同じアドレスへお支払いをご案内します。");
        set("booking-reference", `予約番号 ${result.id}`);
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

  async function loadCampaign() {
    const response = await fetch(`/api/campaign?${params}`);
    if (!response.ok) throw new Error("予約状況を取得できませんでした。");
    data = await response.json();
    render();
  }

  loadCampaign().catch((error) => set("booking-note", error.message));
}
