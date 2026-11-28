// Live room (host side). Guests connect to you over WebRTC; you mix everyone (plus sound effects) in the browser,
// record the mix, and send each guest a "mix-minus" (everyone except themselves) so nobody hears an echo.
HOST.ready(()=>{
const {api,features:F}=HOST,me=HOST.who(),$=id=>document.getElementById(id);
const h=(t,a,...k)=>{const e=document.createElement(t);for(const x in a||{}){const v=a[x];if(v===false||v==null)continue;if(x==="class")e.className=v;else if(x.startsWith("on"))e[x]=v;else e.setAttribute(x,v===true?"":v)}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const ICE=F.rtcIceServers||[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}];
const clockS=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const msg=t=>$("lvSetupMsg").textContent=t,uid=()=>Math.random().toString(36).slice(2,10);
let room=null,ctx=null,micStream=null,sources={},recBus=null,recDest=null,monBus=null,peers=new Map(),dismissed=new Set(),pollTimer=0;
let questions=[],shownQ=null,qNext=0,timer={state:"idle",remaining:0,endsAt:0},introPlaying=false,hostMuted=false,introBuf=null;
let recorder=null,chunks=[],recState="idle",acc=0,t0=0,markers=[],finished=null,pubTimer=0,noiseBuf=null;
try{questions=JSON.parse(localStorage.getItem("aa_live_questions")||"[]").filter(q=>q&&q.text)}catch(e){}
const saveQs=()=>{try{localStorage.setItem("aa_live_questions",JSON.stringify(questions))}catch(e){}};

/* ---------- the mixing desk ---------- */
async function startEngine(){
  ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
  recBus=ctx.createGain();recDest=ctx.createMediaStreamDestination();recBus.connect(recDest);
  monBus=ctx.createGain();monBus.connect(ctx.destination);
  addSource("host",ctx.createMediaStreamSource(micStream),{rec:true,mon:false,guests:true});
  addSource("sfx",ctx.createGain(),{rec:true,mon:true,guests:true});
  addSource("intro",ctx.createGain(),{rec:false,mon:true,guests:true}); // the intro is heard live but never recorded: the editor adds it when you publish
}
function addSource(id,input,flags){
  const out=ctx.createGain();input.connect(out);const an=ctx.createAnalyser();an.fftSize=512;
  sources[id]={id,input,out,an,level:0,...flags};rewire();return sources[id];
}
function rewire(){ // who is sent where
  for(const s of Object.values(sources)){
    s.out.disconnect();s.out.connect(s.an);
    if(s.rec)s.out.connect(recBus);
    if(s.mon)s.out.connect(monBus);
    if(s.guests)for(const p of peers.values())if(p.bus&&p.gid!==s.id)s.out.connect(p.bus);
  }
  applyGains();
}
function applyGains(){
  for(const s of Object.values(sources)){
    let g=1;
    if(s.id==="host")g=hostMuted?0:1;
    else if(s.id!=="sfx"&&s.id!=="intro"){const p=peers.get(s.id);g=p&&p.mutedByHost?0:1}
    if(introPlaying&&s.id!=="intro")g=0; // nothing is ever played over the intro
    s.out.gain.value=g;
  }
}
const rms=an=>{const b=new Uint8Array(an.fftSize);an.getByteTimeDomainData(b);let m=0;for(const v of b)m=Math.max(m,Math.abs(v-128));return m/128};
setInterval(()=>{ // meters
  for(const s of Object.values(sources))s.level=rms(s.an);
  document.querySelectorAll("[data-meter]").forEach(el=>{const s=sources[el.dataset.meter];el.style.width=s?Math.min(100,s.level*150)+"%":"0%"});
},100);

/* ---------- people ---------- */
const connectedPeers=()=>[...peers.values()].filter(p=>p.state==="connected");
function sendTo(p,o){if(p.dc&&p.dc.readyState==="open")p.dc.send(JSON.stringify(o))}
function broadcast(o){peers.forEach(p=>sendTo(p,o))}
function roster(){return[{id:"host",name:me.name,host:true,muted:hostMuted},...connectedPeers().map(p=>({id:p.gid,name:p.name,muted:p.mutedByHost||p.selfMuted}))]}
const sendRoster=()=>broadcast({t:"roster",list:roster()});
function ensurePeer(g){
  if(peers.has(g.gid))return peers.get(g.gid);
  const p={gid:g.gid,name:g.name,state:"lobby",mutedByHost:false,selfMuted:false,since:0,sigQueue:Promise.resolve(),pendingIce:[]};peers.set(g.gid,p);renderPeople();return p;
}
function sig(p,kind,data){p.sigQueue=p.sigQueue.then(()=>api({action:"room-send-host",code:room.code,gid:p.gid,kind,data})).catch(()=>{})}
async function admit(p){
  await api({action:"room-admit",code:room.code,gid:p.gid,status:"in"});
  p.state="connecting";renderPeople();
  p.bus=ctx.createGain();p.dest=ctx.createMediaStreamDestination();p.bus.connect(p.dest);rewire();
  const pc=p.pc=new RTCPeerConnection({iceServers:ICE}),dc=p.dc=pc.createDataChannel("room");
  dc.onopen=()=>{sendTo(p,stateMsg());sendRoster()};
  dc.onmessage=e=>{try{fromGuest(p,JSON.parse(e.data))}catch(x){}};
  pc.addTrack(p.dest.stream.getAudioTracks()[0],p.dest.stream);
  pc.ontrack=e=>{
    if(sources[p.gid])return;const stream=e.streams[0]||new MediaStream([e.track]);
    p.audioEl=new Audio();p.audioEl.srcObject=stream;p.audioEl.muted=true;p.audioEl.play().catch(()=>{}); // Chrome only feeds remote audio to Web Audio when it is attached to a media element
    addSource(p.gid,ctx.createMediaStreamSource(stream),{rec:true,mon:$("lvMonitor").checked,guests:true});renderPeople();
  };
  pc.onicecandidate=e=>{if(e.candidate)sig(p,"ice",e.candidate.toJSON())};
  pc.onconnectionstatechange=()=>{
    const s=pc.connectionState;
    if(s==="connected"){p.state="connected";renderPeople();renderStatus();sendRoster();sendTo(p,stateMsg())}
    else if(s==="failed"||s==="closed")dropPeer(p);
  };
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);sig(p,"offer",pc.localDescription.toJSON());
}
function dropPeer(p){
  if(!peers.has(p.gid))return;dismissed.add(p.gid);
  try{p.pc&&p.pc.close()}catch(e){}
  const s=sources[p.gid];if(s){s.out.disconnect();delete sources[p.gid]}
  if(p.bus){p.bus.disconnect();p.bus=null}
  if(p.audioEl){p.audioEl.srcObject=null}
  peers.delete(p.gid);rewire();renderPeople();renderStatus();sendRoster();
}
async function decline(p,notify){try{await api({action:"room-admit",code:room.code,gid:p.gid,status:"kicked"})}catch(e){}if(notify)sendTo(p,{t:"kick"});dropPeer(p)}
async function onSignal(p,it){
  if(it.kind==="answer"&&p.pc){await p.pc.setRemoteDescription(it.data);for(const c of p.pendingIce.splice(0)){try{await p.pc.addIceCandidate(c)}catch(e){}}}
  else if(it.kind==="ice"&&p.pc){if(p.pc.remoteDescription){try{await p.pc.addIceCandidate(it.data)}catch(e){}}else p.pendingIce.push(it.data)}
  else if(it.kind==="bye")dropPeer(p);
}
function fromGuest(p,m){
  if(m.t==="hello"){if(m.name)p.name=String(m.name).slice(0,40);p.selfMuted=!!m.muted;renderPeople();sendRoster()}
  else if(m.t==="muted"){p.selfMuted=!!m.muted;renderPeople();sendRoster()}
  else if(m.t==="chat"&&String(m.text||"").trim())postChat(p.name,String(m.text).slice(0,400));
}
async function pollRoom(){
  if(!room)return;
  try{
    const since={};peers.forEach(p=>since[p.gid]=p.since);
    const r=await api({action:"room-host-poll",code:room.code,watch:[...peers.values()].filter(p=>p.state==="connecting").map(p=>p.gid),since});
    r.guests.forEach(g=>{if(!dismissed.has(g.gid)&&!peers.has(g.gid))ensurePeer(g)});
    for(const [gid,items] of Object.entries(r.sig)){const p=peers.get(gid);if(!p)continue;for(const it of items){p.since=Math.max(p.since,it.n);await onSignal(p,it)}}
  }catch(e){if(/ended/i.test(e.message)){closeRoomUi("The room has ended.");return}}
  pollTimer=setTimeout(pollRoom,1500);
}
function renderPeople(){
  const lobby=$("lvLobby"),box=$("lvPeople");lobby.replaceChildren();box.replaceChildren();
  const waiting=[...peers.values()].filter(p=>p.state==="lobby");
  if(waiting.length)lobby.append(h("p",{class:"fine"},"Waiting to join:"));
  waiting.forEach(p=>lobby.append(h("div",{class:"lv-person lv-wait"},h("span"),h("div",null,h("b",null,p.name),h("div",{class:"st"},"In the lobby")),h("div",{class:"acts2"},h("button",{type:"button",class:"go",onclick:()=>admit(p).catch(e=>HOST.notify&&HOST.notify("Couldn’t admit "+p.name+": "+e.message,"error"))},"Let in"),h("button",{type:"button",onclick:()=>decline(p,false)},"Decline")))));
  const you=h("div",{class:"lv-person"},h("span"),h("div",null,h("b",null,me.name+" (you, host)"),h("div",{class:"meter"},h("i",{"data-meter":"host"}))),h("span",{class:"st"},hostMuted?"muted":"live"));
  box.append(you);
  [...peers.values()].filter(p=>p.state!=="lobby").forEach(p=>box.append(h("div",{class:"lv-person","data-gid":p.gid},h("span"),h("div",null,h("b",null,p.name),h("div",{class:"st"},p.state==="connected"?(p.mutedByHost?"muted by you":p.selfMuted?"muted themselves":"connected"):"connecting…"),h("div",{class:"meter"},h("i",{"data-meter":p.gid}))),
    h("div",{class:"acts2"},h("button",{type:"button",onclick:()=>{p.mutedByHost=!p.mutedByHost;applyGains();sendTo(p,{t:"mute",muted:p.mutedByHost});renderPeople();sendRoster()}},p.mutedByHost?"Unmute":"Mute"),h("button",{type:"button",class:"danger",onclick:()=>decline(p,true)},"Remove")))));
}
const renderStatus=()=>{const n=connectedPeers().length;$("lvStatus").textContent=n?n+" guest"+(n===1?"":"s")+" connected":"no guests connected yet"};

/* ---------- state shared with everyone ---------- */
const elapsed=()=>acc+(recState==="rec"?(performance.now()-t0)/1000:0);
const remainingMs=()=>timer.state==="run"?Math.max(0,timer.endsAt-Date.now()):timer.remaining;
const stateMsg=()=>({t:"state",rec:recState,elapsed:elapsed(),question:shownQ,timer:timer.state==="idle"?null:{state:timer.state,remaining:remainingMs()},notice:null,intro:introPlaying,title:room?room.title:""});
function pushState(){
  broadcast(stateMsg());clearTimeout(pubTimer); // the API copy lets a guest whose data channel isn't up yet see the same thing
  pubTimer=setTimeout(()=>room&&api({action:"room-update",code:room.code,pub:{recording:recState,question:shownQ,timer:timer.state==="idle"?null:{state:timer.state,remaining:remainingMs()}}}).catch(()=>{}),300);
}
setInterval(()=>{
  const live=recState==="rec";$("lvClock").textContent=clockS(elapsed());
  const o=$("lvOnAir");o.className="lv-onair"+(introPlaying?" intro":recState==="rec"?" rec":recState==="paused"?" paused":"");$("lvOnAirText").textContent=introPlaying?"Intro playing":recState==="rec"?"On air":recState==="paused"?"Paused":"Standby";
  const ts=$("lvTimerShow");ts.textContent=timer.state==="idle"?"":clockS(remainingMs()/1000)+(timer.state==="pause"?" (paused)":"");
  if(timer.state==="run"&&remainingMs()<=0){timer={state:"idle",remaining:0,endsAt:0};pushState();renderTimerButtons()}
  if(live&&room)broadcast(stateMsg());
},1000);

/* ---------- recording ---------- */
function recStart(){
  if(recState!=="idle"||!ctx)return;
  if(introPlaying){HOST.notify&&HOST.notify("Wait for the intro to finish before recording.","error");return}
  const mt=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m=>MediaRecorder.isTypeSupported(m))||"";
  recorder=new MediaRecorder(recDest.stream,{...(mt?{mimeType:mt}:{}),audioBitsPerSecond:64000});chunks=[];markers=[];acc=0;finished=null;$("lvDone").hidden=true;
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);recorder.start(1000);t0=performance.now();recState="rec";recButtons();pushState();
  if(shownQ)markers.push({t:0,title:"Q: "+shownQ.text.slice(0,70)});
}
function recPause(){
  if(recState==="rec"){acc=elapsed();recorder.pause();recState="paused"}else if(recState==="paused"){t0=performance.now();recorder.resume();recState="rec"}else return;
  recButtons();pushState();
}
function recStop(){
  if(recState==="idle")return;acc=elapsed();const dur=acc,type=recorder.mimeType||"audio/webm";
  recorder.onstop=()=>{finished={blob:new Blob(chunks,{type}),chapters:markers.slice(),duration:dur};$("lvDone").hidden=false;$("lvDoneInfo").textContent=clockS(dur)+" · "+(finished.blob.size/1048576).toFixed(1)+" MB"+(markers.length?" · "+markers.length+" chapter marker"+(markers.length===1?"":"s"):"")};
  if(recorder.state!=="inactive")recorder.stop();recState="idle";recButtons();pushState();
}
function recButtons(){$("lvRec").disabled=recState!=="idle";$("lvPause").disabled=recState==="idle";$("lvPause").textContent=recState==="paused"?"Resume":"Pause";$("lvStop").disabled=recState==="idle";$("lvMark").disabled=recState==="idle"}
$("lvRec").onclick=recStart;$("lvPause").onclick=recPause;$("lvStop").onclick=recStop;
$("lvMark").onclick=()=>{markers.push({t:elapsed(),title:"Marker "+(markers.length+1)});HOST.notify&&HOST.notify("Marker added at "+clockS(elapsed()),"success")};
$("lvSend").onclick=()=>{if(!finished)return;HOST.pendingRecording={blob:finished.blob,chapters:finished.chapters,title:room?room.title:"",source:"live"};location.hash="#record?live=1"};
$("lvDiscard").onclick=async()=>{if(await HOST.confirm("Discard this recording? It can’t be recovered.","Discard")){finished=null;$("lvDone").hidden=true}};

