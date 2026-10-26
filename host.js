// Host panel: password-protected. Record or pick audio, then publish straight to the live site.
// Audio is split into 2 MB parts and uploaded directly to EdgeOne Blob storage via pre-signed URLs.
(()=>{
const CHUNK=2*1024*1024;
const UNITS=["Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const css=`
#hp{position:fixed;left:0;right:0;bottom:0;max-height:90vh;overflow:auto;background:var(--surface);color:var(--ink);border-top:3px solid var(--gold);padding:20px 20px calc(26px + env(safe-area-inset-bottom,0px));transform:translateY(105%);visibility:hidden;transition:transform .25s,visibility 0s .25s;z-index:50;box-shadow:0 -12px 40px rgba(0,0,0,.35)}
#hp.open{transform:none;visibility:visible;transition:transform .25s}
#hp .in{max-width:640px;margin:0 auto}
#hp h2{font-size:26px}
#hp .top{display:flex;justify-content:space-between;align-items:center}
#hp .note{color:var(--mute);font-size:14px;margin:4px 0 14px}
#hp label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin:12px 0 4px}
#hp input,#hp textarea,#hp select{width:100%;padding:10px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);font:inherit}
#hp textarea{min-height:100px;resize:vertical}
#hp .r2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#hp .rec{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
#hp .rec b{font:700 22px 'Space Grotesk',sans-serif;min-width:58px}
#hp .dot{width:12px;height:12px;border-radius:50%;background:var(--line)}
#hp .dot.live{background:#e5322d;animation:hpb 1s infinite}
@keyframes hpb{50%{opacity:.25}}
#hp button,.del{font:700 14px 'Space Grotesk',sans-serif;padding:9px 16px;border-radius:4px;border:1px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
#hp button:disabled{opacity:.4;cursor:default}
#hp .go{background:var(--accent);border-color:var(--accent);color:var(--btn)}
#hp audio{width:100%;margin-top:12px}
#hp .acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
#hp progress{width:100%;margin-top:12px}
#hpmsg{font-size:14px;color:var(--mute)}
.del{position:absolute;top:14px;right:14px;font-size:12px;padding:3px 8px;color:var(--mute)}
footer a{color:var(--mute)}
@media (max-width:560px){#hp .r2{grid-template-columns:1fr}}`;
document.head.append(Object.assign(document.createElement("style"),{textContent:css}));
const panel=document.createElement("div");panel.id="hp";
panel.innerHTML=`<div class="in">
<div class="top"><h2>Host panel</h2><button id="hpx">Close</button></div>
<div id="hplock"><p class="note">Host access only.</p><label>Admin password</label><input id="hppw" type="password" autocomplete="current-password">
<div class="acts"><button class="go" id="hpunlock">Unlock</button><span id="hplmsg" class="note"></span></div></div>
<div id="hpform" hidden>
<p class="note">Record or pick audio, add the details, and publish. It goes live on the site immediately, no redeploy.</p>
<div class="rec"><span class="dot" id="hpdot"></span><b id="hptime">0:00</b>
<button id="hpstart">● Record</button><button id="hppause" disabled>Pause</button><button id="hpstop" disabled>Stop</button></div>
<label>…or choose an existing audio file</label><input type="file" id="hpfile" accept="audio/*">
<audio id="hpprev" controls hidden></audio>
<div class="r2"><div><label>Date</label><input id="hpdate" type="date"></div><div><label>Rant level</label><select id="hprant"></select></div></div>
<label>Title</label><input id="hptitle" placeholder="e.g. The Mongols Were NOT Just Raiders">
<label>Unit</label><select id="hpunit"></select>
<label>The rant (description)</label><textarea id="hpdesc"></textarea>
<progress id="hpprog" max="100" value="0" hidden></progress>
<div class="acts"><button class="go" id="hppub">Publish episode</button><span id="hpmsg"></span></div>
</div></div>`;
document.body.append(panel);
const $=id=>panel.querySelector("#"+id);
UNITS.forEach(u=>$("hpunit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("hprant").append(new Option("\u{1F525}".repeat(n),n,false,n===4)));
$("hpdate").value=new Date().toISOString().slice(0,10);

let pw=sessionStorage.getItem("hp_pw")||"",stream,rec,chunks=[],blob=null,t0=0,acc=0,tick=null;
const msg=t=>$("hpmsg").textContent=t;
const fmtT=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
const elapsed=()=>acc+(rec&&rec.state==="recording"?(Date.now()-t0)/1000:0);
async function api(body){
  const r=await fetch("/api/episodes",{method:"POST",headers:{"Content-Type":"application/json","x-admin-password":pw},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"HTTP "+r.status);return d;
}
async function unlock(p){
  pw=p;
  try{await api({action:"check"});sessionStorage.setItem("hp_pw",pw);$("hplock").hidden=true;$("hpform").hidden=false;window.setAdmin&&window.setAdmin(pw);return true}
  catch(e){pw="";sessionStorage.removeItem("hp_pw");$("hplmsg").textContent=e.message==="Wrong password"?"Wrong password.":"Couldn’t reach the API: "+e.message;return false}
}
$("hpunlock").onclick=()=>unlock($("hppw").value);
$("hppw").onkeydown=e=>e.key==="Enter"&&unlock($("hppw").value);
if(pw)unlock(pw);

const open=v=>panel.classList.toggle("open",v);
const live=on=>{$("hpdot").classList.toggle("live",on);$("hpstart").disabled=on;$("hppause").disabled=!on;$("hpstop").disabled=!on;$("hppause").textContent="Pause"};
function setAudio(b){blob=b;$("hpprev").src=URL.createObjectURL(b);$("hpprev").hidden=false;msg((b.size/1048576).toFixed(1)+" MB ready.")}

$("hpstart").onclick=async()=>{
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    const mt=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m=>MediaRecorder.isTypeSupported(m))||"";
    rec=new MediaRecorder(stream,{...(mt?{mimeType:mt}:{}),audioBitsPerSecond:48000});chunks=[];acc=0;
    rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
    rec.onstop=()=>{clearInterval(tick);stream.getTracks().forEach(t=>t.stop());setAudio(new Blob(chunks,{type:rec.mimeType||mt}));live(false)};
    rec.start(1000);t0=Date.now();tick=setInterval(()=>$("hptime").textContent=fmtT(elapsed()),250);live(true);msg("");
  }catch(e){msg("Mic blocked or unavailable: "+e.message)}
};
$("hppause").onclick=()=>{
  if(rec.state==="recording"){acc=elapsed();rec.pause();$("hppause").textContent="Resume";$("hpdot").classList.remove("live")}
  else if(rec.state==="paused"){t0=Date.now();rec.resume();$("hppause").textContent="Pause";$("hpdot").classList.add("live")}
};
$("hpstop").onclick=()=>{acc=elapsed();rec.stop()};
$("hpfile").onchange=e=>{const f=e.target.files[0];if(f)setAudio(f)};

$("hppub").onclick=async()=>{
  const title=$("hptitle").value.trim();
  if(!blob){msg("Record or choose audio first.");return}
  if(!title){msg("Add a title first.");return}
  const btn=$("hppub"),prog=$("hpprog");btn.disabled=true;prog.hidden=false;prog.value=0;
  try{
    const parts=Math.ceil(blob.size/CHUNK);
    msg("Preparing upload…");
    const {id,urls}=await api({action:"upload-urls",parts});
    for(let i=0;i<parts;i++){
      msg(`Uploading part ${i+1} of ${parts}…`);
      const r=await fetch(urls[i],{method:"PUT",headers:{"Content-Type":"application/octet-stream"},body:blob.slice(i*CHUNK,(i+1)*CHUNK)});
      if(!r.ok)throw new Error("Upload failed on part "+(i+1)+" (HTTP "+r.status+")");
      prog.value=Math.round((i+1)/parts*100);
    }
    msg("Publishing…");
    const res=await api({action:"publish",episode:{id,title,unit:$("hpunit").value,date:$("hpdate").value,rant:+$("hprant").value,desc:$("hpdesc").value,size:blob.size,chunks:parts,type:(blob.type||"audio/mpeg").split(";")[0]}});
    msg("Live! Episode "+res.episode.num+" is published.");
    blob=null;$("hpprev").hidden=true;$("hpprev").removeAttribute("src");$("hptime").textContent="0:00";["hptitle","hpdesc","hpfile"].forEach(k=>$(k).value="");
    window.loadEpisodes&&window.loadEpisodes();
  }catch(e){msg("Failed: "+e.message)}
  btn.disabled=false;prog.hidden=true;
};

$("hpx").onclick=()=>open(false);
addEventListener("keydown",e=>e.key==="Escape"&&open(false));
const ft=document.querySelector("footer");
if(ft)ft.append(" · ",Object.assign(document.createElement("a"),{href:"#host",textContent:"Host panel",onclick:e=>{e.preventDefault();open(true)}}));
if(location.hash==="#host")open(true);
})();