
const stripeOrigin="https://touchcd-crowdfunding.com";
const stripeReady=env=>Boolean(env.STRIPE_SECRET_KEY&&env.STRIPE_WEBHOOK_SECRET&&env.STRIPE_PAYMENTS_ENABLED==="1");
async function stripeCall(env,path,params,key){
  const response=await fetch("https://api.stripe.com/v1/"+path,{method:params?"POST":"GET",headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,...(params?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(key?{"Idempotency-Key":key}:{})},...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(12000)});
  if(!response.ok){console.warn("Stripe response",response.status);throw Error("Stripe request failed");}
  return response.json();
}
const stripeOrder=(db,token)=>db.prepare("SELECT o.*,r.email,r.name,r.paid,r.fulfillment,r.quantity AS current_quantity,r.shipping_fee AS current_shipping_fee FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id WHERE o.token=?").bind(token).first();
async function issueStripeGuide(request,env,campaign){
  if(!stripeReady(env)||!mailReady(env))return json({error:"Stripe連携設定が必要です。"},503);
  const body=await readBody(request);
  if(!uuidLike(body?.id)||campaign.demo)return json({error:"予約を選択してください。"},400);
  const db=env.DB,state=await publicData(env,campaign),settings=await getPaymentSettings(db,campaign);
  if(state.outcome)return json({error:"この企画は判定済みです。"},409);
  if(state.reserved<state.reservationGoal)return json({error:"無料予約の目標に達していません。"},409);
  const deadline=Math.floor(Date.parse(settings.deadline)/1000);
  if(!(deadline>Date.now()/1000+1860))return json({error:"支払期限を31分以上先に設定してください。"},409);
  const entry=await db.prepare("SELECT * FROM reservations WHERE id=? AND campaign_id=?").bind(body.id,campaign.id).first();
  if(!entry||entry.paid||!entry.email_verified_at)return json({error:"認証済みの未入金予約が必要です。"},409);
  let o=await db.prepare("SELECT * FROM stripe_orders WHERE reservation_id=?").bind(entry.id).first();
  if(!o){
    if(entry.payment_url)return json({error:"既存の手動決済リンクが登録されています。"},409);
    const token=crypto.randomUUID()+crypto.randomUUID(),link=stripeOrigin+"/payment/"+token;
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO stripe_orders(reservation_id,campaign_id,token,quantity,unit_price,shipping_fee,deadline,title) SELECT id,campaign_id,?,quantity,?,shipping_fee,?,? FROM reservations WHERE id=? AND campaign_id=? AND paid=0 AND email_verified_at IS NOT NULL AND payment_url='' AND quantity=? AND shipping_fee=?").bind(token,campaign.price,deadline,campaign.title,entry.id,campaign.id,entry.quantity,entry.shipping_fee),
      db.prepare("UPDATE reservations SET payment_url=? WHERE id=? AND payment_url='' AND EXISTS(SELECT 1 FROM stripe_orders WHERE reservation_id=? AND token=?)").bind(link,entry.id,entry.id,token)
    ]);
    o=await db.prepare("SELECT * FROM stripe_orders WHERE reservation_id=?").bind(entry.id).first();
    if(!o)return json({error:"予約が変更されました。"},409);
  }
  if(o.deadline<=Date.now()/1000+1860)return json({error:"決済期限が終了間近です。"},409);
  if(o.guide_sent_at)return json({saved:true,alreadySent:true});
  const priorNotice=await db.prepare("SELECT state FROM automation_mail WHERE reservation_id=? AND kind=\'guide\'").bind(entry.id).first();
  if(priorNotice?.state==="sent"){await db.prepare("UPDATE stripe_orders SET guide_sent_at=? WHERE reservation_id=? AND guide_sent_at IS NULL").bind(new Date().toISOString(),entry.id).run();return json({saved:true,alreadySent:true});}
  if(!await claimNotice(db,entry.id,"guide"))return json({error:"案内送信の確認中です。"},409);
  const guide=paymentGuide({...campaign,price:o.unit_price},{...entry,quantity:o.quantity,price:o.unit_price,shipping_fee:o.shipping_fee},new Date(o.deadline*1000).toISOString(),stripeOrigin+"/payment/"+o.token,stripeOrigin+"/tokushoho");
  const sent=await sendMail(env,entry.email,guide.subject,guide.text,"stripe-guide/"+entry.id);
  await finishNotice(db,entry.id,"guide",sent);
  if(!sent)return json({error:"決済案内の送信に失敗しました。同じリンクで再試行できます。"},503);
  await db.prepare("UPDATE stripe_orders SET guide_sent_at=? WHERE reservation_id=?").bind(new Date().toISOString(),entry.id).run();
  return json({saved:true});
}
function paymentPage(request,title,message,button="",status=200){
  const html='<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escaped(title)+'</title><link rel="stylesheet" href="/site.css"><main class="shell admin"><section class="admin-card"><h1>'+escaped(title)+'</h1><p>'+escaped(message)+'</p>'+button+'<p><a href="/">touchCDトップ</a></p></section></main></html>';
  return new Response(request.method==="HEAD"?null:html,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex,nofollow","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'none'"}});
}
function checkoutRedirect(url){const u=new URL(url);if(u.protocol!=="https:"||u.hostname!=="checkout.stripe.com")throw Error("Unexpected checkout URL");return new Response(null,{status:303,headers:{Location:u.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});}
async function startStripeCheckout(request,env,token){
  const db=env.DB;
  if(!stripeReady(env)||!db)return paymentPage(request,"お支払い準備中","現在、決済を受け付けていません。","",503);
  let o=await stripeOrder(db,token);
  if(!o)return paymentPage(request,"決済リンク無効","支払い案内メールのリンクをご確認ください。","",404);
  const final=await automationState(db,o.campaign_id);
  if(final?.outcome==="failed")return paymentPage(request,"製造不成立","企画は終了しました。お支払い済みの場合は返金のご案内をご確認ください。");
  if(o.paid)return paymentPage(request,"お支払い済み","支払い完了メールをご確認ください。");
  if(o.deadline<=Date.now()/1000)return paymentPage(request,"支払期限終了","touchCDへお問い合わせください。","",410);
  if(request.method==="GET"||request.method==="HEAD"){
    const project=await db.prepare("SELECT pickup,shipping_note,artist_slug,slug FROM projects WHERE id=?").bind(o.campaign_id).first();
    const delivery=o.fulfillment==="shipping"?"自宅配送（定形外郵便）":"会場受取";
    const schedule=(o.fulfillment==="shipping"?project?.shipping_note:project?.pickup)||"作品ページおよび案内メールをご確認ください。";
    const deadline=new Date(o.deadline*1000).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
    const link=project?(o.campaign_id===izumiCampaignId?"/works/izumi-wada":"/artists/"+encodeURIComponent(project.artist_slug)+"/"+encodeURIComponent(project.slug)):"/";
    const rows=[["作品",o.title],["数量",o.quantity+"個"],["税込単価",amount(o.unit_price)],["送料（注文単位）",amount(o.shipping_fee)],["お支払い総額",amount(o.unit_price*o.quantity+o.shipping_fee)],["支払方法・期限","クレジットカード・PayPay・対応端末のApple Pay／Google Pay／"+deadline+"（日本時間）"],["受取方法・時期",delivery+"／"+schedule],["配送・受取の注意",o.fulfillment==="shipping"?postalDeliveryNote+" 発送から10日経っても届かない場合はお問い合わせください。住所誤り等による返送の再発送は実費負担。":"支払い完了メールを提示。お客様都合で会場受取当日に受け取れない場合、国内配送への変更手数料1,000円＋送料500円（合計1,500円・税込／注文）が別途必要。主催者・当方の事情による変更には変更手数料なし。"],["キャンセル・返品","決済後のお客様都合のキャンセル・返品・交換は不可。不備・誤配送は受取後7日以内を目安にtouchCDへご連絡ください。法令上の権利は制限しません。"],["製造不成立・中止","商品代金・送料を全額返金します。"],["利用条件","NFC対応端末と通信環境が必要です。音源・利用期間等は作品ページでご確認ください。"]];
    const summary='<dl class="commerce-details">'+rows.map(([k,v])=>'<div><dt>'+escaped(k)+'</dt><dd>'+escaped(v)+'</dd></div>').join("")+'</dl>';
    return paymentPage(request,"touchCD お支払い内容の確認","内容をご確認のうえStripe決済画面へ進んでください。変更が必要な場合は決済せずtouchCDへお問い合わせください。",summary+'<p><a href="'+escaped(link)+'">作品・注意事項を見る</a> ／ <a href="/tokushoho">取引条件・お問い合わせ</a></p><form method="post"><button type="submit" class="primary">お支払い方法を選ぶ</button></form>');
  }
  if(request.method!=="POST"||request.headers.get("Origin")!==stripeOrigin)return paymentPage(request,"操作を確認できません","メールのリンクからやり直してください。","",403);
  if(o.quantity!==o.current_quantity||o.shipping_fee!==o.current_shipping_fee)return paymentPage(request,"予約内容の確認が必要です","touchCDへお問い合わせください。","",409);
  if(o.session_id){
    const s=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(o.session_id));
    if(s.status==="complete"||s.payment_status==="paid")return paymentPage(request,"お支払い確認中","支払い完了メールをお待ちください。");
    if(s.status==="open"&&s.url)return checkoutRedirect(s.url);
    if(s.status!=="expired")return paymentPage(request,"決済の確認が必要です","touchCDへお問い合わせください。","",409);
    await db.prepare("UPDATE stripe_orders SET session_id=NULL,session_expires=0 WHERE reservation_id=? AND session_id=? AND generation=?").bind(o.reservation_id,o.session_id,o.generation).run();
    o=await stripeOrder(db,token);
  }
  const now=Math.floor(Date.now()/1000);
  if(o.session_expires===0){
    if(o.deadline-now<1860)return paymentPage(request,"支払期限間近","新しい決済を開始できません。touchCDへお問い合わせください。","",409);
    await db.prepare("UPDATE stripe_orders SET generation=generation+1,session_expires=? WHERE reservation_id=? AND session_id IS NULL AND session_expires=0").bind(Math.min(o.deadline,now+23*3600),o.reservation_id).run();
    o=await stripeOrder(db,token);
  }
  if(o.paid||o.session_id)return paymentPage(request,"決済状況を確認しています","メールのリンクをもう一度開いてください。","",409);
  if(o.session_expires-now<1800)return paymentPage(request,"決済の再開が必要です","安全のためtouchCDへお問い合わせください。","",409);
  const params={mode:"payment","excluded_payment_method_types[0]":"konbini",customer_email:o.email,client_reference_id:o.reservation_id,"metadata[reservation_id]":o.reservation_id,"metadata[generation]":String(o.generation),"line_items[0][price_data][currency]":"jpy","line_items[0][price_data][unit_amount]":String(o.unit_price),"line_items[0][price_data][product_data][name]":o.title+" touchCD","line_items[0][quantity]":String(o.quantity),success_url:stripeOrigin+"/payment/"+token,cancel_url:stripeOrigin+"/payment/"+token,expires_at:String(o.session_expires),"adaptive_pricing[enabled]":"false"};
  if(o.shipping_fee)Object.assign(params,{"line_items[1][price_data][currency]":"jpy","line_items[1][price_data][unit_amount]":String(o.shipping_fee),"line_items[1][price_data][product_data][name]":"配送料","line_items[1][quantity]":"1"});
  const session=await stripeCall(env,"checkout/sessions",params,"touchcd-checkout-"+o.reservation_id+"-"+o.generation);
  const saved=await db.prepare("UPDATE stripe_orders SET session_id=? WHERE reservation_id=? AND generation=? AND (session_id IS NULL OR session_id=?)").bind(session.id,o.reservation_id,o.generation,session.id).run();
  if(!saved.meta.changes||!session.url)return paymentPage(request,"決済確認中","メールのリンクを開き直してください。","",409);
  return checkoutRedirect(session.url);
}
async function stripeWebhook(request,env){
  if(!stripeReady(env)||!env.DB)return json({error:"unconfigured"},503);
  const fields=(request.headers.get("Stripe-Signature")||"").split(",").map(s=>s.trim().split("=")),time=fields.find(([k])=>k==="t")?.[1];
  if(!/^\d+$/.test(time||"")||Math.abs(Date.now()/1000-Number(time))>300)return json({error:"signature"},400);
  const reader=request.body?.getReader();if(!reader)return json({error:"body"},400);
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256000){await reader.cancel();return json({error:"size"},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  const raw=new TextDecoder().decode(bytes),encoder=new TextEncoder(),key=await crypto.subtle.importKey("raw",encoder.encode(env.STRIPE_WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const digest=Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(time+"."+raw))),b=>b.toString(16).padStart(2,"0")).join("");
  if(!fields.some(([k,v])=>{if(k!=="v1"||!v||v.length!==digest.length)return false;let diff=0;for(let i=0;i<v.length;i++)diff|=v.charCodeAt(i)^digest.charCodeAt(i);return diff===0;}))return json({error:"signature"},400);
  let e;try{e=JSON.parse(raw);}catch{return json({error:"body"},400);}
  if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(e.type))return json({received:true});
  const s=e.data?.object;
  if(!s||!uuidLike(s.client_reference_id)||s.metadata?.reservation_id!==s.client_reference_id||s.payment_status!=="paid")return json({received:true});
  return recordStripePayment(env,s);
}
async function recordStripePayment(env,s){
  if(!s||!s.livemode||s.mode!=="payment"||s.payment_status!=="paid"||s.currency!=="jpy"||!uuidLike(s.client_reference_id)||s.metadata?.reservation_id!==s.client_reference_id||typeof s.payment_intent!=="string")return json({error:"invalid payment"},409);
  const db=env.DB,o=await db.prepare("SELECT o.*,r.paid,r.quantity AS current_quantity,r.shipping_fee AS current_shipping_fee FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id WHERE o.reservation_id=?").bind(s.client_reference_id).first();
  if(!o)return json({error:"reservation not found"},409);
  if(o.session_id!==s.id||String(o.generation)!==s.metadata.generation||o.unit_price*o.quantity+o.shipping_fee!==s.amount_total||o.current_quantity!==o.quantity||o.current_shipping_fee!==o.shipping_fee||(o.payment_intent&&o.payment_intent!==s.payment_intent))return json({error:"reconciliation required"},409);
  const final=await automationState(db,o.campaign_id);
  if(final?.outcome==="failed"){if(o.payment_intent===s.payment_intent)return json({received:true});return json({error:"late payment reconciliation required"},409);}
  const campaign=await findCampaign(env,{id:o.campaign_id},true);if(!campaign)return json({error:"campaign unavailable"},503);
  if(!o.paid){
    const result=await editReservation(new Request(stripeOrigin+"/api/manage/reservation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:o.reservation_id,quantity:o.quantity,paid:true})}),env,{...campaign,title:o.title,price:o.unit_price},true);
    if(!result.ok)return json({error:"reconciliation required"},503);
  }
  await db.prepare("UPDATE stripe_orders SET payment_intent=? WHERE reservation_id=? AND (payment_intent IS NULL OR payment_intent=?)").bind(s.payment_intent,o.reservation_id,s.payment_intent).run();
  const receipt=await deliverReceipt(env,campaign,o.reservation_id);
  return receipt==="sent"?json({received:true}):json({error:"receipt pending"},503);
}
