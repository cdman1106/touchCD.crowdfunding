// Isolated integration tests: real SQLite, actual Worker request handlers,
// simulated Stripe and email. Never use network or production data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const src=await readFile(new URL("../dist/server/index.js",import.meta.url),"utf8");
const makeWorker=new Function("fetch",src.replace("export default {","const testedWorker = {")+"\nreturn {worker:testedWorker, runPaymentAutomation, decideCampaign, findCampaign, publicData};");
const origin="https://touchcd-crowdfunding.com";
const secret="fixture-only-signing-secret-not-a-real-key";
const tests=[];
function check(label,condition){assert.ok(condition,label);tests.push(label);}
function localDB(){
  const sql=new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  function prepare(query,args=[]){
    return {
      bind(...values){return prepare(query,values);},
      async first(){return sql.prepare(query).get(...args)??null;},
      async all(){return {results:sql.prepare(query).all(...args)};},
      async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},
      batchRun(){return /^\s*(SELECT|PRAGMA)\b/i.test(query)?{results:sql.prepare(query).all(...args)}:{meta:{changes:Number(sql.prepare(query).run(...args).changes)}};}
    };
  }
  return {sql,prepare,async batch(statements){sql.exec("BEGIN");try{const result=statements.map(s=>s.batchRun());sql.exec("COMMIT");return result;}catch(e){sql.exec("ROLLBACK");throw e;}}};
}
function simulateStripe(){
  const sessions=new Map(), refunds=new Map(), intents=new Map(), charges=new Map();
  let serial=0, refundCalls=0;
  const fakeFetch=async(url,opts={})=>{
    const u=new URL(url);assert.equal(u.origin,"https://api.stripe.com","all external requests must be mocked");
    assert.equal(opts.headers.Authorization,"Bearer fixture-only-api-key");
    const path=u.pathname.slice(4),p=new URLSearchParams(opts.body);
    let out;
    if(path==="checkout/sessions"&&opts.method==="POST"){
      const id="cs_fixture_"+(++serial);
      const amount=Number(p.get("line_items[0][price_data][unit_amount]"))*Number(p.get("line_items[0][quantity]"))+Number(p.get("line_items[1][price_data][unit_amount]")||0);
      out={id,livemode:true,mode:"payment",currency:"jpy",amount_total:amount,status:"open",payment_status:"unpaid",client_reference_id:p.get("client_reference_id"),metadata:{reservation_id:p.get("metadata[reservation_id]"),generation:p.get("metadata[generation]")},payment_intent:null,url:"https://checkout.stripe.com/c/pay/"+id};
      sessions.set(id,out);
    }else if(path.startsWith("checkout/sessions/"))out=sessions.get(path.split("/").at(-1));
    else if(path.startsWith("payment_intents/"))out=intents.get(path.split("/").at(-1));
    else if(path.startsWith("charges/"))out=charges.get(path.split("/").at(-1));
    else if(path==="refunds"&&opts.method==="POST"){
      const pi=p.get("payment_intent"),amount=Number(p.get("amount"));assert.equal(amount,intents.get(pi).amount_received);
      assert.equal(refunds.has(pi),false,"duplicate refund call");
      refundCalls++;out={id:"re_fixture_"+refundCalls,payment_intent:pi,amount,status:"succeeded",currency:"jpy"};refunds.set(pi,out);
    }else if(path==="refunds"){const f=refunds.get(u.searchParams.get("payment_intent"));out={data:f?[f]:[],has_more:false};}
    if(!out)throw Error("unexpected simulated Stripe request: "+path);
    return Response.json(out);
  };
  function pay(session){
    const s=sessions.get(session),id="pi_fixture_"+session,charge="ch_fixture_"+session;
    Object.assign(s,{status:"complete",payment_status:"paid",payment_intent:id});
    intents.set(id,{id,livemode:true,status:"succeeded",currency:"jpy",amount:s.amount_total,amount_received:s.amount_total,latest_charge:charge});
    charges.set(charge,{id:charge,livemode:true,disputed:false,payment_intent:id,currency:"jpy",amount:s.amount_total,amount_refunded:0});
    return s;
  }
  return {fakeFetch,sessions,pay,refunds,get refundCalls(){return refundCalls;}};
}
async function flow(success){
  const db=localDB(),stripe=simulateStripe(),mail=[];
  const {worker,runPaymentAutomation}=makeWorker(stripe.fakeFetch);
  const env={DB:db,SHOW_DEMO_CAMPAIGNS:"0",RESERVATIONS_OPEN:"1",MAIL_PROVIDER:"cloudflare",MAIL_FROM:"fixture@example.test",EMAIL_VERIFICATION_SECRET:secret,STRIPE_SECRET_KEY:"fixture-only-api-key",STRIPE_WEBHOOK_SECRET:secret,STRIPE_PAYMENTS_ENABLED:"1",EMAIL:{async send(msg){mail.push(msg);}}};
  const q="?artist=fixture&project=fixture";
  const run=(path,body,headers={})=>worker.fetch(new Request(origin+path,{method:body===undefined?"GET":"POST",headers:{Origin:origin,"Content-Type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const call=async(path,body,status)=>{const r=await run(path,body);const result=await r.json();assert.equal(r.status,status,path+": "+JSON.stringify(result));return result;};
  const tag=success?"成立":"不成立";
  try{
    await run("/api/campaign"+q);
    const future=new Date(Date.now()+86400_000).toISOString(),deadline=new Date(Date.now()+3*86400_000).toISOString();
    db.sql.prepare("INSERT INTO artists(slug,name) VALUES(?,?)").run("fixture","Fixture artist");
    db.sql.prepare("INSERT INTO projects(id,artist_slug,slug,title,price,deadline,visibility,reservation_open,shipping_fee,pickup,shipping_note) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("fixture","fixture","fixture","Fixture",3000,future,"listed",1,500,"Fixture pickup","Fixture delivery");
    db.sql.prepare("INSERT INTO campaign_settings(campaign_id,reservation_goal,paid_goal,capacity) VALUES(?,?,?,?)").run("fixture",2,2,10);
    db.sql.prepare("INSERT INTO project_payment_settings(campaign_id,deadline) VALUES(?,?)").run("fixture",deadline);
    db.sql.prepare("INSERT INTO automation_campaigns(campaign_id,enabled,refunds_enabled) VALUES(?,1,1)").run("fixture");
    const codeFromMail=()=>mail.at(-1).text.match(/認証コード：(\d{6})/)[1];
    async function reserve(email,shipping){
      const verify=await call("/api/verify-email"+q,{email},200),code=codeFromMail();
      const form={name:"Fixture",email,quantity:1,verificationId:verify.verificationId,code,consent:true,price:3000,fulfillment:shipping?"shipping":"pickup",...(shipping?{shippingFee:500,postalCode:"1234567",shippingAddress:"Fixture address"}:{})};
      const wrong=code==="000000"?"111111":"000000";
      await call("/api/reservations"+q,{...form,code:wrong},422);
      const reservation=await call("/api/reservations"+q,form,201);
      check(tag+" 正しい認証コードで予約・確認メール",reservation.confirmationSent===true);
      await call("/api/reservations"+q,form,422);
      return reservation.id;
    }
    const id1=await reserve("one@example.test",false);
    await runPaymentAutomation(env);
    check(tag+" 目標未達時は決済案内なし",db.sql.prepare("SELECT count(*) AS n FROM stripe_orders").get().n===0);
    const id2=await reserve("two@example.test",true);
    await runPaymentAutomation(env);
    const orders=db.sql.prepare("SELECT * FROM stripe_orders ORDER BY reservation_id").all();
    check(tag+" 目標達成時は自動で決済案内2件",orders.length===2&&orders.every(o=>o.guide_sent_at));
    const guideCount=mail.filter(m=>m.subject.includes("お支払いのご案内")).length;
    await runPaymentAutomation(env);
    check(tag+" 案内の重複送信防止",guideCount===2&&mail.filter(m=>m.subject.includes("お支払いのご案内")).length===2);
    const lookup=await call("/api/lookup-code"+q,{email:"two@example.test"},200),lookupCode=codeFromMail();
    const body={email:"two@example.test",verificationId:lookup.verificationId,code:lookupCode};
    const result=await call("/api/lookup-reservations"+q,body,200);
    check(tag+" メール認証後に本人の3500円決済リンク",result.reservations.length===1&&result.reservations[0].total===3500&&result.reservations[0].paymentPath);
    await call("/api/lookup-reservations"+q,body,422);
    const links=[id1,id2].map(id=>orders.find(o=>o.reservation_id===id));
    for(const o of links){const res=await run("/payment/"+o.token,{});check(tag+" Checkoutへ安全なリダイレクト",res.status===303&&res.headers.get("Location").startsWith("https://checkout.stripe.com/"));}
    const updated=[id1,id2].map(id=>db.sql.prepare("SELECT * FROM stripe_orders WHERE reservation_id=?").get(id));
    check(tag+" 商品代と送料が正確",stripe.sessions.get(updated[0].session_id).amount_total===3000&&stripe.sessions.get(updated[1].session_id).amount_total===3500);
    async function event(s,valid=true){
      const raw=JSON.stringify({type:"checkout.session.completed",data:{object:s}}),ts=String(Math.floor(Date.now()/1000)),enc=new TextEncoder();
      const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      const sig=Buffer.from(await crypto.subtle.sign("HMAC",key,enc.encode(ts+"."+raw))).toString("hex");
      return worker.fetch(new Request(origin+"/api/stripe/webhook",{method:"POST",headers:{"Stripe-Signature":"t="+ts+",v1="+(valid?sig:"0".repeat(64))},body:raw}),env);
    }
    const paid1=stripe.pay(updated[0].session_id);
    const invalid=await event(paid1,false);check(tag+" 偽署名の拒否",invalid.status===400&&db.sql.prepare("SELECT paid FROM reservations WHERE id=?").get(id1).paid===0);
    const wrongAmount=await event({...paid1,amount_total:2999});check(tag+" 金額不一致拒否",wrongAmount.status===409);
    const completed=await event(paid1);check(tag+" 入金反映",completed.status===200&&db.sql.prepare("SELECT paid FROM reservations WHERE id=?").get(id1).paid===1);
    const receiptCount=mail.filter(m=>m.subject.includes("お支払い完了")).length;
    check(tag+" 受取番号1の完了メール",receiptCount===1&&mail.some(m=>m.text.includes("受取コード：1")));
    await event(paid1);
    check(tag+" 二重通知でメール・受取番号重複なし",mail.filter(m=>m.subject.includes("お支払い完了")).length===receiptCount&&db.sql.prepare("SELECT count(*) AS n FROM pickup_numbers").get().n===1);
    if(success){const paid2=stripe.pay(updated[1].session_id);assert.equal((await event(paid2)).status,200);check(tag+" 送料込みの決済完了メール",mail.some(m=>m.subject.includes("お支払い完了")&&m.text.includes("3,500")&&m.text.includes("自宅配送")));}
    await runPaymentAutomation(env);
    check(tag+" 支払期限前の製造判定・返金なし",db.sql.prepare("SELECT outcome FROM automation_campaigns").get().outcome===null&&stripe.refundCalls===0);
    // End the fixture's reservation/payment periods without changing the real clock.
    const past=new Date(Date.now()-4*3600_000).toISOString();
    db.sql.prepare("UPDATE projects SET deadline=? WHERE id='fixture'").run(new Date(Date.now()-5*3600_000).toISOString());
    db.sql.prepare("UPDATE project_payment_settings SET deadline=? WHERE campaign_id='fixture'").run(past);
    db.sql.prepare("UPDATE stripe_orders SET deadline=?").run(Math.floor(Date.now()/1000)-7200);
    if(!success){
      await runPaymentAutomation(env);
      check(tag+" 未確定決済がある間は判定しない",db.sql.prepare("SELECT outcome FROM automation_campaigns").get().outcome===null);
      stripe.sessions.get(updated[1].session_id).status="expired";
    }
    await runPaymentAutomation(env);
    const outcome=db.sql.prepare("SELECT outcome,outcome_paid,outcome_goal,last_error FROM automation_campaigns").get();
    check(tag+" 製造判定の結果",outcome.outcome===(success?"succeeded":"failed")&&outcome.outcome_paid===(success?2:1)&&outcome.outcome_goal===2&&!outcome.last_error);
    check(tag+" 最終判定後の受付終了",db.sql.prepare("SELECT reservation_open FROM projects").get().reservation_open===0);
    check(tag+" 成立時は返金せず、不成立時のみ全額返金",stripe.refundCalls===(success?0:1)&&(!success?db.sql.prepare("SELECT status,amount FROM automation_refunds").get().status==="succeeded"&&db.sql.prepare("SELECT amount FROM automation_refunds").get().amount===3000:true));
    check(tag+" 購入者への結果通知",mail.some(m=>m.subject.includes(success?"製造成立":"返金完了")));
    if(!success)check(tag+" 返金後の入金フラグ解除",db.sql.prepare("SELECT paid FROM reservations WHERE id=?").get(id1).paid===0);
    await runPaymentAutomation(env);
    check(tag+" 再実行しても二重返金なし",stripe.refundCalls===(success?0:1));
  } finally {db.sql.close();}
}
await flow(true);
await flow(false);
console.log("touchCD isolated lifecycle checks passed: "+tests.length);
for(const label of tests)console.log("PASS "+label);
