// Guest side of the live room: ask the host in, then talk over WebRTC. The host mixes everyone (minus your own voice) back to you.
(()=>{
const $=id=>document.getElementById(id);
const ICE=(window.SITE_CONFIG&&window.SITE_CONFIG.rtcIceServers)||[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}];
const clean=s=>String(s||"").toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,6);
let code=clean(location.hash.replace(/^#\/?/,"").split("?")[0]||new URLSearchParams(location.search).get("room"));
let gid=null,token=null,mic=null,pc=null,dc=null,sinceSig=0,left=false,admitted=false,connected=false,dcOpen=false,pollTimer=0,muted=false,hostMuted=false,sendQueue=Promise.resolve(),pendingIce=[];
let rec={state:"idle",elapsed:0,at:0},timer=null,intro=false,roster=[],chatSeen=new Set();
const show=id=>["stepName","stepWait","stepDone","stepRoom"].forEach(s=>$(s).hidden=s!==id);
const err=t=>$("jErr").textContent=t||"";
const fmt=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
async function api(body){
  const r=await fetch("/api/episodes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||"HTTP "+r.status);e.status=r.status;throw e}return d;
}
$("jCode").value=code;
try{$("jName").value=localStorage.getItem("aa_guest_name")||""}catch(e){}
if(code)$("jIntro").textContent="You’ve been invited to record a podcast episode with The Agastya Archive (room "+code+").";

/* ---------- joining ---------- */
$("jJoin").onclick=async()=>{
  err();const name=$("jName").value.trim();code=clean($("jCode").value);
  if(!name){err("Enter your name first.");return}
  if(code.length!==6){err("Enter the 6-character room code from your invite.");return}
  $("jJoin").disabled=true;
  try{
    try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})}
    catch(e){throw new Error("We couldn’t use your microphone. Allow microphone access for this page in your browser, then try again.")}
    const r=await api({action:"room-join",code,name});
    gid=r.gid;token=r.token;try{localStorage.setItem("aa_guest_name",name)}catch(e){}
    $("jTitle").textContent=r.room.title;$("jHost").textContent=" with "+r.room.hostName;
    show("stepWait");meter();poll();
  }catch(e){err(e.message);stopMic()}
  $("jJoin").disabled=false;
};
$("jName").addEventListener("keydown",e=>{if(e.key==="Enter")$("jJoin").click()});
$("jCode").addEventListener("keydown",e=>{if(e.key==="Enter")$("jJoin").click()});
$("jCancel").onclick=()=>leave("You left the waiting room","Thanks for stopping by.");
$("jLeave").onclick=()=>leave("You left the room","Thanks for joining. You can close this page.");

/* ---------- polling: lobby, signalling, and a fallback for room state ---------- */
async function poll(){
  if(left)return;
  try{
    const r=await api({action:"room-poll",code,gid,token,since:sinceSig});
    applyPublic(r.room);
    if(r.admit==="kicked"){leave("The host removed you","You can’t rejoin this room.",true);return}
    if(r.admit==="in"&&!admitted){admitted=true;show("stepRoom");$("jConn").textContent="Connecting audio…"}
    for(const item of r.sig){sinceSig=Math.max(sinceSig,item.n);await handleSignal(item)}
  }catch(e){
    if(e.status===410||e.status===404){leave("The room has ended","The host closed the room. Thanks for joining.",true);return}
    if(e.status===403){leave("Your place in the room expired","Open the invite link again to rejoin.",true);return}
  }
  pollTimer=setTimeout(poll,connected?4000:1000);
}
function sendSig(kind,data){ // one message at a time, in order
  sendQueue=sendQueue.then(()=>api({action:"room-send",code,gid,token,kind,data})).catch(()=>{});return sendQueue;
}
async function handleSignal(item){
  if(item.kind==="offer"){await onOffer(item.data)}
  else if(item.kind==="ice"){if(pc&&pc.remoteDescription){try{await pc.addIceCandidate(item.data)}catch(e){}}else pendingIce.push(item.data)}
  else if(item.kind==="bye"){leave("The room has ended","The host closed the room. Thanks for joining.",true)}
}
async function onOffer(offer){
  if(pc){try{pc.close()}catch(e){}}
  pc=new RTCPeerConnection({iceServers:ICE});
  pc.ondatachannel=e=>{dc=e.channel;dc.onopen=()=>{dcOpen=true;dcSend({t:"hello",name:$("jName").value.trim(),muted})};dc.onclose=()=>{dcOpen=false};dc.onmessage=m=>{try{onHost(JSON.parse(m.data))}catch(x){}}};
  pc.ontrack=e=>{const a=$("jAudio");a.srcObject=e.streams[0]||new MediaStream([e.track]);a.play().catch(()=>{})};
  pc.onicecandidate=e=>{if(e.candidate)sendSig("ice",e.candidate.toJSON())};
  pc.onconnectionstatechange=()=>{
    const s=pc.connectionState;connected=s==="connected";
    $("jConn").textContent=s==="connected"?"Connected. Everyone can hear you.":s==="failed"?"The audio connection failed. Check your network, or leave and rejoin.":s==="disconnected"?"Reconnecting…":"Connecting audio…";
  };
  await pc.setRemoteDescription(offer);
  for(const c of pendingIce.splice(0)){try{await pc.addIceCandidate(c)}catch(e){}}
  mic.getAudioTracks().forEach(t=>{t.enabled=!muted&&!hostMuted;pc.addTrack(t,mic)});
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
  await sendSig("answer",pc.localDescription.toJSON());
}