/* ---------- countdown timer ---------- */
function renderTimerButtons(){$("lvTimerGo").textContent=timer.state==="run"?"Restart":"Start";$("lvTimerPause").disabled=timer.state==="idle";$("lvTimerPause").textContent=timer.state==="pause"?"Resume":"Pause"}
$("lvTimerGo").onclick=()=>{const m=Math.max(1,Math.min(180,+$("lvTimerMin").value||5));timer={state:"run",remaining:m*60000,endsAt:Date.now()+m*60000};renderTimerButtons();pushState()};
$("lvTimerPause").onclick=()=>{if(timer.state==="run"){timer={state:"pause",remaining:remainingMs(),endsAt:0}}else if(timer.state==="pause"){timer={state:"run",remaining:timer.remaining,endsAt:Date.now()+timer.remaining}}renderTimerButtons();pushState()};
$("lvTimerReset").onclick=()=>{timer={state:"idle",remaining:0,endsAt:0};renderTimerButtons();pushState()};

/* ---------- on-screen questions ---------- */
function showQ(q){shownQ=q?{id:q.id,text:q.text}:null;if(q&&recState!=="idle")markers.push({t:elapsed(),title:"Q: "+q.text.slice(0,70)});renderQuestions();pushState()}
function renderQuestions(){
  const box=$("lvQList");box.replaceChildren();
  questions.forEach((q,i)=>box.append(h("div",{class:"lv-qitem"+(shownQ&&shownQ.id===q.id?" on":"")},h("span",null,q.text),h("div",{class:"acts2"},
    h("button",{type:"button",onclick:()=>{qNext=i+1;showQ(shownQ&&shownQ.id===q.id?null:q)}},shownQ&&shownQ.id===q.id?"Hide":"Show"),h("button",{type:"button",class:"danger",onclick:()=>{questions.splice(i,1);saveQs();renderQuestions()},"aria-label":"Remove question"},"×")))));
  if(!questions.length)box.append(h("p",{class:"fine"},"No questions yet. Add some below, or import them from a script."));
}
$("lvQAdd").onclick=()=>{const t=$("lvQNew").value.trim();if(!t)return;questions.push({id:uid(),text:t});$("lvQNew").value="";saveQs();renderQuestions()};
$("lvQNew").addEventListener("keydown",e=>{if(e.key==="Enter")$("lvQAdd").click()});
$("lvQNext").onclick=()=>{if(!questions.length)return;if(qNext>=questions.length)qNext=0;showQ(questions[qNext]);qNext++};
$("lvQHide").onclick=()=>showQ(null);
async function importScript(id){
  try{const r=await api({action:"get-script",id}),qs=HOST.parseQuestions(r.script.text);
    if(!qs.length){HOST.notify&&HOST.notify("That script has no questions (lines starting “Q:”).","error");return}
    qs.forEach(t=>{if(!questions.some(q=>q.text===t))questions.push({id:uid(),text:t})});saveQs();renderQuestions();HOST.notify&&HOST.notify("Imported "+qs.length+" question"+(qs.length===1?"":"s")+" from “"+r.script.title+"”.","success")}
  catch(e){HOST.notify&&HOST.notify("Couldn’t import: "+e.message,"error")}
}
$("lvQScript").onchange=()=>{const v=$("lvQScript").value;$("lvQScript").value="";if(v)importScript(v)};
if(F.hostScripts!==false)api({action:"list-scripts"}).then(r=>r.scripts.forEach(s=>$("lvQScript").append(new Option(s.title,s.id)))).catch(()=>{});

