// An extra charge is issued only after staff confirm a missed venue pickup and the customer requests delivery.
const missedDeliveryFee=1500;
const deliveryChangeOrder=(db,token)=>db.prepare("SELECT d.*,r.email,r.name,r.paid,r.fulfillment,r.pickup_at,r.quantity FROM delivery_changes d JOIN reservations r ON r.id=d.reservation_id WHERE d.token=?").bind(token).first();
async function issueDeliveryChange(request,env,campaign){
  if(!stripeReady(env)||!mailReady(env)||campaign.demo)return json({error:"決済・メール設定が必要です。"},503);
  const body=await readBody(request),db=env.DB;
  if(!uuidLike(body?.id)||body?.confirmed!==true)return json({error:"当日受取がなかったことと購入者の配送希望を確認してください。"},400);
  if(isIzumiCampaign(campaign)&&Date.now()<Date.parse("2027-02-25T00:00:00+09:00"))return json({error:"ライブ終了後から配送変更できます。"},409);
  const state=await publicData(env,campaign);
  if(state.outcome==="failed"||(state.outcome!=="succeeded"&&state.paid<state.paidGoal))return json({error:"製造成立後に利用できます。"},409);
  const r=await db.prepare("SELECT * FROM reservations WHERE id=? AND campaign_id=? AND paid=1 AND fulfillment='pickup' AND pickup_at IS NULL AND email_verified_at IS NOT NULL").bind(body.id,campaign.id).first();
  if(!r)return json({error:"入金済み・未受取の会場受取予約がありません。"},409);
  const token=crypto.randomUUID()+crypto.randomUUID(),deadline=automationNow()+7*86400;
  await db.prepare("INSERT OR IGNORE INTO delivery_changes(reservation_id,campaign_id,token,deadline,amount,title,status) SELECT id,campaign_id,?,?,?,?,'issued' FROM reservations WHERE id=? AND paid=1 AND pickup_at IS NULL AND fulfillment='pickup'").bind(token,deadline,missedDeliveryFee,campaign.title,r.id).run();
  const o=await db.prepare("SELECT * FROM delivery_changes WHERE reservation_id=?").bind(r.id).first();
  if(!o||o.status!=="issued"||o.deadline<=automationNow())return json({error:"既存の配送変更の状態をご確認ください。"},409);
  if(o.sent_at)return json({saved:true,alreadySent:true});
  const ok=await lifecycleMail(env,r,"delivery-guide","会場受取から自宅配送への変更",[
    "作品："+campaign.title,"お客様都合で会場受取ができなかった場合の配送変更です。",
    "変更手数料1,000円＋送料500円＝1,500円（税込・1注文）",
    "お支払い期限："+paymentDate.format(new Date(o.deadline*1000))+"（日本時間）",
    "次の専用リンクから配送先を確認し、お支払いをお願いします。",
    stripeOrigin+"/delivery-payment/"+o.token,"日本郵便の定形外郵便で国内へ発送します。","touchCD"
  ].join("\n\n"));
  if(!ok){
    const notice=await db.prepare("SELECT state FROM automation_mail WHERE reservation_id=? AND kind='delivery-guide'").bind(r.id).first();
    if(notice?.state!=="sent")return json({error:"送信できませんでした。送信状況を確認してください。"},503);
  }
  await db.prepare("UPDATE delivery_changes SET sent_at=? WHERE reservation_id=? AND sent_at IS NULL").bind(new Date().toISOString(),r.id).run();
  return json({saved:true});
}
async function startDeliveryCheckout(request,env,token){
  const db=env.DB;
  if(!stripeReady(env)||!db)return paymentPage(request,"準備中","現在決済を受け付けていません。","",503);
  let o=await deliveryChangeOrder(db,token);
  if(!o)return paymentPage(request,"リンク無効","メールをご確認ください。","",404);
  if(o.status==="paid")return paymentPage(request,"配送変更のお支払い完了","ご案内メールをご確認ください。");
  if(o.status!=="issued"||!o.paid||o.fulfillment!=="pickup"||o.pickup_at)return paymentPage(request,"確認が必要です","touchCDへお問い合わせください。","",409);
  const state=await automationState(db,o.campaign_id);
  if(state?.outcome==="failed"||o.deadline<=automationNow())return paymentPage(request,"受付終了","touchCDへお問い合わせください。","",410);
  if(["GET","HEAD"].includes(request.method)){
    const rows=[["作品",o.title],["対象",o.quantity+"個の会場受取注文"],["変更手数料","1,000円"],["送料","500円"],["お支払い総額","1,500円（税込）"],["配送方法","日本郵便・定形外郵便（日本国内、追跡・日時指定なし）"],["発送予定","追加決済と配送先確認後7日以内を目安に発送"],["支払い期限",paymentDate.format(new Date(o.deadline*1000))+"（日本時間）"],["取消・返品","お客様都合の取消不可。不備等はtouchCDへお問い合わせください。"]];
    const html='<dl class="commerce-details">'+rows.map(([k,v])=>'<div><dt>'+escaped(k)+'</dt><dd>'+escaped(v)+'</dd></div>').join("")+'</dl>';
    return paymentPage(request,"会場受取から自宅配送へ変更","以下をご確認のうえ、Stripe決済画面で日本国内の配送先を入力してください。",html+'<p><a href="/tokushoho">取引条件・お問い合わせ</a></p><form method="post"><button type="submit" class="primary">配送先入力・お支払いへ進む</button></form>');
  }
  if(request.method!=="POST"||request.headers.get("Origin")!==stripeOrigin)return paymentPage(request,"操作を確認できません","メールのリンクからやり直してください。","",403);
  if(o.session_id){
    const s=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(o.session_id));
    if(s.payment_status==="paid"||s.status==="complete")return paymentPage(request,"お支払い確認中","メールをご確認ください。");
    if(s.status==="open"&&s.url)return checkoutRedirect(s.url);
    if(s.status!=="expired")return paymentPage(request,"確認が必要です","touchCDへお問い合わせください。","",409);
    await db.prepare("UPDATE delivery_changes SET session_id=NULL,session_expires=0 WHERE reservation_id=? AND session_id=? AND generation=?").bind(o.reservation_id,o.session_id,o.generation).run();
    o=await deliveryChangeOrder(db,token);
  }
  const now=automationNow();
  if(o.session_expires===0){
    if(o.deadline-now<1860)return paymentPage(request,"支払期限間近","touchCDへお問い合わせください。","",409);
    await db.prepare("UPDATE delivery_changes SET generation=generation+1,session_expires=? WHERE reservation_id=? AND session_id IS NULL AND session_expires=0 AND status='issued'").bind(Math.min(o.deadline,now+23*3600),o.reservation_id).run();
    o=await deliveryChangeOrder(db,token);
  }
  if(o.status!=="issued"||o.session_id||o.session_expires-now<1800)return paymentPage(request,"確認中","メールのリンクを開き直してください。","",409);
  const url=stripeOrigin+"/delivery-payment/"+token;
  const params={mode:"payment","excluded_payment_method_types[0]":"konbini",customer_email:o.email,client_reference_id:o.reservation_id,"metadata[delivery_change]":o.reservation_id,"metadata[generation]":String(o.generation),"line_items[0][price_data][currency]":"jpy","line_items[0][price_data][unit_amount]":"1000","line_items[0][price_data][product_data][name]":"touchCD 配送変更手数料","line_items[0][quantity]":"1","line_items[1][price_data][currency]":"jpy","line_items[1][price_data][unit_amount]":"500","line_items[1][price_data][product_data][name]":"配送料","line_items[1][quantity]":"1","shipping_address_collection[allowed_countries][0]":"JP",success_url:url,cancel_url:url,expires_at:String(o.session_expires),"adaptive_pricing[enabled]":"false"};
  const s=await stripeCall(env,"checkout/sessions",params,"touchcd-delivery-"+o.reservation_id+"-"+o.generation);
  const saved=await db.prepare("UPDATE delivery_changes SET session_id=? WHERE reservation_id=? AND generation=? AND status='issued' AND (session_id IS NULL OR session_id=?)").bind(s.id,o.reservation_id,o.generation,s.id).run();
  if(!saved.meta.changes||!s.url)return paymentPage(request,"確認中","メールのリンクを開き直してください。","",409);
  return checkoutRedirect(s.url);
}
async function recordDeliveryPayment(env,s){
  if(!s?.livemode||s.mode!=="payment"||s.payment_status!=="paid"||s.currency!=="jpy"||s.amount_total!==missedDeliveryFee||!uuidLike(s.client_reference_id)||s.metadata?.delivery_change!==s.client_reference_id||typeof s.payment_intent!=="string")return json({error:"delivery payment invalid"},409);
  const db=env.DB;
  const o=await db.prepare("SELECT d.*,r.email,r.paid,r.fulfillment,r.pickup_at FROM delivery_changes d JOIN reservations r ON r.id=d.reservation_id WHERE d.reservation_id=?").bind(s.client_reference_id).first();
  if(!o||o.session_id!==s.id||String(o.generation)!==s.metadata.generation||o.amount!==s.amount_total||(o.payment_intent&&o.payment_intent!==s.payment_intent))return json({error:"delivery reconciliation required"},409);
  if(o.status!=="paid"){
    const current=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(s.id));
    if(current.id!==s.id||current.payment_status!=="paid"||current.payment_intent!==s.payment_intent||current.amount_total!==missedDeliveryFee)return json({error:"delivery reconciliation required"},409);
    const shipping=current.collected_information?.shipping_details||current.shipping_details||s.collected_information?.shipping_details||s.shipping_details;
    const a=shipping?.address,postal=String(a?.postal_code||"").replaceAll("-","");
    const address=[a?.state,a?.city,a?.line1,a?.line2].filter(Boolean).join(" ");
    const name=String(shipping?.name||"").trim();
    if(!o.paid||o.pickup_at||o.fulfillment!=="pickup"||a?.country!=="JP"||!/^\d{7}$/.test(postal)||!address||address.length>240||!name||name.length>80){
      await db.prepare("UPDATE delivery_changes SET status='review',payment_intent=? WHERE reservation_id=?").bind(s.payment_intent,o.reservation_id).run();
      return json({error:"delivery address or fulfillment review required"},409);
    }
    const final=await automationState(db,o.campaign_id);
    if(final?.outcome==="failed")return json({error:"campaign failed"},409);
    const [changed,saved]=await db.batch([
      db.prepare("UPDATE reservations SET fulfillment='shipping',postal_code=?,shipping_address=? WHERE id=? AND paid=1 AND pickup_at IS NULL AND fulfillment='pickup' AND EXISTS(SELECT 1 FROM delivery_changes d WHERE d.reservation_id=reservations.id AND d.status IN ('issued','review') AND d.session_id=?)").bind(postal,address,o.reservation_id,s.id),
      db.prepare("UPDATE delivery_changes SET status='paid',payment_intent=?,paid_at=?,shipping_name=?,postal_code=?,shipping_address=? WHERE reservation_id=? AND session_id=? AND EXISTS(SELECT 1 FROM reservations r WHERE r.id=delivery_changes.reservation_id AND r.paid=1 AND r.fulfillment='shipping' AND r.pickup_at IS NULL)").bind(s.payment_intent,new Date().toISOString(),name,postal,address,o.reservation_id,s.id)
    ]);
    if(!changed.meta.changes||!saved.meta.changes)return json({error:"delivery reconciliation required"},409);
  }
  const entry={id:o.reservation_id,email:o.email};
  const ok=await lifecycleMail(env,entry,"delivery-paid","自宅配送への変更完了",["作品："+o.title,"配送変更手数料1,000円と送料500円、合計1,500円のお支払いを確認しました。","追加決済と配送先確認後7日以内を目安に定形外郵便で発送します。","touchCD"].join("\n\n"));
  const prior=await db.prepare("SELECT state FROM automation_mail WHERE reservation_id=? AND kind='delivery-paid'").bind(o.reservation_id).first();
  return ok||prior?.state==="sent"?json({received:true}):json({error:"delivery notification pending"},503);
}
