// Record page: record or upload audio, transcribe, describe, chapter, schedule and publish.
// Logic carried over from the old host drawer; auth and the page chrome now live in shell.js.
HOST.ready(()=>{
const CHUNK=2*1024*1024;
const UNITS=["Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const $=id=>document.getElementById(id),FEATURES=HOST.features;
if(FEATURES.aiDescription!==true)$("hpdescribe").hidden=true;
if(FEATURES.scriptGenerator!==true)$("scriptGenerator").hidden=true;
if(FEATURES.transcribeAudio!==true)$("hptranscribe").hidden=true;
if(FEATURES.transcript===false)$("transcriptField").hidden=true;
if(FEATURES.autoChapters!==true)$("chapterEditor").hidden=true;
if(FEATURES.episodeScheduling===false)$("publishScheduleField").hidden=true;
UNITS.forEach(u=>$("hpunit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("hprant").append(new Option("\u{1F525}".repeat(n),n,false,n===4)));
$("hpdate").value=new Date().toISOString().slice(0,10);
let pw=HOST.pw(),stream,rec,chunks=[],blob=null,transcriptWords=[],uploadId=null,uploadedBlob=null,uploadedParts=0,t0=0,acc=0,tick=null;
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
function chapterClock(seconds){const total=Math.max(0,Math.floor(seconds)),minutes=Math.floor(total/60),secs=String(total%60).padStart(2,"0");return minutes+":"+secs}
function parseChapterLines(){return $("hpchapters").value.split(/\r?\n/).map(line=>{const match=line.trim().match(/^(?:(\d+):)?(\d+):(\d{2})\s+(.+)$/);if(!match)return null;const time=Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3]);return {time,title:match[4].trim()}}).filter(chapter=>chapter&&chapter.title)}
async function maybeGenerateChapters(){
  if(FEATURES.autoChapters!==true||!$("hpautoChapters").checked)return;
  const status=$("hpchapterStatus");
  if(!transcriptWords.length){status.textContent="Chapters need a timestamped transcript; you can add chapters manually.";return}
  const bucketSeconds=15,groups=new Map();
  for(const word of transcriptWords){const time=Number(word.start),text=String(word.word||"").trim();if(!Number.isFinite(time)||!text)continue;const start=Math.floor(time/bucketSeconds)*bucketSeconds;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(text)}
  const segments=[...groups].sort((a,b)=>a[0]-b[0]).map(([time,words])=>({time,text:words.join(" ")}));
  const duration=Number.isFinite($("hpprev").duration)&&$("hpprev").duration>0?$("hpprev").duration:Math.max(...transcriptWords.map(word=>Number(word.end)||0));
  if(!segments.length||!duration){status.textContent="No timed transcript available for chapter generation.";return}
  status.textContent="Generating episode chapters with Gemini...";delete status.dataset.error;
  try{
    const started=await api({action:"generate-chapters",title:$("hptitle").value,unit:$("hpunit").value,duration,segments});
    if(!started.interactionId)throw new Error("Gemini did not start chapter generation.");
    const deadline=Date.now()+8*60*1000;let result;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,2500));
      status.textContent="Gemini is finding chapter breaks...";
      try{result=await api({action:"chapter-status",id:started.interactionId,duration})}catch(e){if(/HTTP 50[234]/.test(e.message))continue;throw e}
      if(result.status==="completed")break;
      if(result.error)throw new Error(result.error);
    }
    if(!result||result.status!=="completed")throw new Error("Chapter generation is taking too long. You can add chapters manually.");
    $("hpchapters").value=(result.chapters||[]).map(chapter=>chapterClock(chapter.time)+" "+chapter.title).join("\n");
    status.textContent=result.chapters&&result.chapters.length?result.chapters.length+" chapters ready. Review or edit them before publishing.":"No chapters were returned.";
  }catch(e){status.textContent="Chapter generation failed: "+e.message;status.dataset.error="true"}
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
const live=on=>{$("hpdot").classList.toggle("live",on);$("hpstart").disabled=on;$("hppause").disabled=!on;$("hpstop").disabled=!on;$("hppause").textContent="Pause"};
function setAudio(b){transcriptWords=[];$("hpchapters").value="";$("hpchapterStatus").textContent="";if(uploadId)api({action:"discard-upload",id:uploadId}).catch(()=>{});uploadId=null;uploadedBlob=null;uploadedParts=0;blob=b;$("hptr").value="";$("hpprev").src=URL.createObjectURL(b);$("hpprev").hidden=false;msg((b.size/1048576).toFixed(1)+" MB ready.")}

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
$("hptr").oninput=()=>{transcriptWords=[]};
$("hptranscribe").onclick=async()=>{
  const btn=$("hptranscribe"),prog=$("hpprog"),status=$("hptranscribeStatus");
  if(!blob){status.textContent="Choose or record an audio file first.";status.dataset.error="true";msg(status.textContent);return}
  btn.disabled=true;prog.hidden=false;prog.value=0;status.textContent="Preparing audio upload...";delete status.dataset.error;
  try{const upload=await ensureUploaded();status.textContent="Sending audio to Gemini for transcription...";const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});$("hptr").value=result.transcript||"";transcriptWords=Array.isArray(result.words)?result.words:[];status.textContent="Transcript ready. Review it before publishing.";await maybeGenerateChapters();msg(status.textContent)}
  catch(e){status.textContent="Transcription failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false;prog.hidden=true}
};
$("hpscriptGenerate").onclick=async()=>{
  const btn=$("hpscriptGenerate"),status=$("hpscriptStatus"),title=$("hptitle").value.trim();
  delete status.dataset.error;
  if(!title){status.textContent="Add an episode title or topic first.";status.dataset.error="true";return}
  btn.disabled=true;status.textContent="Generating your script with Gemini...";
  try{
    const started=await api({action:"generate-script",title,unit:$("hpunit").value,minutes:+$("hpscriptTime").value,tone:$("hpscriptTone").value,rant:+$("hprant").value,description:$("hpdesc").value.trim()});
    if(!started.interactionId)throw new Error("Gemini did not start script generation.");
    $("hpscriptJobId").value=started.interactionId;
    const deadline=Date.now()+15*60*1000;
    let result;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,2500));
      status.textContent="Gemini is writing the script... This can take a few minutes.";
      try{result=await api({action:"script-status",id:started.interactionId})}
      catch(e){if(/HTTP 50[234]/.test(e.message))continue;throw e}
      if(result.status==="completed")break;
      if(result.error)throw new Error(result.error);
    }
    if(!result||result.status!=="completed")throw new Error("Gemini is still working. Try generating again in a moment.");
    if(!result.script)throw new Error("Gemini returned no script.");
    $("hpscript").value=result.script;status.textContent="Script ready. Edit it or copy it for recording.";$("hpscriptDiag").hidden=true
  }catch(e){status.textContent="Script generation failed: "+e.message;status.dataset.error="true";$("hpscriptDiag").hidden=false}
  finally{btn.disabled=false}
};
$("hpscriptRecheck").onclick=async()=>{
  const btn=$("hpscriptRecheck"),diag=$("hpscriptDiagStatus"),id=$("hpscriptJobId").value.trim();btn.disabled=true;diag.textContent="Checking Gemini job...";
  try{
    const result=await api({action:"script-status",id});
    if(result.status==="completed"&&result.script){$("hpscript").value=result.script;diag.textContent="Script ready.";return}
    diag.textContent="Gemini job status: "+(result.status||"unknown");
  }catch(e){diag.textContent=e.message}
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
    if(!transcript&&blob){status.textContent="Transcribing audio first...";const upload=await ensureUploaded();const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});transcript=String(result.transcript||"").trim();$("hptr").value=transcript;transcriptWords=Array.isArray(result.words)?result.words:[];await maybeGenerateChapters()}
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
    if(FEATURES.autoChapters===true&&$("hpautoChapters").checked&&!parseChapterLines().length){
      if(!transcriptWords.length){
        msg("Transcribing audio to prepare episode chapters...");
        const transcriptResult=await api({action:"transcribe",id,parts,size:blob.size,type:blob.type});
        $("hptr").value=transcriptResult.transcript||"";
        transcriptWords=Array.isArray(transcriptResult.words)?transcriptResult.words:[];
      }
      await maybeGenerateChapters();
      if(!parseChapterLines().length)throw new Error("Automatic chapter generation failed. Uncheck the chapter option or add chapters manually, then publish again.");
    }
    msg("Publishing…");
    const publishAt=$("hpwhen").value?new Date($("hpwhen").value).toISOString():null;
    const res=await api({action:"publish",episode:{id,title,unit:$("hpunit").value,date:$("hpdate").value,publishAt,rant:+$("hprant").value,desc:$("hpdesc").value,transcript:$("hptr").value,transcriptWords,chapters:parseChapterLines(),size:blob.size,chunks:parts,type:(blob.type||"audio/mpeg").split(";")[0]}});
    if(res.episode.publishAt)msg("Episode "+res.episode.num+" scheduled for "+new Date(res.episode.publishAt).toLocaleString());else msg("Live! Episode "+res.episode.num+" is published.");
    blob=null;uploadId=null;uploadedBlob=null;uploadedParts=0;$("hpprev").hidden=true;$("hpprev").removeAttribute("src");$("hptime").textContent="0:00";["hptitle","hpdesc","hptr","hpscript","hpchapters","hpfile","hpwhen"].forEach(k=>$(k).value="");transcriptWords=[];$("hpscriptStatus").textContent="";
    $("hpdone").hidden=false;
  }catch(e){msg("Failed: "+e.message)}
  btn.disabled=false;prog.hidden=true;
};

});
