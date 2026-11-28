// Project-scoped, bounded payment lifecycle jobs. Disabled unless explicitly enabled.
const automationSchema=[
  "CREATE TABLE IF NOT EXISTS automation_campaigns (campaign_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, refunds_enabled INTEGER NOT NULL DEFAULT 0, outcome TEXT, decided_at TEXT, outcome_paid INTEGER, outcome_goal INTEGER, last_checked TEXT, last_error TEXT)",
  "CREATE TABLE IF NOT EXISTS automation_mail (reservation_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(reservation_id,kind))",
  "CREATE TABLE IF NOT EXISTS automation_checks (reservation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, generation INTEGER NOT NULL, checked_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS automation_refunds (reservation_id TEXT PRIMARY KEY, refund_id TEXT, status TEXT NOT NULL, amount INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS automation_locks (campaign_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL)"
];
const automationDatabases=new WeakSet();
async function ensureAutomation(db){
  if(automationDatabases.has(db))return;
  await db.batch(automationSchema.map(sql=>db.prepare(sql).bind()));
  automationDatabases.add(db);
}
async function automationState(db,id){
  return await db.prepare("SELECT * FROM automation_campaigns WHERE campaign_id=?").bind(id).first();
}
function automationNow(){return Math.floor(Date.now()/1000);}
async function claimNotice(db,id,kind){
  const now=automationNow();
  const r=await db.prepare("INSERT INTO automation_mail(reservation_id,kind,state,attempts,updated_at) VALUES(?,?,'sending',1,?) ON CONFLICT(reservation_id,kind) DO UPDATE SET state='sending',attempts=attempts+1,updated_at=excluded.updated_at WHERE automation_mail.state='failed' AND automation_mail.attempts<5 AND automation_mail.updated_at<=?").bind(id,kind,now,now-600).run();
  return !!r.meta.changes;
}
async function finishNotice(db,id,kind,ok){
  await db.prepare("UPDATE automation_mail SET state=?,updated_at=? WHERE reservation_id=? AND kind=? AND state='sending'").bind(ok?"sent":"failed",automationNow(),id,kind).run();
}
async function lifecycleMail(env,entry,kind,subject,body){
  if(!validEmail(asEmail(entry.email)))return false;
  if(!await claimNotice(env.DB,entry.id,kind))return false;
  const ok=await sendMail(env,entry.email,"【touchCD】"+subject,body,"lifecycle/"+kind+"/"+entry.id);
  await finishNotice(env.DB,entry.id,kind,ok);
  return ok;
}
async function saveAutomation(request,env,campaign){
  const body=await readBody(request);
  if(campaign.demo||!campaign.managed||typeof body?.enabled!=="boolean"||typeof body?.refundsEnabled!=="boolean"||(!body.enabled&&body.refundsEnabled))return json({error:"設定をご確認ください。"},400);
  const deadline=Date.parse((await getPaymentSettings(env.DB,campaign)).deadline);
  if(body.enabled&&(!stripeReady(env)||!mailReady(env)||!Number.isFinite(campaign.closesAt)||!Number.isFinite(deadline)||deadline<=campaign.closesAt))return json({error:"予約締切・支払期限と決済、メールの設定が必要です。"},409);
  const result=await env.DB.prepare("INSERT INTO automation_campaigns(campaign_id,enabled,refunds_enabled) VALUES(?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET enabled=excluded.enabled,refunds_enabled=excluded.refunds_enabled").bind(campaign.id,Number(body.enabled),Number(body.refundsEnabled)).run();
  return json({saved:!!result.meta.changes});
}
async function automationOverview(db,id){
  const state=await automationState(db,id);
  const [notices,refunds]=await Promise.all([
    db.prepare("SELECT m.kind,m.state,COUNT(*) AS count FROM automation_mail m JOIN reservations r ON r.id=m.reservation_id WHERE r.campaign_id=? GROUP BY m.kind,m.state").bind(id).all(),
    db.prepare("SELECT f.status,COUNT(*) AS count,SUM(f.amount) AS total FROM automation_refunds f JOIN reservations r ON r.id=f.reservation_id WHERE r.campaign_id=? GROUP BY f.status").bind(id).all()
  ]);
  return {enabled:!!state?.enabled,refundsEnabled:!!state?.refunds_enabled,outcome:state?.outcome||null,decidedAt:state?.decided_at||null,paid:state?.outcome_paid??null,goal:state?.outcome_goal??null,lastChecked:state?.last_checked||null,lastError:state?.last_error||null,notices:notices.results,refunds:refunds.results};
}
async function reconcileForAutomation(env,o){
  if(!o.session_id)return o.session_expires>0?"review":"clear";
  const s=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(o.session_id));
  if(s.id!==o.session_id||!s.livemode||s.mode!=="payment"||s.currency!=="jpy"||s.client_reference_id!==o.reservation_id||s.metadata?.reservation_id!==o.reservation_id||s.metadata?.generation!==String(o.generation)||s.amount_total!==o.unit_price*o.quantity+o.shipping_fee)return "review";
  if(s.payment_status==="paid"){
    const result=await recordStripePayment(env,s);
    if(!result.ok)return "review";
    return "paid";
  }
  if(s.status==="expired"&&s.payment_status==="unpaid")return "clear";
  return "waiting";
}
async function automateGuidesAndReminders(env,campaign,state,deadline){
  const db=env.DB,now=automationNow();
  if(state.reserved>=state.reservationGoal&&deadline-now>1860){
    const entries=await db.prepare("SELECT r.id FROM reservations r LEFT JOIN stripe_orders o ON o.reservation_id=r.id LEFT JOIN automation_mail m ON m.reservation_id=r.id AND m.kind='guide' WHERE r.campaign_id=? AND r.paid=0 AND r.email_verified_at IS NOT NULL AND (COALESCE(r.payment_url,'')='' OR o.reservation_id IS NOT NULL) AND o.guide_sent_at IS NULL AND (m.state IS NULL OR (m.state='failed' AND m.attempts<5 AND m.updated_at<=?)) ORDER BY r.created_at LIMIT 8").bind(campaign.id,now-600).all();
    for(const entry of entries.results){
      const req=new Request(stripeOrigin+"/api/manage/stripe-guide",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:entry.id})});
      await issueStripeGuide(req,env,campaign);
    }
  }
  const orders=await db.prepare("SELECT o.*,r.id,r.email FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id WHERE o.campaign_id=? AND o.guide_sent_at IS NOT NULL AND r.paid=0 AND o.deadline>? AND (o.deadline<=? OR unixepoch(o.guide_sent_at)<=?) AND NOT EXISTS(SELECT 1 FROM automation_mail m WHERE m.reservation_id=r.id AND m.kind=CASE WHEN o.deadline<=? THEN 'reminder6h' ELSE 'reminder24h' END AND (m.state IN ('sent','sending') OR m.attempts>=5 OR m.updated_at>?)) ORDER BY o.deadline LIMIT 8").bind(campaign.id,now,now+21600,now-86400,now+21600,now-600).all();
  for(const o of orders.results){
    if(o.session_id){
      const check=await reconcileForAutomation(env,o);
      if(check==="paid"||check==="review")continue;
      if(check==="waiting"){
        const s=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(o.session_id));
        if(s.status==="complete"||s.payment_status!=="unpaid")continue;
      }
    }
    const final=o.deadline-now<=21600,kind=final?"reminder6h":"reminder24h";
    const amountDue=amount(o.unit_price*o.quantity+o.shipping_fee);
    await lifecycleMail(env,o,kind,final?"お支払期限が近づいています":"お支払いのご確認",[
      "作品："+o.title,"お支払い合計："+amountDue,"支払期限："+paymentDate.format(new Date(o.deadline*1000))+"（日本時間）",
      "まだお支払いがお済みでない場合は、次の専用リンクからお手続きください。",
      stripeOrigin+"/payment/"+o.token,"すでにお支払い済みの場合は行き違いをご容赦ください。","touchCD"
    ].join("\n"));
  }
}
async function decideCampaign(env,campaign,state,deadline){
  const db=env.DB,now=automationNow();
  if(!Number.isFinite(campaign.closesAt)||Date.now()<campaign.closesAt||!Number.isFinite(deadline)||now<deadline+3600)return null;
  const later=await db.prepare("SELECT COUNT(*) AS n FROM stripe_orders WHERE campaign_id=? AND deadline>?").bind(campaign.id,now-3600).first();
  if(later.n)return "個別決済期限の終了待ち";
  const orphan=await db.prepare("SELECT COUNT(*) AS n FROM stripe_orders WHERE campaign_id=? AND session_id IS NULL AND session_expires>0").bind(campaign.id).first();
  if(orphan.n)return "決済セッションの照合が必要";
  const checks=await db.prepare("SELECT o.* FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id LEFT JOIN automation_checks c ON c.reservation_id=o.reservation_id AND c.session_id=o.session_id AND c.generation=o.generation WHERE o.campaign_id=? AND r.paid=0 AND o.session_id IS NOT NULL AND c.reservation_id IS NULL LIMIT 8").bind(campaign.id).all();
  for(const o of checks.results){
    const result=await reconcileForAutomation(env,o);
    if(result==="clear")await db.prepare("INSERT OR REPLACE INTO automation_checks(reservation_id,session_id,generation,checked_at) VALUES(?,?,?,?)").bind(o.reservation_id,o.session_id,o.generation,now).run();
    else if(result!=="paid")return result==="waiting"?"Stripeの決済確定待ち":"Stripeとの照合が必要";
  }
  const pending=await db.prepare("SELECT COUNT(*) AS n FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id LEFT JOIN automation_checks c ON c.reservation_id=o.reservation_id AND c.session_id=o.session_id AND c.generation=o.generation WHERE o.campaign_id=? AND r.paid=0 AND o.session_id IS NOT NULL AND c.reservation_id IS NULL").bind(campaign.id).first();
  if(pending.n)return "決済照合中";
  const fresh=await publicData(env,campaign);
  const settings=await getSettings(db,campaign);
  const outcome=fresh.paid>=fresh.paidGoal?"succeeded":"failed";
  // Manual payments cannot be automatically refunded. Do not make a financial decision on incomplete evidence.
  const mismatch=await db.prepare("SELECT COUNT(*) AS n FROM reservations r LEFT JOIN stripe_orders o ON o.reservation_id=r.id WHERE r.campaign_id=? AND r.paid=1 AND (o.payment_intent IS NULL OR o.session_id IS NULL OR r.quantity<>o.quantity OR r.shipping_fee<>o.shipping_fee OR r.pickup_at IS NOT NULL)").bind(campaign.id).first();
  if(outcome==="failed"&&(settings.offline_paid||mismatch.n))return "手動入金・受渡済み等の確認が必要（自動判定停止）";
  const result=await db.prepare("UPDATE automation_campaigns SET outcome=?,decided_at=?,outcome_paid=?,outcome_goal=? WHERE campaign_id=? AND outcome IS NULL AND enabled=1 AND (SELECT COALESCE(SUM(quantity*paid),0) FROM reservations WHERE campaign_id=?)+COALESCE((SELECT offline_paid FROM campaign_settings WHERE campaign_id=?),0)=?").bind(outcome,new Date().toISOString(),fresh.paid,fresh.paidGoal,campaign.id,campaign.id,campaign.id,fresh.paid).run();
  if(!result.meta.changes)return "入金状況が変わりました。再確認します。";
  await db.prepare("UPDATE projects SET reservation_open=0 WHERE id=?").bind(campaign.id).run();
  return null;
}
async function refundAutomationOrder(env,o){
  const db=env.DB,expected=o.unit_price*o.quantity+o.shipping_fee;
  if(!o.payment_intent||!o.session_id||!o.paid||o.pickup_at||o.current_quantity!==o.quantity||o.current_shipping_fee!==o.shipping_fee||!Number.isSafeInteger(expected)||expected<=0)return "review";
  const s=await stripeCall(env,"checkout/sessions/"+encodeURIComponent(o.session_id));
  if(s.id!==o.session_id||!s.livemode||s.mode!=="payment"||s.currency!=="jpy"||s.payment_status!=="paid"||s.client_reference_id!==o.reservation_id||s.metadata?.reservation_id!==o.reservation_id||s.metadata?.generation!==String(o.generation)||s.payment_intent!==o.payment_intent||s.amount_total!==expected)return "review";
  const intent=await stripeCall(env,"payment_intents/"+encodeURIComponent(o.payment_intent));
  if(!intent.livemode||intent.status!=="succeeded"||intent.currency!=="jpy"||intent.amount_received!==expected||typeof intent.latest_charge!=="string")return "review";
  const charge=await stripeCall(env,"charges/"+encodeURIComponent(intent.latest_charge));
  if(charge.disputed||charge.payment_intent!==o.payment_intent||charge.amount!==expected||charge.currency!=="jpy")return "review";
  const existing=await stripeCall(env,"refunds?payment_intent="+encodeURIComponent(o.payment_intent)+"&limit=100");
  if(existing.has_more||!Array.isArray(existing.data))return "review";
  let refund;
  const active=existing.data.filter(f=>!["failed","canceled"].includes(f.status));
  if(active.length){
    if(active.length!==1||active[0].amount!==expected||active[0].payment_intent!==o.payment_intent)return "review";
    refund=active[0];
  }else{
    if(existing.data.length||charge.amount_refunded)return "review";
    refund=await stripeCall(env,"refunds",{payment_intent:o.payment_intent,amount:String(expected),"metadata[touchcd_reservation]":o.reservation_id},"touchcd-full-refund-"+o.reservation_id);
  }
  if(!refund?.id||refund.payment_intent!==o.payment_intent||refund.amount!==expected)return "review";
  const status=refund.status;
  await db.prepare("INSERT INTO automation_refunds(reservation_id,refund_id,status,amount,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(reservation_id) DO UPDATE SET refund_id=excluded.refund_id,status=excluded.status,updated_at=excluded.updated_at").bind(o.reservation_id,refund.id,status,expected,automationNow()).run();
  if(status==="succeeded"){
    await db.prepare("UPDATE reservations SET paid=0 WHERE id=? AND pickup_at IS NULL AND EXISTS(SELECT 1 FROM automation_campaigns a WHERE a.campaign_id=reservations.campaign_id AND a.outcome='failed')").bind(o.reservation_id).run();
    return "refunded";
  }
  return status==="pending"||status==="requires_action"?"waiting":"review";
}
async function automateOutcome(env,campaign,config){
  const db=env.DB,now=automationNow();
  if(config.outcome==="failed"&&config.refunds_enabled){
    const orders=await db.prepare("SELECT o.*,r.paid,r.pickup_at,r.quantity AS current_quantity,r.shipping_fee AS current_shipping_fee FROM stripe_orders o JOIN reservations r ON r.id=o.reservation_id LEFT JOIN automation_refunds f ON f.reservation_id=o.reservation_id WHERE o.campaign_id=? AND r.paid=1 AND (f.status IS NULL OR f.status IN ('pending','requires_action','succeeded')) ORDER BY COALESCE(f.updated_at,0) LIMIT 4").bind(campaign.id).all();
    for(const o of orders.results){
      const result=await refundAutomationOrder(env,o);
      if(result==="review"){
        await db.prepare("INSERT INTO automation_refunds(reservation_id,status,amount,updated_at) VALUES(?,'review',?,?) ON CONFLICT(reservation_id) DO UPDATE SET status='review',updated_at=excluded.updated_at").bind(o.reservation_id,o.unit_price*o.quantity+o.shipping_fee,now).run();
      }
    }
  }
  const rows=await db.prepare("SELECT r.id,r.email,r.paid,r.quantity,o.title,o.payment_intent,f.status AS refund_status,f.amount AS refund_amount FROM reservations r LEFT JOIN stripe_orders o ON o.reservation_id=r.id LEFT JOIN automation_refunds f ON f.reservation_id=r.id WHERE r.campaign_id=? AND r.email_verified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM automation_mail m WHERE m.reservation_id=r.id AND m.kind=CASE WHEN f.status='succeeded' THEN 'refund-complete' ELSE 'outcome-'+? END AND (m.state IN ('sent','sending') OR m.attempts>=5 OR m.updated_at>?)) LIMIT 8").bind(campaign.id,config.outcome,now-600).all();
  for(const r of rows.results){
    const refunded=r.refund_status==="succeeded";
    const kind=refunded?"refund-complete":"outcome-"+config.outcome;
    const text=config.outcome==="succeeded"?(r.paid?"製造条件を達成しました。お渡し・配送予定は作品ページをご確認ください。":"製造条件を達成しましたが、この予約のお支払いは確認できなかったため購入は成立していません。"):refunded?"商品代金と送料の全額 "+amount(r.refund_amount)+" の返金処理が完了しました。お支払い方法によって反映まで時間がかかります。":r.paid?"必要な入金数に達しなかったため製造を見送ります。商品代金・送料を全額返金します。返金完了のご連絡をお待ちください。":"製造条件に達しなかったため企画を終了しました。この予約のお支払いは確認されていません。";
    await lifecycleMail(env,r,kind,refunded?"返金完了":config.outcome==="succeeded"?"製造成立のお知らせ":"製造不成立のお知らせ",["作品："+campaign.title,text,stripeOrigin+releasePath(campaign),"touchCD"].join("\n\n"));
  }
}
async function runCampaignAutomation(env,id){
  const db=env.DB,token=crypto.randomUUID(),now=automationNow();
  const lock=await db.prepare("INSERT INTO automation_locks(campaign_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE automation_locks.expires_at<=?").bind(id,token,now+540,now).run();
  if(!lock.meta.changes)return;
  try{
    let config=await automationState(db,id);
    if(!config?.enabled)return;
    const campaign=await findCampaign(env,{id},true);
    if(!campaign?.managed||campaign.demo||campaign.visibility==="draft")return;
    const payment=await getPaymentSettings(db,campaign),deadline=Math.floor(Date.parse(payment.deadline)/1000);
    let error=null;
    if(!config.outcome){
      if(!Number.isFinite(deadline)||deadline*1000<=campaign.closesAt)error="支払期限を予約締切より後に設定してください。";
      else{
        const state=await publicData(env,campaign);
        if(now<deadline)await automateGuidesAndReminders(env,campaign,state,deadline);
        else error=await decideCampaign(env,campaign,state,deadline);
      }
      config=await automationState(db,id);
    }
    if(config.outcome)await automateOutcome(env,campaign,config);
    await db.prepare("UPDATE automation_campaigns SET last_checked=?,last_error=? WHERE campaign_id=?").bind(new Date().toISOString(),error,id).run();
  }catch(e){
    console.warn("Payment automation paused",e instanceof Error?e.name:"Unknown");
    await db.prepare("UPDATE automation_campaigns SET last_checked=?,last_error=? WHERE campaign_id=?").bind(new Date().toISOString(),"処理エラー。次回再確認します。",id).run();
  }finally{
    await db.prepare("DELETE FROM automation_locks WHERE campaign_id=? AND token=?").bind(id,token).run();
  }
}
async function runPaymentAutomation(env){
  if(!env.DB||!stripeReady(env)||!mailReady(env))return;
  await ensureReleaseDetails(env.DB);
  const campaigns=await env.DB.prepare("SELECT campaign_id FROM automation_campaigns WHERE enabled=1 ORDER BY COALESCE(last_checked,'') LIMIT 5").all();
  for(const row of campaigns.results)await runCampaignAutomation(env,row.campaign_id);
}
