// Record page: record or upload audio, transcribe, describe, chapter, schedule and publish.
// Logic carried over from the old host drawer; auth and the page chrome now live in shell.js.
HOST.ready(()=>{
const CHUNK=2*1024*1024;
const UNITS=["Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const $=id=>document.getElementById(id),FEATURES=HOST.features;
if(FEATURES.aiDescription!==true)$("hpdescribe").hidden=true;
if(FEATURES.scriptGenerator!==true)$("scriptGenerator").hidden=true;
if(FEATURES.transcribeAudio!==true)$("hptranscribe").hidden=true;
if(FEATURES.transcriptCleanup!==true)$("hpcleanup").hidden=true;
if(FEATURES.liveCaptions!==true)$("hpliveCaptionLabel").hidden=true;
if(FEATURES.transcript===false)$("transcriptField").hidden=true;
if(FEATURES.autoChapters!==true)$("chapterEditor").hidden=true;
if(FEATURES.episodeScheduling===false)$("publishScheduleField").hidden=true;
if(FEATURES.transcript===false&&FEATURES.autoChapters!==true)$("trCard").hidden=true;
if(FEATURES.episodeDrafts===false)$("hpsavedraft").hidden=true;
UNITS.forEach(u=>$("hpunit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("hprant").append(new Option("\u{1F525}".repeat(n),n,false,n===4)));
$("hpdate").value=new Date().toISOString().slice(0,10);
const recordParams=new URLSearchParams(location.hash.includes("?")?location.hash.slice(location.hash.indexOf("?")+1):location.search.slice(1));
if(recordParams.has("title"))$("hptitle").value=recordParams.get("title").slice(0,200);
if(UNITS.includes(recordParams.get("unit")))$("hpunit").value=recordParams.get("unit");
let pw=HOST.pw(),stream,rec,chunks=[],blob=null,transcriptWords=[],uploadId=null,uploadedBlob=null,uploadedParts=0,savedAudioId=null,draftId=null,audioEdited=false,t0=0,acc=0,tick=null;
let captionRec=null,captionWanted=false,captionBase="",captionFinal=[],captionInterim="";
const CaptionAPI=window.SpeechRecognition||window.webkitSpeechRecognition;
const noAI=()=>$("hpmode").value==="plain";
if(!CaptionAPI){$("hpliveCaption").checked=false;$("hpliveCaption").disabled=true;$("hpcaptionNote").textContent="Live captions aren’t available in this browser. Chrome or Edge can caption long recordings live; you can also paste a transcript below."}
let autoChaptersChoice=$("hpautoChapters").checked;
function syncMode(){
  const skip=noAI(),auto=$("hpautoChapters"),label=auto&&auto.parentElement;
  if(skip){autoChaptersChoice=auto.checked;auto.checked=false}else auto.checked=autoChaptersChoice;
  auto.disabled=skip;if(label)label.classList.toggle("disabled",skip);
  $("hptranscribe").hidden=skip||FEATURES.transcribeAudio!==true;
  $("hpmodeNote").textContent=skip?"AI is off. The audio uploads exactly as it is; paste a transcript or type chapters yourself if you want them.":($("hpnoAutoTranscript").checked?"Automatic transcription is off. Audio uploads with your transcript only; add chapters yourself.":"");
}
$("hpmode").onchange=syncMode;$("hpnoAutoTranscript").onchange=syncMode;syncMode();
function captionValue(){return [captionBase,...captionFinal,...(captionInterim?[captionInterim]:[])].filter(Boolean).join("\n")}
function startCaptions(){
  stopCaptions(false);
  if(FEATURES.liveCaptions!==true||!$("hpliveCaption").checked||!CaptionAPI||noAI())return;
  const status=$("hptranscribeStatus");
  captionBase=$("hptr").value.trimEnd();captionFinal=[];captionInterim="";
  const r=new CaptionAPI();r.continuous=true;r.interimResults=true;r.lang="en-US";
  r.onresult=event=>{
    let interim="";
    for(let i=event.resultIndex;i<event.results.length;i++){
      const result=event.results[i],text=String(result[0]&&result[0].transcript||"").trim();
      if(!text)continue;
      if(result.isFinal){captionFinal.push("Host: "+text)}else{interim+=(interim?" ":"")+text}
    }
    captionInterim=interim?"Host: "+interim:"";
    $("hptr").value=captionValue();
  };
  r.onerror=event=>{
    if(event.error==="not-allowed"||event.error==="service-not-allowed"){
      captionWanted=false;status.textContent="Live captions were blocked. Allow microphone access or turn them off and paste the transcript.";status.dataset.error="true";
    }else if(event.error!=="no-speech"&&event.error!=="aborted"){
      status.textContent="Live captions stopped ("+event.error+"). Keep recording and paste the transcript if needed.";status.dataset.error="true";
    }
  };
  r.onend=()=>{if(captionRec===r&&captionWanted){try{r.start()}catch(e){captionWanted=false}}};
  try{r.start();captionRec=r;captionWanted=true;delete status.dataset.error;status.textContent="Live captions are on. They restart automatically if the browser pauses them."}
  catch(e){status.textContent="Live captions couldn’t start: "+e.message;status.dataset.error="true"}
}
function stopCaptions(keep){
  captionWanted=false;const r=captionRec;captionRec=null;if(r){try{r.stop()}catch(e){}}
  if(keep&&(captionFinal.length||captionInterim)){
    $("hptr").value=captionValue().trim();
    $("hptranscribeStatus").textContent="Live captions added to the transcript. Review them before publishing.";
  }
  captionFinal=[];captionInterim="";
}
const msg=t=>{$("hpmsg").textContent=t;if(/failed|couldn.t|error/i.test(t))HOST.notify(t,"error")};
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
  if(parseChapterLines().length){status.textContent="Using your chapter markers. Clear them to auto-generate chapters instead.";return}
  if(!transcriptWords.length){status.textContent="Chapters need a timestamped transcript; you can add chapters manually.";return}
  const bucketSeconds=15,groups=new Map();
  for(const word of transcriptWords){const time=Number(word.start),text=String(word.word||"").trim();if(!Number.isFinite(time)||!text)continue;const start=Math.floor(time/bucketSeconds)*bucketSeconds;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(text)}
  const segments=[...groups].sort((a,b)=>a[0]-b[0]).map(([time,words])=>({time,text:words.join(" ")}));
  const duration=editor.hasAudio()?editor.duration():Number.isFinite($("hpprev").duration)&&$("hpprev").duration>0?$("hpprev").duration:Math.max(...transcriptWords.map(word=>Number(word.end)||0));
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
async function applyEdits(){ // turn the editor's edit list into a real file before anything is uploaded
  if(!editor.isDirty())return;
  msg("Rendering your edits…");
  const out=await editor.apply(p=>{$("hpprog").value=Math.round(p*100)});
  discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;blob=out;$("hpprev").src=URL.createObjectURL(out);
  msg("Edits rendered ("+(out.size/1048576).toFixed(1)+" MB).");
}
function audioChanged(op){ // keep chapters lined up with the edited audio; word timings no longer match, so they are cleared
  audioEdited=true;transcriptWords=[];
  const list=parseChapterLines();
  if(list.length&&op){
    const moved=list.map(c=>{let t=c.time;
      if(op.type==="delete"){if(t>=op.at+op.len)t-=op.len;else if(t>op.at)t=op.at}
      else if(op.type==="insert"&&t>op.at)t+=op.len;
      return{time:Math.max(0,t),title:c.title}}).sort((a,b)=>a.time-b.time);
    $("hpchapters").value=moved.map(c=>chapterClock(c.time)+" "+c.title).join("\n");
  }
  if($("hptr").value.trim())$("hptranscribeStatus").textContent="The audio was edited. Transcribe again to refresh the transcript.";
}
async function ensureUploaded(){
  await applyEdits();
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
function discardTemporaryUpload(){if(uploadId&&uploadId!==savedAudioId)api({action:"discard-upload",id:uploadId}).catch(()=>{})}
async function downloadUpload(audio){
  const parts=[];
  for(let i=0;i<audio.parts;i++){
    const start=i*CHUNK,end=Math.min(audio.size-1,start+CHUNK-1);
    const response=await fetch("/api/audio?upload="+encodeURIComponent(audio.id),{headers:{"x-admin-password":pw,"Range":"bytes="+start+"-"+end}});
    if(!response.ok)throw new Error("Couldn’t download the enhanced audio (HTTP "+response.status+").");
    const part=await response.arrayBuffer();
    if(part.byteLength!==end-start+1)throw new Error("An enhanced audio part was incomplete.");
    parts.push(part);
  }
  return new Blob(parts,{type:audio.type||"audio/wav"});
}
function setAudio(b){audioEdited=false;transcriptWords=[];$("hpchapters").value="";$("hpchapterStatus").textContent="";$("hpenhanceStatus").textContent="";delete $("hpenhanceStatus").dataset.error;discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;blob=b;$("hptr").value="";$("hpprev").src=URL.createObjectURL(b);msg((b.size<1048576?Math.max(1,Math.round(b.size/1024))+" KB":(b.size/1048576).toFixed(1)+" MB")+" ready.")}
function clearAudio(){
  discardTemporaryUpload();
  uploadId=null;uploadedBlob=null;uploadedParts=0;blob=null;transcriptWords=[];
  $("hptr").value="";$("hpchapters").value="";$("hpchapterStatus").textContent="";$("hpenhanceStatus").textContent="";delete $("hpenhanceStatus").dataset.error;$("hpprev").removeAttribute("src");msg("");
}
const editor=AudioEditor.create({
  confirm:HOST.confirm,notify:HOST.notify,
  recordClip:()=>studio.recordClip(),
  getChapters:()=>$("hpchapters").value,setChapters:v=>{$("hpchapters").value=v},
  onEdit:audioChanged
});
window.AAeditor=editor; // handy for debugging in the browser console
const studio=Studio.create({
  editor,
  markers:FEATURES.autoChapters===true,
  hasAudio:()=>!!blob,
  getAudio:()=>blob,
  confirm:HOST.confirm,
  onStart:()=>{stopCaptions(false);clearAudio();startCaptions();$("hppub").disabled=true},
  onAudio:b=>{stopCaptions(true);const keepChapters=$("hpchapters").value,keepTranscript=$("hptr").value;setAudio(b);$("hpchapters").value=keepChapters;$("hptr").value=keepTranscript;$("hppub").disabled=false},
  onDiscard:()=>{stopCaptions(false);clearAudio()},
  onMessage:msg,
  onMarker:(t,n)=>{
    const ta=$("hpchapters"),lines=ta.value.split(/\r?\n/).filter(l=>l.trim());lines.push(chapterClock(t)+" Marker "+n);
    const secs=l=>{const m=l.match(/^(?:(\d+):)?(\d+):(\d{2})/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):1e9};
    ta.value=lines.sort((a,b)=>secs(a)-secs(b)).join("\n");
  }
});
$("hpfile").onchange=e=>{const f=e.target.files[0];if(f){setAudio(f);studio.showFile(f)}};
$("hptr").oninput=()=>{transcriptWords=[]};
$("hpsavedraft").onclick=async()=>{
  const btn=$("hpsavedraft"),prog=$("hpprog");
  if(["rec","paused"].includes($("studio").dataset.state)){msg("Stop recording before saving the draft.");return}
  btn.disabled=true;prog.hidden=false;prog.value=0;
  try{
    let audio=null;
    if(blob){
      msg("Preparing audio for your draft…");
      const upload=await ensureUploaded();
      audio=upload.id===savedAudioId?{keep:true}:{id:upload.id,chunks:upload.parts,size:blob.size,type:(blob.type||"audio/webm").split(";")[0]};
    }
    const saved=await api({action:"save-draft",by:HOST.who(),draft:{
      id:draftId||undefined,title:$("hptitle").value,unit:$("hpunit").value,date:$("hpdate").value,rant:+$("hprant").value,
      desc:$("hpdesc").value,script:$("hpscript").value,transcript:$("hptr").value,transcriptWords,
      chapters:$("hpchapters").value,whenLocal:$("hpwhen").value,mode:$("hpmode").value,
      liveCaptions:$("hpliveCaption").checked,skipAutoTranscript:$("hpnoAutoTranscript").checked,
      ideaId:new URLSearchParams(location.search).get("idea"),audio
    }});
    draftId=saved.draft.id;savedAudioId=saved.draft.audio&&saved.draft.audio.id||null;
    if(blob&&uploadId===savedAudioId)uploadedBlob=blob;
    $("hpsavedraft").textContent="Update draft";msg("Draft saved. Find it on the dashboard whenever you’re ready to continue.");HOST.notify("Draft saved.");
  }catch(e){msg("Couldn’t save draft: "+e.message)}
  finally{btn.disabled=false;prog.hidden=true}
};
async function loadDraft(id){
  if(id===undefined){
    const params=new URLSearchParams(location.hash.includes("?")?location.hash.slice(location.hash.indexOf("?")+1):location.search.slice(1));
    id=params.get("draft");
  }
  if(!id||FEATURES.episodeDrafts===false)return;
  const btn=$("hpsavedraft");let loaded=false;btn.disabled=true;msg("Loading draft…");
  try{
    const result=await api({action:"get-draft",id}),d=result.draft;
    draftId=d.id;savedAudioId=d.audio&&d.audio.id||null;
    $("hptitle").value=d.title||"";$("hpunit").value=d.unit||UNITS[0];
    $("hpdate").value=d.date||new Date().toISOString().slice(0,10);$("hprant").value=String(d.rant||4);
    $("hpdesc").value=d.desc||"";$("hpscript").value=d.script||"";$("hptr").value=d.transcript||"";
    $("hpchapters").value=d.chapters||"";$("hpwhen").value=d.whenLocal||"";
    $("hpmode").value=d.mode==="plain"?"plain":"ai";
    $("hpnoAutoTranscript").checked=!!d.skipAutoTranscript;
    if(CaptionAPI)$("hpliveCaption").checked=d.liveCaptions!==false;
    syncMode();
    transcriptWords=Array.isArray(d.transcriptWords)?d.transcriptWords:[];
    if(d.audio){
      const parts=[];
      for(let i=0;i<d.audio.chunks;i++){
        const start=i*CHUNK,end=Math.min(d.audio.size-1,start+CHUNK-1);
        const response=await fetch("/api/audio?draft="+encodeURIComponent(d.id),{headers:{"x-admin-password":pw,"Range":"bytes="+start+"-"+end}});
        if(!response.ok)throw new Error("Couldn’t load saved audio (HTTP "+response.status+").");
        const part=await response.arrayBuffer();
        if(part.byteLength!==end-start+1)throw new Error("A saved audio part was incomplete.");
        parts.push(part);
      }
      blob=new Blob(parts,{type:d.audio.type||"audio/webm"});uploadId=d.audio.id;uploadedBlob=blob;uploadedParts=d.audio.chunks;
      $("hpenhanceStatus").textContent="";delete $("hpenhanceStatus").dataset.error;
      $("hpprev").src=URL.createObjectURL(blob);studio.showFile(blob);
    }
    $("hpsavedraft").textContent="Update draft";msg("Draft loaded. Continue editing, then save or publish when ready.");loaded=true;
  }catch(e){msg("Couldn’t load draft: "+e.message)}
  finally{btn.disabled=!loaded}
}
let enhancing=false;
async function enhanceAudio(){
  if(enhancing)return;
  const btn=$("hpenhance"),status=$("hpenhanceStatus");
  if(!blob){status.textContent="Record or choose audio first.";status.dataset.error="true";return}
  const yes=await HOST.confirm("Enhance this audio with Resemble AI? It removes room noise and balances the voice, uses your Resemble plan (billed per minute), and replaces the current audio. It can take a few minutes; don’t edit until it finishes.","AI Enhance");
  if(!yes)return;
  enhancing=true;btn.disabled=true;delete status.dataset.error;
  let outputAudio=null;
  try{
    if(editor.isDirty()||!["audio/mpeg","audio/mp3"].includes((blob.type||"").split(";")[0])){
      status.textContent="Preparing the audio for enhancement…";
      const prepared=await editor.apply(p=>{$("hpprog").value=Math.round(p*100)},true);
      btn.disabled=true;
      if(prepared!==blob){discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;blob=prepared;$("hpprev").src=URL.createObjectURL(prepared)}
    }
    if(!/^audio\/(mpeg|mp3|wav|x-wav|wave|x-pn-wav|vnd\.wave|mp4|m4a|x-m4a|ogg|aac|flac|x-flac)$/.test((blob.type||"").split(";")[0]))throw new Error("This audio needs to be an MP3, WAV, M4A, OGG, AAC or FLAC file. Record again or import an MP3.");
    const upload=await ensureUploaded();
    status.textContent="Sending the audio to Resemble Studio Sound…";
    const started=await api({action:"enhance-start",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});
    if(!started.jobId)throw new Error("Resemble did not start the enhancement.");
    let result=null;
    const deadline=Date.now()+10*60*1000;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,5000));
      status.textContent="Resemble is enhancing the audio… this can take a few minutes.";
      try{result=await api({action:"enhance-status",jobId:started.jobId})}
      catch(e){if(/HTTP (?:429|50[234])|Could not reach Resemble|Could not download the enhanced audio/.test(e.message))continue;throw e}
      if(result.status==="completed")break;
      if(result.status==="failed")throw new Error(result.error||"Resemble could not enhance this audio.");
    }
    if(!result||result.status!=="completed")throw new Error("Enhancement is taking too long. Try again later.");
    outputAudio=result.audio;
    if(editor.isDirty())throw new Error("You edited the audio while it was enhancing. Finish or undo those edits, then try AI Enhance again.");
    status.textContent="Downloading the enhanced audio…";
    const enhanced=await downloadUpload(outputAudio);
    api({action:"discard-upload",id:outputAudio.id}).catch(()=>{});outputAudio=null;
    discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;
    status.textContent="Applying the enhancement…";
    const preRendered=(enhanced.type||"").split(";")[0]==="audio/mpeg";
    if(!await editor.replaceAudio(enhanced,{rendered:preRendered}))throw new Error("The audio changed before the enhancement finished. Try again.");
    const out=preRendered?enhanced:await editor.apply(p=>{$("hpprog").value=Math.round(p*100)});
    blob=out;$("hpprev").src=URL.createObjectURL(out);
    status.textContent="Enhanced. Review the audio, then publish or save a draft.";
    msg("AI enhancement applied ("+(out.size/1048576).toFixed(1)+" MB). Review it, then publish or save a draft.");HOST.notify("Audio enhanced.");
  }catch(e){if(outputAudio)api({action:"discard-upload",id:outputAudio.id}).catch(()=>{});status.textContent="Enhancement failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{enhancing=false;btn.disabled=!editor.hasAudio()}
}
$("hpenhance").onclick=enhanceAudio;
$("hpsavedraft").hidden=FEATURES.episodeDrafts===false;
async function loadScriptForRecord(id){
  if(FEATURES.scriptMaker===false)return;
  try{
    const {script}=await api({action:"get-script",id});
    if(!script)return;
    $("hpscript").value=script.text||"";
    if(script.title)$("hptitle").value=script.title;
    if(UNITS.includes(script.unit))$("hpunit").value=script.unit;
    if(!$("hpdesc").value.trim()&&script.notes)$("hpdesc").value=script.notes;
    msg("Script “"+script.title+"” loaded. Edit it before recording.");
  }catch(e){msg("Couldn’t load that script: "+e.message)}
}
loadDraft();
if(!recordParams.has("draft")&&!recordParams.has("script")&&window.LiveStore){
  LiveStore.load().then(blob=>{
    if(!blob)return;
    setAudio(blob);studio.showFile(blob);LiveStore.clear();
    msg("Live recording loaded. The intro has been added at the start; review it, then publish or save a draft.");
  }).catch(()=>{});
}
if(recordParams.has("script"))loadScriptForRecord(recordParams.get("script"));
window.addEventListener("host-route-query",event=>{
  if(event.detail.view!=="record")return;
  const params=new URLSearchParams(event.detail.query||"");
  if(params.has("draft"))loadDraft(params.get("draft"));
  else if(params.has("script"))loadScriptForRecord(params.get("script"));
  else{
    if(params.has("title"))$("hptitle").value=params.get("title").slice(0,200);
    if(params.has("unit")&&UNITS.includes(params.get("unit")))$("hpunit").value=params.get("unit");
  }
});
$("hptranscribe").onclick=async()=>{
  const btn=$("hptranscribe"),prog=$("hpprog"),status=$("hptranscribeStatus");
  if(!blob){status.textContent="Choose or record an audio file first.";status.dataset.error="true";msg(status.textContent);return}
  btn.disabled=true;prog.hidden=false;prog.value=0;status.textContent="Preparing audio upload...";delete status.dataset.error;
  try{const upload=await ensureUploaded();status.textContent="Sending audio to Gemini for transcription...";const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});$("hptr").value=result.transcript||"";transcriptWords=Array.isArray(result.words)?result.words:[];status.textContent="Transcript ready. Review it before publishing.";await maybeGenerateChapters();msg(status.textContent)}
  catch(e){status.textContent="Transcription failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false;prog.hidden=true}
};
$("hpcleanup").onclick=async()=>{
  const btn=$("hpcleanup"),status=$("hptranscribeStatus"),box=$("hpcleanupCuts");
  const transcript=$("hptr").value.trim();
  if(!transcript){status.textContent="Add or transcribe a transcript first.";status.dataset.error="true";return}
  btn.disabled=true;delete status.dataset.error;status.textContent="Gemini is cleaning up the transcript…";box.replaceChildren();box.hidden=true;
  try{
    const buckets=new Map();
    for(const word of transcriptWords){
      const time=Number(word.start),text=String(word.word||"").trim();
      if(!Number.isFinite(time)||!text)continue;
      const key=Math.floor(time/15)*15;
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(text);
    }
    const segments=[...buckets].sort((a,c)=>a[0]-c[0]).map(([time,words])=>({time,text:words.join(" ")}));
    const duration=editor.hasAudio()?editor.duration():Number.isFinite($("hpprev").duration)&&$("hpprev").duration>0?$("hpprev").duration:Math.max(...transcriptWords.map(w=>Number(w.end)||0),0);
    const result=await api({action:"cleanup-transcript",transcript,title:$("hptitle").value,unit:$("hpunit").value,duration,introSeconds:editor.introDuration(),segments});
    $("hptr").value=result.cleaned||transcript;
    transcriptWords=[];
    status.textContent=result.cuts&&result.cuts.length?result.cuts.length+" audio cuts suggested. Review them below, then apply the ones you want.":"Clean transcript ready. No safe audio cuts were suggested.";
    if(!result.cuts||!result.cuts.length){msg(status.textContent);return}
    const clock=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
    const rows=result.cuts.map(cut=>{
      const label=document.createElement("label");label.className="cut-row";
      const check=document.createElement("input");check.type="checkbox";check.checked=true;check.value=cut.start+"|"+cut.end;
      const text=document.createElement("span");text.textContent=clock(cut.start)+"–"+clock(cut.end)+" · "+cut.reason;
      label.append(check,text);return label;
    });
    const actions=document.createElement("div");actions.className="acts";
    const apply=document.createElement("button");apply.type="button";apply.className="go";apply.textContent="Apply checked cuts to audio";
    apply.onclick=()=>{
      const ranges=[...box.querySelectorAll("input:checked")].map(input=>{const [start,end]=input.value.split("|").map(Number);return{start,end}});
      if(!ranges.length){status.textContent="Choose at least one cut first.";return}
      if(!editor.hasAudio()){status.textContent="Record or import audio before applying cuts.";status.dataset.error="true";return}
      const count=editor.deleteRanges(ranges);
      status.textContent=count?count+" cut"+(count===1?"":"s")+" applied to the audio. Review the transcript and chapters.":"Those cuts overlap the locked intro, so nothing was removed.";
      box.replaceChildren();box.hidden=true;msg(status.textContent);
    };
    const clear=document.createElement("button");clear.type="button";clear.textContent="Dismiss";clear.onclick=()=>{box.replaceChildren();box.hidden=true};
    actions.append(apply,clear);box.append(...rows,actions);box.hidden=false;
    msg(status.textContent);
  }catch(e){status.textContent="Transcript cleanup failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false}
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
    if(!transcript&&blob&&!noAI()){status.textContent="Transcribing audio first...";const upload=await ensureUploaded();const result=await api({action:"transcribe",id:upload.id,parts:upload.parts,size:blob.size,type:blob.type});transcript=String(result.transcript||"").trim();$("hptr").value=transcript;transcriptWords=Array.isArray(result.words)?result.words:[];await maybeGenerateChapters()}
    if(!transcript)throw new Error(noAI()?"Add a transcript by hand, or choose AI transcription, before generating a description.":"Choose audio or add a transcript first.");
    status.textContent="Generating description with Gemini...";
    const result=await api({action:"describe",title:$("hptitle").value,unit:$("hpunit").value,transcript});
    if(!result.description)throw new Error("Gemini returned no description.");
    $("hpdesc").value=result.description;status.textContent="Description ready. Review and edit it before publishing.";msg(status.textContent)
  }catch(e){status.textContent="Description generation failed: "+e.message;status.dataset.error="true";msg(status.textContent)}
  finally{btn.disabled=false}
};

$("hppub").onclick=async()=>{
  const title=$("hptitle").value.trim(),skipAI=noAI();
  if(!blob){msg("Record or choose audio first.");return}
  if(!title){msg("Add a title first.");return}
  if($("hpwhen").value&&new Date($("hpwhen").value).getTime()<=Date.now()){msg("Choose a future publish time, or leave it blank to publish now.");return}
  const btn=$("hppub"),prog=$("hpprog");btn.disabled=true;prog.hidden=false;prog.value=0;
  try{
msg(skipAI?"Preparing upload (no AI transcription)…":"Preparing upload…");
    const {id,parts}=await ensureUploaded();
    if(!skipAI&&!$("hpnoAutoTranscript").checked&&!transcriptWords.length){
      msg("Generating word timings for transcript highlighting…");
      const transcriptResult=await api({action:"transcribe",id,parts,size:blob.size,type:blob.type});
      transcriptWords=Array.isArray(transcriptResult.words)?transcriptResult.words:[];
      if(!$("hptr").value.trim()||audioEdited)$("hptr").value=transcriptResult.transcript||"";
      if(!transcriptWords.length)throw new Error("No word timings were returned. Try transcribing the audio again before publishing.");
    }
    if(!skipAI&&!$("hpnoAutoTranscript").checked&&FEATURES.autoChapters===true&&$("hpautoChapters").checked&&!parseChapterLines().length){
      await maybeGenerateChapters();
      if(!parseChapterLines().length)throw new Error("Automatic chapter generation failed. Uncheck the chapter option or add chapters manually, then publish again.");
    }
    msg("Publishing…");
    const publishAt=$("hpwhen").value?new Date($("hpwhen").value).toISOString():null;
    const res=await api({action:"publish",episode:{id,title,unit:$("hpunit").value,date:$("hpdate").value,publishAt,rant:+$("hprant").value,desc:$("hpdesc").value,transcript:$("hptr").value,transcriptWords,chapters:parseChapterLines(),size:blob.size,chunks:parts,type:(blob.type||"audio/mpeg").split(";")[0]}});
    if(res.episode.publishAt){msg("Episode "+res.episode.num+" scheduled for "+new Date(res.episode.publishAt).toLocaleString());HOST.notify("Episode scheduled.")}
    else{msg("Live! Episode "+res.episode.num+" is published.");HOST.notify("Episode published.")}
    if(draftId){
      try{await api({action:"delete-draft",id:draftId,keepAudio:savedAudioId===res.episode.id})}
      catch(e){msg("Episode published, but the draft could not be removed: "+e.message)}
    }
    blob=null;uploadId=null;uploadedBlob=null;uploadedParts=0;$("hpprev").removeAttribute("src");studio.reset();["hptitle","hpdesc","hptr","hpscript","hpchapters","hpfile","hpwhen"].forEach(k=>$(k).value="");transcriptWords=[];$("hpscriptStatus").textContent="";
    draftId=null;savedAudioId=null;$("hpsavedraft").textContent="Save draft";
    $("hpdone").hidden=false;
  }catch(e){msg("Failed: "+e.message)}
  btn.disabled=false;prog.hidden=true;
};

});