/* ---------- messages from the host (data channel) ---------- */
function onHost(m){
  if(m.t==="state")applyState(m);
  else if(m.t==="roster"){roster=m.list||[];renderPeople()}
  else if(m.t==="chat")addChat(m);
  else if(m.t==="mute"){hostMuted=!!m.muted;mic.getAudioTracks().forEach(t=>t.enabled=!muted&&!hostMuted);renderMute()}
  else if(m.t==="kick")leave("The host removed you","You can’t rejoin this room.",true);
}
function applyState(s){
  rec={state:s.rec||"idle",elapsed:+s.elapsed||0,at:performance.now()};intro=!!s.intro;
  timer=s.timer?{state:s.timer.state,remaining:+s.timer.remaining||0,at:performance.now()}:null;
  showQuestion(s.question);const n=$("jNotice");n.hidden=!s.notice;n.textContent=s.notice||"";
  if(s.title)$("jTitle").textContent=s.title;
}
function applyPublic(room){ // used until the data channel is open, and as a safety net afterwards
  if(!room||dcOpen)return;
  rec={state:room.recording||"idle",elapsed:rec.state===room.recording?rec.elapsed+(performance.now()-rec.at)/1000:0,at:performance.now()};
  timer=room.timer?{state:room.timer.state,remaining:room.timer.remaining,at:performance.now()-(Date.now()-room.timer.at)}:null;
  showQuestion(room.question);const n=$("jNotice");n.hidden=!room.notice;n.textContent=room.notice||"";
}
let shownQ=null;
function showQuestion(q){const id=q?q.id+"|"+q.text:null;if(id===shownQ)return;shownQ=id;$("jQuestion").hidden=!q;if(q)$("jQText").textContent=q.text}

/* ---------- screen ---------- */
function renderPeople(){
  const ul=$("jPeople");ul.replaceChildren();
  roster.forEach(p=>{const li=document.createElement("li");if(p.muted)li.className="muted";const d=document.createElement("span"),n=document.createElement("span"),s=document.createElement("small");d.className="dot";n.textContent=p.name+(p.host?" (host)":"");s.textContent=p.muted?"muted":"";li.append(d,n,s);ul.append(li)});
}
function renderMute(){$("jMute").textContent=hostMuted?"Muted by the host":muted?"Unmute my mic":"Mute my mic";$("jMute").disabled=hostMuted}
$("jMute").onclick=()=>{muted=!muted;mic.getAudioTracks().forEach(t=>t.enabled=!muted&&!hostMuted);dcSend({t:"muted",muted});renderMute()};
function dcSend(o){if(dc&&dc.readyState==="open")dc.send(JSON.stringify(o))}
function addChat(m){
  if(m.id&&chatSeen.has(m.id))return;if(m.id)chatSeen.add(m.id);
  const p=document.createElement("p"),b=document.createElement("b"),t=document.createElement("small");b.textContent=m.from+": ";t.textContent=new Date(m.at||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  p.append(b,document.createTextNode(m.text),t);const log=$("jLog");log.append(p);log.scrollTop=log.scrollHeight;
}
const sendChat=()=>{const v=$("jMsg").value.trim();if(!v||!dcOpen)return;dcSend({t:"chat",text:v});$("jMsg").value=""};
$("jSend").onclick=sendChat;$("jMsg").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
setInterval(()=>{
  const now=performance.now(),r=$("jRec"),clock=$("jClock");
  if(intro){r.textContent="INTRO";r.className="jrec intro"}
  else if(rec.state==="rec"){r.textContent="REC";r.className="jrec rec"}
  else if(rec.state==="paused"){r.textContent="PAUSED";r.className="jrec paused"}
  else{r.textContent="STANDBY";r.className="jrec"}
  clock.textContent=fmt(rec.state==="rec"?rec.elapsed+(now-rec.at)/1000:rec.elapsed);
  const t=$("jTimer");
  if(timer&&timer.state!=="idle"){const rem=timer.state==="run"?timer.remaining-(now-timer.at):timer.remaining;t.hidden=false;t.textContent="Timer "+fmt(Math.max(0,rem)/1000)+(timer.state==="pause"?" (paused)":"");t.className="jtimer"+(rem<30000?" low":"")}else t.hidden=true;
},250);
function meter(){ // a little level meter so guests can see their mic is working
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)(),an=ctx.createAnalyser();an.fftSize=512;ctx.createMediaStreamSource(mic).connect(an);const buf=new Uint8Array(an.fftSize);
    setInterval(()=>{an.getByteTimeDomainData(buf);let m=0;for(const v of buf)m=Math.max(m,Math.abs(v-128));$("jLevel").style.width=Math.min(100,m/128*140)+"%"},90);
  }catch(e){}
}
function stopMic(){if(mic){mic.getTracks().forEach(t=>t.stop());mic=null}}
function leave(title,text,remote){
  if(left)return;left=true;clearTimeout(pollTimer);
  if(!remote&&admitted){sendSig("bye",{})}
  try{pc&&pc.close()}catch(e){}stopMic();$("jDoneTitle").textContent=title;$("jDoneText").textContent=text;show("stepDone");
}
window.AAguest={state:()=>({gid,admitted,connected,dcOpen,rec,intro,timer:!!timer,shownQ,muted,hostMuted,roster}),pc:()=>pc};
if(!code)$("jIntro").textContent="Enter the room code from your invite to join.";
})();