/* ---------- sound effects and the intro ---------- */
const sfxNode=()=>sources.sfx.input;
function tone(freq,type,dur,gain,when=0,end){const t=ctx.currentTime+when,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);if(end)o.frequency.linearRampToValueAtTime(end,t+dur);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(sfxNode());o.start(t);o.stop(t+dur+.05)}
function noise(dur,gain,freq,when=0,sweepTo){
  if(!noiseBuf){noiseBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1}
  const t=ctx.currentTime+when,s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=noiseBuf;f.type="bandpass";f.frequency.setValueAtTime(freq,t);if(sweepTo)f.frequency.exponentialRampToValueAtTime(sweepTo,t+dur);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+Math.min(.03,dur/3));g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(g);g.connect(sfxNode());s.start(t,Math.random());s.stop(t+dur+.05);
}
const SFX=[["Ding",()=>{tone(880,"sine",1.4,.5);tone(1760,"sine",.9,.2)}],["Buzzer",()=>tone(140,"square",.8,.3)],
  ["Applause",()=>{for(let i=0;i<70;i++)noise(.12,.25*Math.random()+.05,1800+Math.random()*2500,Math.random()*3)}],
  ["Drum roll",()=>{for(let i=0;i<44;i++)noise(.07,.18+i*.006,200+Math.random()*100,i*.05)}],
  ["Air horn",()=>[440,554,659].forEach(f=>tone(f,"sawtooth",1.2,.17))],
  ["Sad trombone",()=>{tone(311,"sawtooth",.5,.22,0);tone(294,"sawtooth",.5,.22,.5);tone(277,"sawtooth",.5,.22,1);tone(262,"sawtooth",1.4,.22,1.5,196)}],
  ["Whoosh",()=>noise(1,.5,300,0,4000)],["Rimshot",()=>{noise(.12,.5,1200);noise(.12,.5,2000,.18);tone(900,"triangle",.4,.3,.36)}]];
