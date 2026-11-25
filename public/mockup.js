(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("mockCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const images = { jacket: null, disc: null, back: null, inner: null, tray: null };
  const files = { jacket: null, disc: null, back: null, inner: null, tray: null };
  const generation = { jacket: 0, disc: 0, back: 0, inner: 0, tray: 0 };
  function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function fill(x,y,w,h,r,color){rr(x,y,w,h,r);ctx.fillStyle=color;ctx.fill()}
  function stroke(x,y,w,h,r,color,line=2){rr(x,y,w,h,r);ctx.strokeStyle=color;ctx.lineWidth=line;ctx.stroke()}
  function circle(x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()}
  function text(t,x,y,size=24,color="#24312a",weight=700,align="left"){ctx.font=weight+" "+size+"px system-ui, sans-serif";ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(t,x,y)}
  function cover(img,x,y,w,h){const scale=Math.max(w/img.width,h/img.height);const sw=w/scale,sh=h/scale;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h)}
  function artwork(x,y,w,h,inner=false){ctx.save();rr(x,y,w,h,3);ctx.clip();const img=inner?(images.inner||images.jacket):images.jacket;if(img){cover(img,x,y,w,h)}else{const g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,"#2b323d");g.addColorStop(1,"#9b4445");ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.strokeStyle="#dae8c2";ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(x+w*.58,y+h*.49,20+i*w*.11,0,Math.PI*2);ctx.stroke()}text("YOUR ARTIST",x+w/2,y+h*.77,Math.max(12,w*.09),"#fff",800,"center");text("JACKET DESIGN",x+w/2,y+h*.88,Math.max(9,w*.05),"#fff",500,"center")}ctx.restore();if(inner&&!images.inner){fill(x+8,y+h-22,w-16,18,4,"#253a2dcc");text("内側は仮配置",x+w/2,y+h-9,10,"#fff",600,"center")}}
  function caseBase(x,y,w,h){ctx.save();ctx.shadowColor="#15231d4a";ctx.shadowBlur=25;ctx.shadowOffsetY=13;fill(x,y,w,h,13,"#bdc9c2");ctx.restore();fill(x+3,y+3,w-6,h-6,11,"#e8ede9");stroke(x+3,y+3,w-6,h-6,11,"#fff",4);stroke(x+10,y+10,w-20,h-20,8,"#97a8a0",2)}
  function plastic(x,y,w,h){let g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,"#ffffffa8");g.addColorStop(.24,"#ffffff00");g.addColorStop(.75,"#ffffff00");g.addColorStop(1,"#ffffff80");fill(x,y,w,h,10,g);stroke(x+2,y+2,w-4,h-4,10,"#ffffff",3);stroke(x+9,y+9,w-18,h-18,6,"#a8b9b0",2);for(const yy of [y+20,y+h-29])fill(x+8,yy,14,9,3,"#ffffffc8")}
  function chain(x,y){ctx.save();ctx.strokeStyle="#72847a";ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();for(let i=0;i<8;i++){let a=-Math.PI*.2-i*.34;circle(x+25+i*10,y-14-18*Math.sin(i*.38),5,"#68796d");circle(x+23+i*10,y-16-18*Math.sin(i*.38),2,"#f6fff7")}ctx.restore()}
  function drawDisc(cx,cy,r){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();if(images.disc){cover(images.disc,cx-r,cy-r,r*2,r*2)}else{const g=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);g.addColorStop(0,"#d8e5b9");g.addColorStop(.5,"#6a8a58");g.addColorStop(1,"#dfe6cc");ctx.fillStyle=g;ctx.fillRect(cx-r,cy-r,r*2,r*2);ctx.strokeStyle="#ffffff6b";for(let a=r*.42;a<r;a+=12){ctx.beginPath();ctx.arc(cx,cy,a,0,Math.PI*2);ctx.stroke()}text("TOUCHCD",cx,cy-r*.42,r*.14,"#21392b",800,"center")}ctx.restore();ctx.strokeStyle="#ffffffb0";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,r-1,0,Math.PI*2);ctx.stroke();circle(cx,cy,r*.15,"#d6ded9c9");circle(cx,cy,r*.075,"#485950");ctx.strokeStyle="#f5fff8";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r*.15,0,Math.PI*2);ctx.stroke()}
  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);const bg=ctx.createLinearGradient(0,0,1200,1470);bg.addColorStop(0,"#252b30");bg.addColorStop(1,"#080b0d");ctx.fillStyle=bg;ctx.fillRect(0,0,1200,1470);
    text("touchCD.",55,70,42,"#eaf1e9",900);text("完成予想図 / DESIGN PREVIEW",55,107,21,"#a7b5ad",600);
    const w=345,h=310,x1=205,x2=650,y=190;
    text("01  表面・ジャケット",x1+w/2,155,23,"#eaf1e9",800,"center");text("02  ケース裏面",x2+w/2,155,23,"#eaf1e9",800,"center");
    chain(x1+w*.70,y-10);caseBase(x1,y,w,h);fill(x1+12,y+14,25,h-28,4,"#35483e");artwork(x1+41,y+16,w-58,h-32);plastic(x1,y,w,h);
    chain(x2+w*.70,y-10);caseBase(x2,y,w,h);fill(x2+15,y+15,w-30,h-30,6,"#26372e");if(images.back){ctx.save();rr(x2+15,y+15,w-30,h-30,5);ctx.clip();cover(images.back,x2+15,y+15,w-30,h-30);ctx.restore()}else{drawDisc(x2+w/2,y+h/2,h*.435)}plastic(x2,y,w,h);
    text("03  ケースを開いた状態",600,568,25,"#eaf1e9",800,"center");
    const ox=265,oy=620,ow=335,oh=300;chain(ox+ow+115,oy-10);caseBase(ox,oy,ow,oh);artwork(ox+15,oy+15,ow-30,oh-30,true);plastic(ox,oy,ow,oh);fill(ox+ow-4,oy+7,17,oh-14,6,"#b4c2b7");caseBase(ox+ow+10,oy,ow,oh);fill(ox+ow+24,oy+14,ow-28,oh-28,10,"#526258");drawDisc(ox+ow+10+ow/2,oy+oh/2,oh*.425);plastic(ox+ow+10,oy,ow,oh);
    text("04  ディスクを外した状態",600,984,25,"#eaf1e9",800,"center");
    const tx=75,ty=1040,tw=335,th=300;
    chain(tx+tw+115,ty-10);caseBase(tx,ty,tw,th);artwork(tx+15,ty+15,tw-30,th-30,true);plastic(tx,ty,tw,th);
    fill(tx+tw-4,ty+7,17,th-14,6,"#b4c2b7");const rx=tx+tw+10;caseBase(rx,ty,tw,th);ctx.save();rr(rx+14,ty+14,tw-28,th-28,5);ctx.clip();if(images.tray){cover(images.tray,rx+14,ty+14,tw-28,th-28)}else{fill(rx+14,ty+14,tw-28,th-28,5,"#3d414a");text("TRAY DESIGN",rx+tw/2,ty+th*.78,21,"#eaf1e9",700,"center")}ctx.restore();ctx.strokeStyle="#e9f2f3a0";ctx.lineWidth=4;ctx.beginPath();ctx.arc(rx+tw/2,ty+th/2,th*.425,0,Math.PI*2);ctx.stroke();circle(rx+tw/2,ty+th/2,25,"#dce9e6a8");circle(rx+tw/2,ty+th/2,9,"#718781");plastic(rx,ty,tw,th);
    drawDisc(980,1190,125);text("ディスク表面",980,1344,18,"#eaf1e9",700,"center");text("ディスク下のケース内側",rx+tw/2,1381,19,"#eaf1e9",700,"center");
    text("※ 簡易合成。ディスク裏面は印刷不可。実際の色・材質・印刷範囲は異なる場合があります。",55,1439,17,"#b6c1b9",500);
  }
  function status(message,error=false){$("mockupStatus").textContent=message;$("mockupStatus").dataset.error=String(error)}
  const keys=["jacket","disc","back","inner","tray"];
  const caps={jacket:"Jacket",disc:"Disc",back:"Back",inner:"Inner",tray:"Tray"};
  const roleNames={jacket:"表面ジャケット",disc:"ディスク表面",back:"ケース裏面",inner:"内側・左面",tray:"ディスクの下・ケース内側"};
  const notify=()=>document.dispatchEvent(new Event("touchcd-design-change"));
  function syncSlot(key){
    const cap=caps[key], thumb=$("thumb"+cap), name=$("name"+cap), remove=document.querySelector('[data-remove-design="'+key+'"]');
    thumb.hidden=!images[key];remove.hidden=!files[key];name.textContent=files[key]?.name||"未選択";
    if(images[key]){const t=thumb.getContext("2d"),img=images[key];t.clearRect(0,0,100,100);const scale=Math.min(100/img.width,100/img.height),w=img.width*scale,h=img.height*scale;t.drawImage(img,(100-w)/2,(100-h)/2,w,h)}
  }
  function clear(key){generation[key]++;images[key]?.close?.();images[key]=null;files[key]=null;$("mock"+caps[key]).value="";syncSlot(key);render();notify()}
  let pending=0;const tasks=new Map();
  async function decode(file){if(typeof createImageBitmap==="function"){try{return await createImageBitmap(file)}catch{}}return await new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error("decode"))};img.src=url})}
  async function load(input,key){
    const ticket=++generation[key],file=input.files?.[0];if(!file){clear(key);return}
    if(file.size>10*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)){input.value="";status("JPG・PNG・WebP（10MB以下）を選択してください。",true);return}
    pending++;status("デザイン画像を読み込んでいます…");notify();
    try{const img=await decode(file);if(ticket!==generation[key]){img.close?.();return}if(img.width<16||img.height<16||img.width*img.height>40000000){img.close?.();throw Error("size")}images[key]?.close?.();images[key]=img;files[key]=file;syncSlot(key);render();status(roleNames[key]+"を反映しました。")}
    catch{if(ticket===generation[key]){input.value="";status("画像を読み込めませんでした。別の画像をお試しください。",true)}}finally{pending--;notify()}
  }
  for(const key of keys){$("mock"+caps[key]).addEventListener("change",e=>{const task=load(e.target,key);tasks.set(key,task);task.finally(()=>{if(tasks.get(key)===task)tasks.delete(key)})});document.querySelector('[data-remove-design="'+key+'"]').addEventListener("click",()=>clear(key))}
  $("mockReset").addEventListener("click",()=>{for(const key of keys)clear(key);status("初期イメージに戻しました。")});
  window.touchCDDesigns={entries:()=>keys.filter(k=>files[k]).map(k=>({key:k,label:roleNames[k],file:files[k]})),wait:()=>Promise.all([...tasks.values()]),busy:()=>pending>0,clear,preview:()=>new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.86))};
  $("mockDownload").addEventListener("click",()=>{canvas.toBlob(blob=>{if(!blob){status("画像を保存できませんでした。",true);return}const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="touchCD-design-preview.png";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)},"image/png")});
  render();
})();