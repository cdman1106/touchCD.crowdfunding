(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const input=$("consultationFiles"), list=$("attachmentList"), status=$("attachmentStatus"), include=$("includeMockup");
  const allowed=["image/jpeg","image/png","image/webp"];
  const extras=[];
  const entries=()=>window.touchCDDesigns?.entries()||[];
  const previewWanted=()=>include.checked&&entries().length>0;
  const count=()=>entries().length+extras.length+(previewWanted()?1:0);
  function update(){
    list.replaceChildren();
    for(const item of [...entries(),...extras]){
      const row=document.createElement("div");row.className="attachment-row";
      const label=document.createElement("span");label.textContent=item.label+"｜"+item.file.name;
      const remove=document.createElement("button");remove.type="button";remove.className="alt";remove.textContent="削除";
      remove.onclick=()=>{if(item.key.startsWith("extra-")){const i=extras.indexOf(item);if(i>=0)extras.splice(i,1)}else window.touchCDDesigns?.clear(item.key);update()};
      row.append(label,remove);list.append(row);
    }
    if(previewWanted()){const p=document.createElement("p");p.textContent="完成予想図も添付予定";list.append(p)}
    status.textContent=count()+" / 8 枚"+(count()>8?" — 8枚以内になるよう画像を削除してください。":"");
    status.dataset.error=String(count()>8);
  }
  input.addEventListener("change",()=>{
    const files=[...input.files];input.value="";
    let rejected=0;
    for(const file of files){if(!allowed.includes(file.type)||file.size>10*1024*1024||!file.size||count()>=8){rejected++;continue}
      if(extras.some(x=>x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified)){rejected++;continue}
      extras.push({key:"extra-"+crypto.randomUUID(),label:"参考画像",file});
    }
    update();if(rejected)status.textContent+="（上限・形式・重複で追加できなかった画像："+rejected+"枚）";
  });
  include.addEventListener("change",update);document.addEventListener("touchcd-design-change",update);update();
  async function decode(blob){if(typeof createImageBitmap==="function"){try{return await createImageBitmap(blob)}catch{}}return await new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error("画像を読み込めませんでした"))};image.src=url})}
  const toBlob=(c,q)=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error("画像変換に失敗しました")),"image/jpeg",q));
  const base64=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(blob)});
  async function compress(file){
    const img=await decode(file);
    try{if(img.width<1||img.height<1||img.width*img.height>40000000)throw Error("画像サイズが大きすぎます");
      const c=document.createElement("canvas"),ctx=c.getContext("2d");
      for(const [size,quality] of [[1600,.85],[1280,.75],[1000,.70],[800,.64],[640,.55]]){
        const ratio=Math.min(1,size/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*ratio));c.height=Math.max(1,Math.round(img.height*ratio));ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);const b=await toBlob(c,quality);if(b.size<=500000)return b;
      }
      throw Error("画像を縮小できませんでした");
    }finally{img.close?.()}
  }
  window.touchCDAttachments={prepare:async()=>{
    await window.touchCDDesigns?.wait();if(count()>8)throw Error("添付画像を8枚以内にしてください。");
    const snapshot=[...entries(),...extras],out=[];
    const roles={jacket:"jacket",disc:"disc",back:"back",inner:"inner"};
    for(let i=0;i<snapshot.length;i++){
      const item=snapshot[i],blob=await compress(item.file);
      out.push({filename:(roles[item.key]||"reference-"+(i+1))+".jpg",content:await base64(blob)});
    }
    if(previewWanted()){
      const p=await window.touchCDDesigns.preview();
      if(!p)throw Error("完成予想図を作れませんでした。");
      const b=await compress(p);out.push({filename:"touchCD-preview.jpg",content:await base64(b)});
    }
    if(out.length>8||out.reduce((n,x)=>n+x.content.length,0)>5600000)throw Error("添付ファイルの合計が上限を超えています。");
    return out;
  }};
})();