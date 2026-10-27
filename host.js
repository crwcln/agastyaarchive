// Host panel: password-protected. Record or pick audio, then publish straight to the live site.
// Audio is split into 2 MB parts and sent through the same-origin API to EdgeOne Blob storage.
(()=>{
const CHUNK=2*1024*1024;
const UNITS=["Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const css=`
#hp{position:fixed;left:0;right:0;bottom:0;max-height:90vh;overflow:auto;background:var(--surface);color:var(--ink);border-top:3px solid var(--gold);padding:20px 20px calc(26px + env(safe-area-inset-bottom,0px));transform:translateY(105%);visibility:hidden;transition:transform .25s,visibility 0s .25s;z-index:9999;box-shadow:0 -12px 40px rgba(0,0,0,.35)}
#hp.open{transform:none;visibility:visible;transition:transform .25s}
#hp .in{max-width:640px;margin:0 auto}
#hp h2{font-size:26px}
#hp .top{display:flex;justify-content:space-between;align-items:center}
#hp .note{color:var(--mute);font-size:14px;margin:4px 0 14px}
#hp label{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin:12px 0 4px}
#hp input,#hp textarea,#hp select{width:100%;padding:10px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--ink);font:inherit}
#hp textarea{min-height:100px;resize:vertical}#hp .field-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 4px}#hp .field-head label{margin:0}#hp .field-head button{padding:6px 10px;border-color:var(--accent);color:var(--accent);font-size:12px;white-space:nowrap}#hp .ai-status{min-height:1.4em;margin:2px 0 8px;color:var(--mute);font-size:13px}#hp .ai-status[data-error="true"]{color:#d45c4c}#hp #hptr{min-height:190px;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
#hp input,#hp textarea{-webkit-user-select:text;user-select:text;pointer-events:auto;touch-action:manipulation}
#hp .pwrow{display:flex;gap:8px}#hp .pwrow input{flex:1}
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
#hp .acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}#hp .script-generator{margin:18px 0;padding:14px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}#hp .script-generator h3{font:700 17px 'Space Grotesk',sans-serif}#hp .script-generator .r2{grid-template-columns:repeat(3,minmax(0,1fr))}#hp .script-generator textarea{min-height:300px;font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}#hp .schedule-row{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}#hp .schedule-head{display:flex;justify-content:space-between;align-items:center;gap:10px}#hp .schedule-head h3{font:700 17px 'Space Grotesk',sans-serif}#hp .schedule-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}#hp .schedule-info{min-width:0}#hp .schedule-info b{display:block;overflow-wrap:anywhere}#hp .schedule-info span{display:block;color:var(--mute);font-size:12px}#hp .schedule-item input{grid-column:1/-1}#hp .schedule-actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px}#hp .schedule-actions button{font-size:12px;padding:6px 9px}
#hp progress{width:100%;margin-top:12px}
#hpmsg{font-size:14px;color:var(--mute)}
.del{position:absolute;top:14px;right:14px;font-size:12px;padding:3px 8px;color:var(--mute)}
footer a{color:var(--mute)}
@media (max-width:560px){#hp .r2{grid-template-columns:1fr}}`;
document.head.append(Object.assign(document.createElement("style"),{textContent:css}));
const panel=document.createElement("div");panel.id="hp";
panel.innerHTML=`<div class="in">
<div class="top"><h2>Host panel</h2><button id="hpx">Close</button></div>
<div id="hplock"><p class="note">Host access only.</p><label>Admin password</label><div class="pwrow"><input id="hppw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"><button type="button" id="hpshow">Show</button></div>
<div class="acts"><button class="go" id="hpunlock">Unlock</button><span id="hplmsg" class="note"></span></div></div>
<div id="hpform" hidden>
<p class="note">Record or pick audio, add the details, and publish. It goes live on the site immediately, no redeploy.</p>
<div class="rec"><span class="dot" id="hpdot"></span><b id="hptime">0:00</b>
<button id="hpstart">● Record</button><button id="hppause" disabled>Pause</button><button id="hpstop" disabled>Stop</button></div>
<label>…or choose an existing audio file</label><input type="file" id="hpfile" accept="audio/*">
<audio id="hpprev" controls hidden></audio>
<label>Date</label><input id="hpdate" type="date"><div id="publishScheduleField"><label for="hpwhen">Publish date and time (leave empty to publish now)</label><input id="hpwhen" type="datetime-local"></div>
<label>Title</label><input id="hptitle" placeholder="e.g. The Mongols Were NOT Just Raiders">
<label>Unit</label><select id="hpunit"></select>
<section id="scriptGenerator" class="script-generator"><div class="schedule-head"><h3>Script generator</h3><span class="note">Host-only draft</span></div><div class="r2"><div><label for="hpscriptTime">Length</label><select id="hpscriptTime"><option value="3">3 minutes</option><option value="5" selected>5 minutes</option><option value="8">8 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option></select></div><div><label for="hpscriptTone">Tone</label><select id="hpscriptTone"><option value="Energetic and conversational">Energetic and conversational</option><option value="Dryly funny">Dryly funny</option><option value="Dramatic storytelling">Dramatic storytelling</option><option value="Clear and classroom-friendly">Clear and classroom-friendly</option><option value="Sharp and argumentative">Sharp and argumentative</option></select></div><div><label for="hprant">Rant level</label><select id="hprant"></select></div></div><div class="acts"><button type="button" id="hpscriptGenerate" class="go">Generate script with AI</button><button type="button" id="hpscriptCopy">Copy script</button></div><div id="hpscriptStatus" class="ai-status" role="status" aria-live="polite"></div><textarea id="hpscript" placeholder="Your episode script will appear here. You can edit or copy it; it is not published with the episode."></textarea></section>
<div class="field-head"><label for="hpdesc">The rant (description)</label><button type="button" id="hpdescribe">Generate with AI</button></div><div id="hpdescribeStatus" class="ai-status" role="status" aria-live="polite"></div><textarea id="hpdesc" placeholder="A short episode description"></textarea><div id="transcriptField"><div class="field-head"><label for="hptr">Transcript</label><button type="button" id="hptranscribe">Transcribe audio</button></div><div id="hptranscribeStatus" class="ai-status" role="status" aria-live="polite"></div><textarea id="hptr" placeholder="Paste or edit the episode transcript"></textarea></div>
<progress id="hpprog" max="100" value="0" hidden></progress>
<div class="acts"><button class="go" id="hppub">Publish episode</button><span id="hpmsg"></span></div><div class="schedule-row"><div class="schedule-head"><h3>Scheduled episodes</h3><button type="button" id="hpschedrefresh">Refresh</button></div><div id="hpscheduled" class="note">Unlock to load scheduled episodes.</div></div>
</div></div>`;
document.body.append(panel);
const $=id=>panel.querySelector("#"+id),FEATURES=(window.SITE_CONFIG&&window.SITE_CONFIG.features)||{};
if(FEATURES.aiDescription!==true)$("hpdescribe").hidden=true;
if(FEATURES.scriptGenerator!==true)$("scriptGenerator").hidden=true;
if(FEATURES.transcribeAudio!==true)$("hptranscribe").hidden=true;
if(FEATURES.transcript===false)$("transcriptField").hidden=true;
if(FEATURES.episodeScheduling===false){$("hpscheduled").parentElement.hidden=true;$("publishScheduleField").hidden=true}
UNITS.forEach(u=>$("hpunit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("hprant").append(new Option("\u{1F525}".repeat(n),n,false,n===4)));
$("hpdate").value=new Date().toISOString().slice(0,10);

let pw=sessionStorage.getItem("hp_pw")||"",stream,rec,chunks=[],blob=null,transcriptWords=[],uploadId=null,uploadedBlob=null,uploadedParts=0,t0=0,acc=0,tick=null;
const msg=t=>$("hpmsg").textContent=t;
const fmtT=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
const elapsed=()=>acc+(rec&&rec.state==="recording"?(Date.now()-t0)/1000:0);
async function uploadPart(id,index,part){
  let r;
  try{r=await fetch("/api/episodes?id="+encodeURIComponent(id)+"&part="+index,{method:"PUT",headers:{"Content-Type":"application/octet-stream","x-admin-password":pw},body:part})}
  catch(e){throw new Error("Could not send upload part "+(index+1)+" to /api/episodes: "+e.message)}
  const t=await r.text();let d={};try{d=JSON.parse(t)}catch(e){}
  if(!r.ok)throw new Error(d.error||"Upload part "+(index+1)+" failed (HTTP "+r.status+")");
}
async function api(body){
  const r=await fetch("/api/episodes",{method:"POST",headers:{"Content-Type":"application/json","x-admin-password":pw},body:JSON.stringify(body)});
  const t=await r.text();let d={};try{d=JSON.parse(t)}catch(e){}
  if(!r.ok)throw new Error(d.error||(r.status===404?"API not found (HTTP 404): the cloud-functions folder isn’t deployed.":"HTTP "+r.status+(t?": "+t.slice(0,120):"")));
  if(!Object.keys(d).length)throw new Error("API returned something that isn’t JSON (functions probably aren’t deployed).");
  return d;
}
async function ensureUploaded(){
  if(uploadId&&uploadedBlob===blob)return {id:uploadId,parts:uploadedParts};
  const parts=Math.ceil(blob.size/CHUNK),started=await api({action:"upload-start",parts});
  for(let i=0;i<parts;i++){
    msg("Uploading audio part "+(i+1)+" of "+parts+"…");
    await uploadPart(started.id,i,blob.slice(i*CHUNK,(i+1)*CHUNK));
    $("hpprog").value=Math.round((i+1)/parts*100);
  }
  uploadId=started.id;uploadedBlob=blob;uploadedParts=parts;
  return {id:uploadId,parts:uploadedParts};
}
function localDateTime(iso){const d=new Date(iso),local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)}
async function loadScheduled(){
  const box=$("hpscheduled");if(!box||!pw)return;
  box.textContent="Loading…";
  try{
    const {episodes}=await api({action:"list-scheduled"});box.replaceChildren();
    if(!episodes.length){box.textContent="No episodes scheduled.";return}
    for(const episode of episodes){
      const row=document.createElement("div");row.className="schedule-item";
      const info=document.createElement("div");info.className="schedule-info";
      const title=document.createElement("b");title.textContent="EP "+episode.num+" · "+episode.title;
      const date=document.createElement("span");date.textContent="Scheduled for "+new Date(episode.publishAt).toLocaleString();info.append(title,date);
      const input=document.createElement("input");input.type="datetime-local";input.value=localDateTime(episode.publishAt);input.setAttribute("aria-label","Reschedule "+episode.title);
      const actions=document.createElement("div");actions.className="schedule-actions";
      const save=document.createElement("button");save.type="button";save.textContent="Save time";save.onclick=async()=>{if(!input.value){msg("Choose a schedule time.");return}save.disabled=true;try{await api({action:"set-schedule",id:episode.id,publishAt:new Date(input.value).toISOString()});msg("Schedule updated.");await loadScheduled()}catch(e){msg("Could not update schedule: "+e.message);save.disabled=false}};
      const now=document.createElement("button");now.type="button";now.textContent="Publish now";now.onclick=async()=>{if(!confirm("Publish “"+episode.title+"” now?"))return;now.disabled=true;try{await api({action:"publish-now",id:episode.id});msg("Episode published.");await loadScheduled();window.loadEpisodes&&window.loadEpisodes()}catch(e){msg("Could not publish episode: "+e.message);now.disabled=false}};
      const remove=document.createElement("button");remove.type="button";remove.textContent="Delete";remove.onclick=async()=>{if(!confirm("Delete scheduled episode “"+episode.title+"”?"))return;remove.disabled=true;try{await api({action:"delete",id:episode.id});msg("Scheduled episode deleted.");await loadScheduled()}catch(e){msg("Could not delete episode: "+e.message);remove.disabled=false}};
      actions.append(save,now,remove);row.append(info,input,actions);box.append(row);
    }
  }catch(e){box.textContent="Could not load scheduled episodes: "+e.message}
}
async function unlock(p){
  pw=p;
  try{await api({action:"check"});sessionStorage.setItem("hp_pw",pw);$("hplock").hidden=true;$("hpform").hidden=false;window.setAdmin&&window.setAdmin(pw);loadScheduled();return true}
  catch(e){pw="";sessionStorage.removeItem("hp_pw");$("hplmsg").textContent=e.message==="Wrong password"?"Wrong password.":"Couldn’t reach the API: "+e.message;return false}
}
$("hpshow").onclick=()=>{const i=$("hppw"),s=i.type==="password";i.type=s?"text":"password";$("hpshow").textContent=s?"Hide":"Show";i.focus()};
$("hpunlock").onclick=()=>unlock($("hppw").value);
$("hppw").addEventListener("keydown",e=>{if(e.key==="Enter")unlock($("hppw").value)});
if(pw)unlock(pw);

const open=v=>{panel.classList.toggle("open",v);if(v)setTimeout(()=>{const t=$("hplock").hidden?$("hptitle"):$("hppw");t.focus()},300)};
const live=on=>{$("hpdot").classList.toggle("live",on);$("hpstart").disabled=on;$("hppause").disabled=!on;$("hpstop").disabled=!on;$("hppause").textContent="Pause"};
function setAudio(b){transcriptWords=[];if(uploadId)api({action:"discard-upload",id:uploadId}).catch(()=>{});uploadId=null;uploadedBlob=null;uploadedParts=0;blob=b;$("hptr").value="";$("hpprev").src=URL.createObjectURL(b);$("hpprev").hidden=false;msg((b.size/1048576).toFixed(1)+" MB ready.")}

$("hpstart").onclick=async()=>{
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    const mt=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m=>MediaRecorder.isTypeSupported(m))||"";
    rec=new MediaRecorder(stream,{...(mt?{mimeType:mt}:{}),audioBitsPerSecond:48000});chunks=[];acc=0;
    rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
    rec.onstop=()=>{window.AAmusic&&AAmusic.hold("rec",false);clearInterval(tick);stream.getTracks().forEach(t=>t.stop());setAudio(new Blob(chunks,{type:rec.mimeType||mt}));live(false)};
    rec.start(1000);window.AAmusic&&AAmusic.hold("rec",true);t0=Date.now();tick=setInterval(()=>$("hptime").textContent=fmtT(elapsed()),250);live(true);msg("");
  }catch(e){msg("Mic blocked or unavailable: "+e.message)}
};
$("hppause").onclick=()=>{
  if(rec.state==="recording"){acc=elapsed();rec.pause();$("hppause").textContent="Resume";$("hpdot").classList.remove("live")}
  else if(rec.state==="paused"){t0=Date.now();rec.resume();$("hppause").textContent="Pause";$("hpdot").classList.add("live")}
};
$("hpstop").onclick=()=>{acc=elapsed();rec.stop()};
$("hpfile").onchange=e=>{const f=e.target.files[0];if(f)setAudio(f)};
$("hpschedrefresh").onclick=loadScheduled;
$("hptr").oninput=()=>{transcriptWords=[]};
$("hptranscribe").onclick=async()=>{
  const btn=$("hptranscribe"),prog=$("hpprog"),status=$("hptranscribeStatus");
  if(!blob){status.textContent="Choose or record an audio file first.";status.dataset.error="true";msg(status.textContent);return}
  btn.disabled=true;prog.hidden=false;prog.value=0;status.textContent="Preparing audio upload...";delete status.dataset.error;
  try{const upload=await ensureUploaded();status.textContent="Sending audio to Gemini for transcription...";const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});$("hptr").value=result.transcript||"";transcriptWords=Array.isArray(result.words)?result.words:[];status.textContent="Transcript ready. Review it before publishing.";msg(status.textContent)}
  catch(e){status.textContent="Transcription failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false;prog.hidden=true}
};
$("hpscriptGenerate").onclick=async()=>{
  const btn=$("hpscriptGenerate"),status=$("hpscriptStatus"),title=$("hptitle").value.trim();
  delete status.dataset.error;
  if(!title){status.textContent="Add an episode title or topic first.";status.dataset.error="true";return}
  btn.disabled=true;status.textContent="Generating your script with Gemini...";
  try{
    const result=await api({action:"generate-script",title,unit:$("hpunit").value,minutes:+$("hpscriptTime").value,tone:$("hpscriptTone").value,rant:+$("hprant").value,description:$("hpdesc").value.trim()});
    if(!result.script)throw new Error("Gemini returned no script.");
    $("hpscript").value=result.script;status.textContent="Script ready. Edit it or copy it for recording."
  }catch(e){status.textContent="Script generation failed: "+e.message;status.dataset.error="true"}
  finally{btn.disabled=false}
};
$("hpscriptCopy").onclick=async()=>{
  const status=$("hpscriptStatus"),script=$("hpscript").value.trim();
  if(!script){status.textContent="Generate a script before copying.";status.dataset.error="true";return}
  try{await navigator.clipboard.writeText(script);status.textContent="Script copied to clipboard.";delete status.dataset.error}
  catch(e){$("hpscript").select();status.textContent="Select and copy the highlighted script.";status.dataset.error="false"}
};
$("hpdescribe").onclick=async()=>{
  const btn=$("hpdescribe"),status=$("hpdescribeStatus");btn.disabled=true;delete status.dataset.error;
  try{
    let transcript=$("hptr").value.trim();
    if(!transcript&&blob){status.textContent="Transcribing audio first...";const upload=await ensureUploaded();const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});transcript=String(result.transcript||"").trim();$("hptr").value=transcript;transcriptWords=Array.isArray(result.words)?result.words:[]}
    if(!transcript)throw new Error("Choose audio or add a transcript first.");
    status.textContent="Generating description with Gemini...";
    const result=await api({action:"describe",title:$("hptitle").value,unit:$("hpunit").value,transcript});
    if(!result.description)throw new Error("Gemini returned no description.");
    $("hpdesc").value=result.description;status.textContent="Description ready. Review and edit it before publishing.";msg(status.textContent)
  }catch(e){status.textContent="Description generation failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false}
};

$("hppub").onclick=async()=>{
  const title=$("hptitle").value.trim();
  if(!blob){msg("Record or choose audio first.");return}
  if(!title){msg("Add a title first.");return}
  if($("hpwhen").value&&new Date($("hpwhen").value).getTime()<=Date.now()){msg("Choose a future publish time, or leave it blank to publish now.");return}
  const btn=$("hppub"),prog=$("hpprog");btn.disabled=true;prog.hidden=false;prog.value=0;
  try{
msg("Preparing upload…");
    const {id,parts}=await ensureUploaded();
    msg("Publishing…");
    const publishAt=$("hpwhen").value?new Date($("hpwhen").value).toISOString():null;
    const res=await api({action:"publish",episode:{id,title,unit:$("hpunit").value,date:$("hpdate").value,publishAt,rant:+$("hprant").value,desc:$("hpdesc").value,transcript:$("hptr").value,transcriptWords,size:blob.size,chunks:parts,type:(blob.type||"audio/mpeg").split(";")[0]}});
    if(res.episode.publishAt)msg("Episode "+res.episode.num+" scheduled for "+new Date(res.episode.publishAt).toLocaleString());else msg("Live! Episode "+res.episode.num+" is published.");
    blob=null;uploadId=null;uploadedBlob=null;uploadedParts=0;$("hpprev").hidden=true;$("hpprev").removeAttribute("src");$("hptime").textContent="0:00";["hptitle","hpdesc","hptr","hpscript","hpfile","hpwhen"].forEach(k=>$(k).value="");transcriptWords=[];$("hpscriptStatus").textContent="";
    window.loadEpisodes&&window.loadEpisodes();loadScheduled();
  }catch(e){msg("Failed: "+e.message)}
  btn.disabled=false;prog.hidden=true;
};

$("hpx").onclick=()=>open(false);
["keydown","keyup","keypress"].forEach(ev=>panel.addEventListener(ev,e=>{e.stopPropagation();if(ev==="keydown"&&e.key==="Escape")open(false)}));
const ft=document.querySelector("footer");
if(ft)ft.append(" · ",Object.assign(document.createElement("a"),{href:"#host",textContent:"Host panel",onclick:e=>{e.preventDefault();open(true)}}));
if(location.hash==="#host")open(true);
})();
