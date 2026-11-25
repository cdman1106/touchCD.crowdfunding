(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("mockCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const images = { jacket: null, disc: null };
  const generation = { jacket: 0, disc: 0 };
  function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function fill(x,y,w,h,r,color){rr(x,y,w,h,r);ctx.fillStyle=color;ctx.fill()}
  function stroke(x,y,w,h,r,color,line=2){rr(x,y,w,h,r);ctx.strokeStyle=color;ctx.lineWidth=line;ctx.stroke()}
  function circle(x,y,r,color){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()}
  function text(t,x,y,size=24,color="#24312a",weight=700,align="left"){ctx.font=weight+" "+size+"px system-ui, sans-serif";ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(t,x,y)}
  function cover(img,x,y,w,h){const scale=Math.max(w/img.width,h/img.height);const sw=w/scale,sh=h/scale;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h)}
  function artwork(x,y,w,h,inner=false){ctx.save();rr(x,y,w,h,3);ctx.clip();if(images.jacket){cover(images.jacket,x,y,w,h)}else{const g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,"#1c3428");g.addColorStop(1,"#a6bb71");ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.strokeStyle="#dae8c2";ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(x+w*.58,y+h*.49,20+i*w*.11,0,Math.PI*2);ctx.stroke()}text("YOUR ARTIST",x+w/2,y+h*.77,Math.max(12,w*.09),"#fff",800,"center");text("JACKET DESIGN",x+w/2,y+h*.88,Math.max(9,w*.05),"#fff",500,"center")}ctx.restore();if(inner){fill(x+8,y+h-22,w-16,18,4,"#253a2dcc");text("内側は仮配置",x+w/2,y+h-9,10,"#fff",600,"center")}}
  function caseBase(x,y,w,h){ctx.save();ctx.shadowColor="#15231d4a";ctx.shadowBlur=25;ctx.shadowOffsetY=13;fill(x,y,w,h,13,"#bdc9c2");ctx.restore();fill(x+3,y+3,w-6,h-6,11,"#e8ede9");stroke(x+3,y+3,w-6,h-6,11,"#fff",4);stroke(x+10,y+10,w-20,h-20,8,"#97a8a0",2)}
  function plastic(x,y,w,h){let g=ctx.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,"#ffffffa8");g.addColorStop(.24,"#ffffff00");g.addColorStop(.75,"#ffffff00");g.addColorStop(1,"#ffffff80");fill(x,y,w,h,10,g);stroke(x+2,y+2,w-4,h-4,10,"#ffffff",3);stroke(x+9,y+9,w-18,h-18,6,"#a8b9b0",2);for(const yy of [y+20,y+h-29])fill(x+8,yy,14,9,3,"#ffffffc8")}
  function chain(x,y){ctx.save();ctx.strokeStyle="#72847a";ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();for(let i=0;i<8;i++){let a=-Math.PI*.2-i*.34;circle(x+25+i*10,y-14-18*Math.sin(i*.38),5,"#68796d");circle(x+23+i*10,y-16-18*Math.sin(i*.38),2,"#f6fff7")}ctx.restore()}
  function drawDisc(cx,cy,r){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();if(images.disc){cover(images.disc,cx-r,cy-r,r*2,r*2)}else{const g=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);g.addColorStop(0,"#d8e5b9");g.addColorStop(.5,"#6a8a58");g.addColorStop(1,"#dfe6cc");ctx.fillStyle=g;ctx.fillRect(cx-r,cy-r,r*2,r*2);ctx.strokeStyle="#ffffff6b";for(let a=r*.42;a<r;a+=12){ctx.beginPath();ctx.arc(cx,cy,a,0,Math.PI*2);ctx.stroke()}text("TOUCHCD",cx,cy-r*.42,r*.14,"#21392b",800,"center")}ctx.restore();ctx.strokeStyle="#ffffffb0";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,r-1,0,Math.PI*2);ctx.stroke();circle(cx,cy,r*.15,"#d6ded9c9");circle(cx,cy,r*.075,"#485950");ctx.strokeStyle="#f5fff8";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r*.15,0,Math.PI*2);ctx.stroke()}
  function render(){ctx.clearRect(0,0,canvas.width,canvas.height);const bg=ctx.createLinearGradient(0,0,1200,770);bg.addColorStop(0,"#f5f8ef");bg.addColorStop(1,"#d9e2d7");ctx.fillStyle=bg;ctx.fillRect(0,0,1200,770);text("touchCD.",55,75,42,"#25392b",900);text("完成予想図 / DESIGN PREVIEW",55,110,21,"#566a5a",600);text("表面",55,174,25);text("ケースを開いた状態",474,174,25);
    const x=55,y=245,w=345,h=332;chain(x+w*.70,y-10);caseBase(x,y,w,h);fill(x+12,y+14,25,h-28,4,"#35483e");artwork(x+41,y+16,w-58,h-32);plastic(x,y,w,h);
    const ox=470,oy=285,ow=335,oh=320;chain(ox+ow+115,oy-10);caseBase(ox,oy,ow,oh);artwork(ox+15,oy+15,ow-30,oh-30,true);plastic(ox,oy,ow,oh);fill(ox+ow-4,oy+7,17,oh-14,6,"#b4c2b7");caseBase(ox+ow+10,oy,ow,oh);fill(ox+ow+24,oy+14,ow-28,oh-28,10,"#526258");drawDisc(ox+ow+10+ow/2,oy+oh/2,oh*.425);plastic(ox+ow+10,oy,ow,oh);
    text("ジャケットデザイン",x+w/2,625,19,"#415547",700,"center");text("ディスクデザイン",ox+ow+10+ow/2,647,19,"#415547",700,"center");text("※ イメージ合成。印刷・色・材質・内側の仕様は実物と異なる場合があります。",55,727,18,"#5d6e62",500);
  }
  function status(message,error=false){$("mockupStatus").textContent=message;$("mockupStatus").dataset.error=String(error)}
  async function load(input,key){const ticket=++generation[key];const file=input.files?.[0];if(!file){images[key]?.close?.();images[key]=null;render();return}if(file.size>10*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)){input.value="";status("JPG・PNG・WebP（10MB以下）を選択してください。",true);return}try{const img=await createImageBitmap(file);if(ticket!==generation[key]){img.close();return}if(img.width<16||img.height<16||img.width*img.height>40000000){img.close();throw Error("Image size")}images[key]?.close?.();images[key]=img;render();status("デザインを完成予想図に反映しました。")}catch{if(ticket===generation[key]){input.value="";status("画像を読み込めませんでした。別の画像をお試しください。",true)}}}
  $("mockJacket").addEventListener("change",e=>load(e.target,"jacket"));
  $("mockDisc").addEventListener("change",e=>load(e.target,"disc"));
  $("mockReset").addEventListener("click",()=>{for(const k of ["jacket","disc"]){generation[k]++;images[k]?.close?.();images[k]=null}$("mockJacket").value="";$("mockDisc").value="";render();status("初期イメージに戻しました。")});
  $("mockDownload").addEventListener("click",()=>{canvas.toBlob(blob=>{if(!blob){status("画像を保存できませんでした。",true);return}const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="touchCD-design-preview.png";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)},"image/png")});
  render();
})();