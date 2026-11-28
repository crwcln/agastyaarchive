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
if(FEATURES.transcript===false&&FEATURES.autoChapters!==true)$("trCard").hidden=true;
if(FEATURES.episodeDrafts===false)$("hpsavedraft").hidden=true;
UNITS.forEach(u=>$("hpunit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("hprant").append(new Option("\u{1F525}".repeat(n),n,false,n===4)));
$("hpdate").value=new Date().toISOString().slice(0,10);
const recordParams=new URLSearchParams(location.hash.includes("?")?location.hash.slice(location.hash.indexOf("?")+1):location.search.slice(1));
if(recordParams.has("title"))$("hptitle").value=recordParams.get("title").slice(0,200);
if(UNITS.includes(recordParams.get("unit")))$("hpunit").value=recordParams.get("unit");
let pw=HOST.pw(),stream,rec,chunks=[],blob=null,transcriptWords=[],uploadId=null,uploadedBlob=null,uploadedParts=0,savedAudioId=null,draftId=null,audioEdited=false,hptrAuto=false,t0=0,acc=0,tick=null;
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
  if(editor.hasAudio()&&FEATURES.episodeIntro!==false&&editor.autoIntro()&&!editor.hasIntro()){msg("Adding the intro…");await editor.addIntro()}
  if(!editor.isDirty())return;
  msg("Rendering your edits…");
  await editor.apply(p=>{$("hpprog").value=Math.round(p*100)}); // onRendered (below) adopts the new file
  msg("Edits rendered ("+(blob.size/1048576).toFixed(1)+" MB).");
}
const mapWords=(words,op)=>{ // keep word timings in step with cuts and insertions (new arrays, so undo can keep old ones)
  if(!words.length)return words;
  if(op.type==="insert")return words.map(w=>op.at===0||w.start>=op.at?{...w,start:w.start+op.len,end:w.end+op.len}:w);
  const a=op.at,b=op.at+op.len;
  return words.filter(w=>!(w.start<b&&w.end>a)).map(w=>w.start>=b?{...w,start:w.start-op.len,end:w.end-op.len}:w);
};
function audioChanged(op){ // chapters and transcript timings follow the edit
  audioEdited=true;
  if(op&&transcriptWords.length){transcriptWords=mapWords(transcriptWords,op);if(hptrAuto)$("hptr").value=transcriptWords.map(w=>w.word).join(" ")}
  else if(!op)transcriptWords=[];
  const list=parseChapterLines();
  if(list.length&&op){
    const moved=list.map(c=>{let t=c.time;
      if(op.type==="delete"){if(t>=op.at+op.len)t-=op.len;else if(t>op.at)t=op.at}
      else if(op.type==="insert"&&(t>op.at||(op.at===0&&op.intro)))t+=op.len;
      return{time:Math.max(0,t),title:c.title}}).sort((a,b)=>a.time-b.time);
    if(op.intro&&op.type==="insert"&&op.at===0&&moved[0].time>0)moved.unshift({time:0,title:"Intro"});
    $("hpchapters").value=moved.map(c=>chapterClock(c.time)+" "+c.title).join("\n");
  }
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
function setAudio(b){audioEdited=false;transcriptWords=[];$("hpchapters").value="";$("hpchapterStatus").textContent="";discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;blob=b;$("hptr").value="";$("hpprev").src=URL.createObjectURL(b);msg((b.size<1048576?Math.max(1,Math.round(b.size/1024))+" KB":(b.size/1048576).toFixed(1)+" MB")+" ready.")}
function clearAudio(){
  discardTemporaryUpload();
  uploadId=null;uploadedBlob=null;uploadedParts=0;blob=null;transcriptWords=[];
  $("hptr").value="";$("hpchapters").value="";$("hpchapterStatus").textContent="";$("hpprev").removeAttribute("src");msg("");
}
const editor=AudioEditor.create({
  confirm:HOST.confirm,notify:HOST.notify,
  recordClip:()=>studio.recordClip(),
  getAux:()=>({ch:$("hpchapters").value,words:transcriptWords,tr:$("hptr").value,auto:hptrAuto}),
  setAux:o=>{$("hpchapters").value=o.ch;transcriptWords=o.words;$("hptr").value=o.tr;hptrAuto=o.auto},
  introEnabled:FEATURES.episodeIntro!==false,introUrl:FEATURES.introUrl||"/assets/intro.mp3",
  onEdit:audioChanged,
  onRendered:out=>{discardTemporaryUpload();uploadId=null;uploadedBlob=null;uploadedParts=0;blob=out;$("hpprev").src=URL.createObjectURL(out)}
});
window.AAeditor=editor; // handy for debugging in the browser console
const studio=Studio.create({
  editor,
  markers:FEATURES.autoChapters===true,
  hasAudio:()=>!!blob,
  getAudio:()=>blob,
  confirm:HOST.confirm,
  onStart:()=>{clearAudio();$("hppub").disabled=true},
  onRecState:liveCaptions,
  onAudio:b=>{const keep=$("hpchapters").value;setAudio(b);$("hpchapters").value=keep;$("hppub").disabled=false;applyLiveCaptions(b)},
  onDiscard:clearAudio,
  onMessage:msg,
  onMarker:(t,n)=>{
    const ta=$("hpchapters"),lines=ta.value.split(/\r?\n/).filter(l=>l.trim());lines.push(chapterClock(t)+" Marker "+n);
    const secs=l=>{const m=l.match(/^(?:(\d+):)?(\d+):(\d{2})/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):1e9};
    ta.value=lines.sort((a,b)=>secs(a)-secs(b)).join("\n");
  }
});
$("hpfile").onchange=e=>{const f=e.target.files[0];if(f){setAudio(f);studio.showFile(f)}};
$("hptr").oninput=()=>{transcriptWords=[];hptrAuto=false};
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
      chapters:$("hpchapters").value,whenLocal:$("hpwhen").value,introSeconds:editor.hasAudio()?editor.introSeconds():0,ideaId:new URLSearchParams(location.search).get("idea"),audio
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
    $("hpdesc").value=d.desc||"";$("hpscript").value=d.script||"";showScript(d.script?"saved with this draft":"",d.script,null);$("hptr").value=d.transcript||"";
    $("hpchapters").value=d.chapters||"";$("hpwhen").value=d.whenLocal||"";
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
      $("hpprev").src=URL.createObjectURL(blob);editor.setNextLoadIntro(d.introSeconds||0);studio.showFile(blob);
    }
    $("hpsavedraft").textContent="Update draft";msg("Draft loaded. Continue editing, then save or publish when ready.");loaded=true;
  }catch(e){msg("Couldn’t load draft: "+e.message)}
  finally{btn.disabled=!loaded}
}
$("hpsavedraft").hidden=FEATURES.episodeDrafts===false;
loadDraft();
function showScript(label,text,id){ // an attached script is shown read-only so you can read from it while recording
  const box=$("scAttached");if(!text){box.hidden=true;return}
  box.hidden=false;$("scAttachedTitle").textContent=label;$("scAttachedText").value=text;$("scAttachedEdit").hidden=!id;if(id)$("scAttachedEdit").href="#scripts?open="+encodeURIComponent(id);
}
async function attachScript(id){
  try{
    const {script}=await api({action:"get-script",id});
    $("hpscript").value=script.text;if(!$("hptitle").value.trim())$("hptitle").value=script.title.slice(0,200);if(script.unit&&UNITS.includes(script.unit))$("hpunit").value=script.unit;
    showScript(script.title+" ("+script.words+" words)",script.text,script.id);msg("Script “"+script.title+"” attached. It’s saved with drafts and never published.");
  }catch(e){msg("Couldn’t load that script: "+e.message)}
}
if(recordParams.get("script"))attachScript(recordParams.get("script"));
function takeLive(){ // a recording sent over from the Live tab
  const p=HOST.pendingRecording;if(!p)return;HOST.pendingRecording=null;
  setAudio(p.blob);studio.showFile(p.blob);$("hppub").disabled=false;
  if(p.chapters&&p.chapters.length)$("hpchapters").value=p.chapters.map(c=>chapterClock(c.t)+" "+c.title).join("\n");
  if(!$("hptitle").value.trim()&&p.title)$("hptitle").value=p.title.slice(0,200);
  msg("Live recording loaded ("+clockS(editor.hasAudio()?editor.duration():0)+"). Edit it, then publish or save a draft.");
}
window.addEventListener("host-route-query",event=>{
  if(event.detail.view!=="record")return;
  const params=new URLSearchParams(event.detail.query||"");
  if(params.has("draft"))loadDraft(params.get("draft"));
  else{
    if(params.has("title"))$("hptitle").value=params.get("title").slice(0,200);
    if(params.has("unit")&&UNITS.includes(params.get("unit")))$("hpunit").value=params.get("unit");
    if(params.has("script"))attachScript(params.get("script"));
    if(params.has("live"))takeLive();
  }
});
/* ---------- transcripts: browser captions (any length), Gemini sent in parts, or switched off ---------- */
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}};
$("hpautotr").checked=store("aa_auto_transcript")?store("aa_auto_transcript")!=="off":FEATURES.autoTranscript!==false;
$("hptrmethod").value=store("aa_transcript_method")||"auto";
$("hpautotr").onchange=()=>store("aa_auto_transcript",$("hpautotr").checked?"on":"off");
$("hptrmethod").onchange=()=>store("aa_transcript_method",$("hptrmethod").value);
const geminiOn=()=>FEATURES.transcribeAudio===true,trStatus=(t,err)=>{const st=$("hptranscribeStatus");st.textContent=t;if(err)st.dataset.error="true";else delete st.dataset.error};
const clockS=t=>Math.floor(t/60)+":"+String(Math.floor(t%60)).padStart(2,"0");
(()=>{ // note: the browser is only asked about on-device support when you actually start captioning
  const el=$("hptrcaps");
  if(!Captions.supported){el.textContent="Browser captions aren’t available in this browser."+(geminiOn()?" Gemini will be used, or turn the automatic transcript off.":"");return}
  el.textContent=Captions.canCaptionTrack?"Browser captions are available. They run on this device when your browser supports it, and have no episode-length limit.":"Browser captions can run live while you record, but this browser can’t caption audio you already have.";
  $("hpcaption").hidden=!Captions.canCaptionTrack;
})();
let live=null,liveDone=null;
function liveCaptions(state){ // runs the browser's recognizer next to the recording, so the transcript is ready the moment you stop
  if(!Captions.supported||!$("hpautotr").checked||$("hptrmethod").value==="gemini")return;
  if(state==="start"){
    live=Captions.create({clock:()=>studio.recordTime(),onInterim:t=>trStatus(t?"Live captions: …"+t.slice(-90):"Live captions are listening…"),
      onFatal:e=>{trStatus("Live captions stopped ("+e+")."+(geminiOn()?" Gemini will transcribe instead.":""),true);live=null}});
    live.start();trStatus("Live captions are listening…");
  }else if(state==="pause"&&live)live.pause();
  else if(state==="resume"&&live)live.resume();
  else if(state==="stop"&&live){liveDone=live.finish();live=null}
}
function applyLiveCaptions(b){
  if(!liveDone)return;const pending=liveDone;liveDone=null;
  pending.then(segs=>{
    if(blob!==b||!segs.length){if(blob===b&&!segs.length)trStatus("Live captions didn’t catch any speech.",true);return}
    transcriptWords=Captions.wordsFrom(segs);$("hptr").value=Captions.textFrom(segs);hptrAuto=true;
    trStatus("Captioned live while you recorded ("+segs.length+" phrases, approximate timing). Review it before publishing.");
  });
}
async function uploadTemp(part){ // a short-lived upload used only for transcription
  const parts=Math.max(1,Math.ceil(part.size/CHUNK)),started=await api({action:"upload-start",parts});
  for(let i=0;i<parts;i++)await uploadPart(started.id,i,part.slice(i*CHUNK,(i+1)*CHUNK));
  return{id:started.id,parts};
}
async function transcribeGemini(report){ // long episodes are cut into 6-minute parts so no single request is too big
  if(!geminiOn())throw new Error("Gemini transcription is turned off in site-config.js");
  if(!editor.hasAudio()){const up=await ensureUploaded();report("Sending the audio to Gemini…");const r=await api({action:"transcribe",id:up.id,parts:up.parts,size:blob.size,type:blob.type});return{transcript:r.transcript||"",words:Array.isArray(r.words)?r.words:[]}}
  const from=editor.introSeconds(),to=editor.duration(),ranges=[],LEN=6*60;
  for(let t=from;t<to-.5;t+=LEN)ranges.push([t,Math.min(to,t+LEN)]);
  if(ranges.length>1&&ranges[ranges.length-1][1]-ranges[ranges.length-1][0]<60){const last=ranges.pop();ranges[ranges.length-1][1]=last[1]}
  if(!ranges.length)throw new Error("there isn’t any speech to transcribe");
  const words=[],texts=[];
  for(let i=0;i<ranges.length;i++){
    const [a,b]=ranges[i];report(ranges.length>1?"Transcribing part "+(i+1)+" of "+ranges.length+" ("+clockS(a)+" to "+clockS(b)+")…":"Transcribing…");
    const part=await editor.renderRange(a,b),up=await uploadTemp(part);
    try{const r=await api({action:"transcribe",id:up.id,parts:up.parts,size:part.size,type:"audio/mpeg"});
      texts.push(r.transcript||"");(Array.isArray(r.words)?r.words:[]).forEach(w=>words.push({...w,start:+w.start+a,end:+w.end+a}))}
    finally{api({action:"discard-upload",id:up.id}).catch(()=>{})}
  }
  return{transcript:texts.join("\n\n").trim(),words};
}
const aiEdit=AIEdit.create({editor,api,enabled:FEATURES.aiAudioEdit!==false,notify:HOST.notify,getWords:()=>transcriptWords,
  ensureWords:async report=>{ // a timed transcript is needed to point at the parts to cut
    if(!geminiOn())throw new Error("transcribe the audio first: use Caption in browser, or turn Gemini transcription on in site-config.js");
    const r=await transcribeGemini(report);transcriptWords=r.words;$("hptr").value=r.transcript;hptrAuto=true;return r.words;
  }});