const customSfx=[];
function renderSfx(){
  const box=$("lvSfx");box.replaceChildren();
  SFX.forEach(([name,fn])=>box.append(h("button",{type:"button",disabled:introPlaying||!ctx,onclick:()=>{if(!introPlaying&&ctx)fn()}},name)));
  customSfx.forEach(c=>box.append(h("button",{type:"button",disabled:introPlaying||!ctx,onclick:()=>{if(introPlaying)return;const s=ctx.createBufferSource();s.buffer=c.buf;s.connect(sfxNode());s.start()}},c.name)));
  $("lvIntro").disabled=introPlaying||!ctx;
}
$("lvSfxFile").onchange=async e=>{
  const f=e.target.files[0];e.target.value="";if(!f||!ctx)return;
  try{if(f.size>8e6)throw new Error("keep sound effects under 8 MB");const buf=await ctx.decodeAudioData(await f.arrayBuffer());if(buf.duration>45)throw new Error("keep sound effects under 45 seconds");customSfx.push({name:f.name.replace(/\.[^.]+$/,"").slice(0,18),buf});renderSfx()}
  catch(x){HOST.notify&&HOST.notify("Couldn’t add that sound: "+x.message,"error")}
};
async function playIntro(){
  if(introPlaying||!ctx)return;
  if(recState!=="idle"){HOST.notify&&HOST.notify("Stop the recording first. The intro isn’t recorded, so it would leave a silent gap.","error");return}
  try{
    if(!introBuf){const res=await fetch(F.introUrl||"/assets/intro.mp3",{cache:"force-cache"});if(!res.ok)throw new Error("the intro file wasn’t found");introBuf=await ctx.decodeAudioData(await res.arrayBuffer())}
    introPlaying=true;applyGains();pushState();renderSfx();
    const s=ctx.createBufferSource();s.buffer=introBuf;s.connect(sources.intro.input);s.onended=()=>{introPlaying=false;applyGains();pushState();renderSfx()};s.start();
  }catch(e){introPlaying=false;applyGains();renderSfx();HOST.notify&&HOST.notify("Couldn’t play the intro: "+e.message,"error")}
}
$("lvIntro").onclick=playIntro;