window.AAai=aiEdit; // handy for debugging in the browser console
let captionRun=null;
$("hpcaption").onclick=async()=>{ // caption audio you already have, using the browser's recognizer (real time, any length)
  const btn=$("hpcaption");
  if(captionRun){captionRun.cancel();return}
  if(!blob||!editor.hasAudio()){trStatus("Choose or record audio first.",true);return}
  const from=editor.introSeconds(),to=editor.duration();if(to-from<1){trStatus("There isn’t any speech to caption.",true);return}
  trStatus("Checking browser captions…");
  const lang=navigator.language||"en-US",dev=await Captions.deviceStatus(lang);
  if(dev==="downloadable"||dev==="downloading"){trStatus("Downloading the on-device caption language (one time)…");await Captions.installDevice(lang)}
  let stream;try{stream=editor.captionStream(from,to)}catch(e){trStatus("Couldn’t start captioning: "+e.message,true);return}
  let failed=null,interim="";
  const cap=Captions.create({track:stream.track,clock:()=>stream.time(),onInterim:t=>{interim=t},onFatal:e=>{failed=e;stream.stop()}});
  const tick=setInterval(()=>trStatus("Captioning in your browser at normal speed: "+clockS(stream.time()-from)+" of "+clockS(to-from)+(interim?" · …"+interim.slice(-70):"")+" (click again to stop)"),500);
  captionRun={cancel:()=>{failed=failed||"stopped";stream.stop()}};btn.textContent="Stop captioning";
  cap.start();await stream.done;clearInterval(tick);const segs=await cap.finish();captionRun=null;btn.textContent="Caption in browser";
  if(segs.length){
    transcriptWords=Captions.wordsFrom(segs);$("hptr").value=Captions.textFrom(segs);hptrAuto=true;
    trStatus((failed&&failed!=="stopped"?"Captioning stopped early ("+failed+"), but ":"")+"transcript ready from "+segs.length+" phrases (browser captions, approximate timing). Review it before publishing.");
    await maybeGenerateChapters();
  }else trStatus(failed&&failed!=="stopped"?"The browser couldn’t caption this audio ("+failed+")."+(geminiOn()?" Try Gemini instead.":""):"No speech was recognised.",true);
};
$("hptranscribe").onclick=async()=>{
  const btn=$("hptranscribe"),prog=$("hpprog");
  if(!blob){trStatus("Choose or record an audio file first.",true);msg("Choose or record an audio file first.");return}
  if($("hptrmethod").value==="browser"){if(Captions.canCaptionTrack)$("hpcaption").click();else trStatus("This browser can only caption live while recording. Pick Automatic or Gemini to transcribe a file.",true);return}
  btn.disabled=true;prog.hidden=false;prog.value=0;trStatus("Preparing…");
  try{
    const r=await transcribeGemini(t=>{trStatus(t);msg(t)});
    transcriptWords=r.words;$("hptr").value=r.transcript;hptrAuto=true;
    trStatus("Transcript ready. Review it before publishing.");await maybeGenerateChapters();msg("Transcript ready.");
  }catch(e){trStatus("Transcription failed: "+e.message,true);msg("Transcription failed: "+e.message)}
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
    if(!transcriptWords.length&&$("hpautotr").checked&&FEATURES.transcript!==false){
      try{
        if($("hptrmethod").value==="browser")throw new Error("no browser captions were captured for this recording");
        const r=await transcribeGemini(t=>msg(t));
        if(!r.words.length&&!r.transcript)throw new Error("it came back empty");
        transcriptWords=r.words;$("hptr").value=r.transcript;hptrAuto=true;
      }catch(e){HOST.notify("Publishing without a transcript: "+e.message+". Turn off “Automatically transcribe” to skip this step.","error")}
    }
    if(FEATURES.autoChapters===true&&$("hpautoChapters").checked&&!parseChapterLines().length&&($("hptr").value.trim()||transcriptWords.length)){
      await maybeGenerateChapters();
      if(!parseChapterLines().length)HOST.notify("Chapters weren’t generated, so the episode is going out without them.","error");
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

if(HOST.pendingRecording)takeLive(); // last, so everything above is defined first
});