/* ---------- chat ---------- */
function postChat(from,text){
  const m={t:"chat",id:uid(),from,text,at:Date.now()},log=$("lvLog");
  log.append(h("p",null,h("b",null,from+": "),text));log.scrollTop=log.scrollHeight;broadcast(m);
}
const sendChat=()=>{const v=$("lvMsg").value.trim();if(!v||!room)return;$("lvMsg").value="";postChat(me.name,v)};
$("lvSendMsg").onclick=sendChat;$("lvMsg").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});

/* ---------- room lifecycle ---------- */
$("lvMyMute").onclick=()=>{hostMuted=!hostMuted;applyGains();$("lvMyMute").textContent=hostMuted?"Unmute my mic":"Mute my mic";renderPeople();sendRoster()};
$("lvMonitor").onchange=()=>{Object.values(sources).forEach(s=>{if(s.id!=="host"&&s.id!=="sfx"&&s.id!=="intro")s.mon=$("lvMonitor").checked});rewire()};
$("lvCopy").onclick=async()=>{try{await navigator.clipboard.writeText($("lvLink").value);HOST.notify&&HOST.notify("Invite link copied.","success")}catch(e){$("lvLink").select()}};
$("lvCreate").onclick=async()=>{
  $("lvCreate").disabled=true;msg("Opening your microphone…");
  try{
    await startEngine();msg("Creating the room…");
    const r=await api({action:"room-create",title:$("lvTitle").value.trim()});
    room={code:r.code,title:r.room.title};$("lvCode").textContent=r.code;$("lvLink").value=location.origin+"/join/#"+r.code;
    $("lvSetup").hidden=true;$("lvRoom").hidden=false;$("lvEnd").hidden=false;recButtons();renderPeople();renderQuestions();renderSfx();renderStatus();renderTimerButtons();pollRoom();
  }catch(e){msg("Couldn’t start: "+(e&&e.name==="NotAllowedError"?"allow microphone access for this page and try again.":e.message));if(ctx){try{ctx.close()}catch(x){}ctx=null}$("lvCreate").disabled=false}
};
function closeRoomUi(text){
  clearTimeout(pollTimer);peers.forEach(p=>{try{p.pc&&p.pc.close()}catch(e){}});peers.clear();
  if(micStream)micStream.getTracks().forEach(t=>t.stop());if(ctx){try{ctx.close()}catch(e){}}
  ctx=null;micStream=null;sources={};room=null;dismissed.clear();$("lvRoom").hidden=true;$("lvEnd").hidden=true;$("lvSetup").hidden=false;$("lvCreate").disabled=false;msg(text||"");
}
$("lvEnd").onclick=async()=>{
  if(!(await HOST.confirm("End the room? Guests will be disconnected."+(recState!=="idle"?" The recording in progress will be lost unless you stop it first.":""),"End room")))return;
  if(recState!=="idle")recStop();broadcast({t:"kick"});
  try{await api({action:"room-end",code:room.code})}catch(e){}
  const keep=finished;closeRoomUi("Room ended."+(keep?" Your recording is still waiting below.":""));if(keep){$("lvSetup").hidden=false;$("lvDone").hidden=false}
};
window.addEventListener("beforeunload",e=>{if(room&&(recState!=="idle"||connectedPeers().length)){e.preventDefault();e.returnValue=""}});
window.AALive={matrix:()=>{const m={rec:[],mon:[]};Object.values(sources).forEach(s=>{if(s.rec)m.rec.push(s.id);if(s.mon)m.mon.push(s.id)});peers.forEach(p=>{m["to:"+p.gid]=Object.values(sources).filter(s=>s.guests&&s.id!==p.gid).map(s=>s.id)});return m},
  levels:()=>Object.fromEntries(Object.values(sources).map(s=>[s.id,s.level])),gains:()=>Object.fromEntries(Object.values(sources).map(s=>[s.id,s.out.gain.value])),
  state:()=>({room,recState,introPlaying,shownQ,timer:timer.state,markers,peers:[...peers.values()].map(p=>({gid:p.gid,name:p.name,state:p.state,mutedByHost:p.mutedByHost}))}),finished:()=>finished,
  stats:async()=>{const out={};for(const p of peers.values()){if(!p.pc)continue;const r=await p.pc.getStats();r.forEach(s=>{if(s.type==="inbound-rtp"&&s.kind==="audio")out[p.gid]={bytes:s.bytesReceived,packets:s.packetsReceived}})}return out}};

/* ---------- routes: #live?script=ID imports that script's questions ---------- */
const fromQuery=q=>{const p=new URLSearchParams(q||"");if(p.get("script"))importScript(p.get("script"))};
fromQuery(location.hash.split("?")[1]);window.addEventListener("host-route-query",e=>{if(e.detail.view==="live")fromQuery(e.detail.query)});
renderQuestions();renderSfx();
});