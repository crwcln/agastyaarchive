// Live studio (host): WebRTC mesh with the host mic mixed into one MediaRecorder stream.
HOST.ready(()=>{
const {api}=HOST,$=id=>document.getElementById(id),HOST_TOKEN="0".repeat(32);
let roomId=null,since=0,pollTimer=null,peers=[],peerConns=new Map(),localStream=null,ctx=null,mixDest=null,micNode=null;
let recorder=null,chunks=[],recBlob=null,recording=false,paused=false,recStart=0,accum=0,clockTimer=null;
let timerRunning=false,timerSeconds=0,timerBase=0,timerTimer=null,ended=false;
const status=t=>{$("lvStatus").textContent=t};
async function liveApi(body){
  const r=await fetch("/api/live",{method:"POST",headers:{"Content-Type":"application/json","x-admin-password":HOST.pw()},body:JSON.stringify(body)});
  const text=await r.text();let d={};try{d=JSON.parse(text)}catch(e){}
  if(!r.ok)throw new Error(d.error||"HTTP "+r.status);
  return d;
}
const clock=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")};
const recElapsed=()=>accum+(recording&&!paused?(Date.now()-recStart)/1000:0);
const timerElapsed=()=>timerSeconds+(timerRunning?(Date.now()-timerBase)/1000:0);
function tick(){
  $("lvClock").textContent=clock(recElapsed());
  $("lvTimer").textContent=clock(timerElapsed());
}
setInterval(tick,250);
async function ensureMic(){
  if(localStream)return localStream;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("This browser can’t use a microphone.");
  localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
  const AC=window.AudioContext||window.webkitAudioContext;
  ctx=ctx||new AC();await ctx.resume();
  mixDest=ctx.createMediaStreamDestination();
  micNode=ctx.createGain();micNode.gain.value=1;
  ctx.createMediaStreamSource(localStream).connect(micNode);micNode.connect(mixDest);
  return localStream;
}
function note(text,error){
  const log=$("lvChatLog"),line=document.createElement("div");line.className="lv-msg";
  const b=document.createElement("b");b.textContent="System";line.append(b,document.createTextNode(" "+text));
  log.append(line);log.scrollTop=log.scrollHeight;
  if(error){status(text);HOST.notify(text,"error")}
}
function appendChat(event){
  const log=$("lvChatLog"),line=document.createElement("div");
  line.className="lv-msg"+(event.question?" question":"");
  const b=document.createElement("b");b.textContent=event.name||"Guest";
  line.append(b,document.createTextNode(": "+event.text));
  log.append(line);log.scrollTop=log.scrollHeight;
}
function renderPeers(){
  const box=$("lvPeers");box.replaceChildren();
  if(!peers.length){box.append(Object.assign(document.createElement("p"),{className:"mute",textContent:"No guests yet. Share the invite link above."}));return}
  peers.forEach(peer=>{
    const row=document.createElement("div");row.className="lv-peer";
    const dot=document.createElement("i"),name=document.createElement("span"),when=document.createElement("small");
    name.textContent=peer.name;when.textContent="joined "+new Date(peer.joinedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
    row.append(dot,name,when);box.append(row);
  });
}
function controls(on){
  ["lvEnd","lvPause","lvStop","lvShowQuestion","lvClearQuestion","lvSendChat","lvTimerStart","lvTimerPause","lvTimerReset"].forEach(id=>$(id).disabled=!on);
  document.querySelectorAll(".lv-sfx button").forEach(b=>b.disabled=!on);
  $("lvRecord").disabled=!on||recording;
}
async function sendSignal(to,data){try{await liveApi({action:"signal",room:roomId,from:HOST_TOKEN,to,data})}catch(e){note("Couldn’t signal a guest: "+e.message,true)}}
async function connectGuest(peer){
  if(peerConns.has(peer.id)||!localStream)return;
  const entry={pc:null,pending:[]};peerConns.set(peer.id,entry);
  try{
    await ensureMic();
    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]});
    entry.pc=pc;
    localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
    pc.onicecandidate=e=>{if(e.candidate)sendSignal(peer.id,{type:"candidate",candidate:e.candidate.toJSON?e.candidate.toJSON():{candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex}})};
    pc.ontrack=e=>{
      const source=ctx.createMediaStreamSource(e.streams[0]||new MediaStream([e.track])),gain=ctx.createGain();
      gain.gain.value=1;source.connect(gain);gain.connect(mixDest);entry.audio=gain;
      note(peer.name+"’s microphone is connected.");
    };
    pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed")note(peer.name+"’s connection failed. They may need to rejoin.",true)};
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    await sendSignal(peer.id,{type:"offer",sdp:pc.localDescription});
  }catch(e){peerConns.delete(peer.id);note("Couldn’t connect "+peer.name+": "+e.message,true)}
}
function disconnectGuest(id){
  const entry=peerConns.get(id);if(!entry)return;
  try{entry.pc&&entry.pc.close()}catch(e){}
  try{entry.audio&&entry.audio.disconnect()}catch(e){}
  peerConns.delete(id);
}
async function applySignal(event){
  const entry=peerConns.get(event.from);if(!entry||!entry.pc)return;
  const data=event.data||{};
  try{
    if(data.type==="answer"){
      await entry.pc.setRemoteDescription(data.sdp);
      for(const candidate of entry.pending.splice(0))await entry.pc.addIceCandidate(candidate).catch(()=>{});
    }else if(data.type==="candidate"){
      if(entry.pc.remoteDescription)await entry.pc.addIceCandidate(data.candidate);
      else entry.pending.push(data.candidate);
    }
  }catch(e){note("A guest signal couldn’t be applied: "+e.message,true)}
}
function processEvents(events){
  for(const event of events){
    if(event.type==="join"){note(event.name+" joined the room.");continue}
    if(event.type==="leave"){disconnectGuest(event.from);note(event.name+" left the room.");continue}
    if(event.type==="signal"&&event.to===HOST_TOKEN){applySignal(event);continue}
    if(event.type==="chat"){appendChat(event);continue}
    if(event.type==="question"){
      const text=String(event.text||"");$("lvQuestion").value=text;
      $("lvOverlay")&&($("lvOverlay").hidden=true);note(text?"Question shown to guests.":"On-screen text cleared.");continue
    }
    if(event.type==="timer"){timerRunning=!!event.running;timerSeconds=Number(event.seconds)||0;timerBase=Date.now();continue}
    if(event.type==="end"){finishRoom(true);continue}
  }
}
async function poll(){
  if(!roomId||ended)return;
  try{
    const data=await liveApi({action:"poll",room:roomId,peer:HOST_TOKEN,since});
    since=data.since;peers=data.peers||[];
    peers.forEach(peer=>connectGuest(peer));
    processEvents(data.events||[]);renderPeers();
  }catch(e){
    if(/ended|incorrect/i.test(e.message))finishRoom(true);
    else console.warn("Live poll:",e);
  }
}
function finishRoom(byGuest){
  ended=true;clearInterval(pollTimer);pollTimer=null;
  if(recording&&recorder){
    accum+=paused?0:Date.now()-recStart;recording=false;paused=false;
    if(recorder.state!=="inactive"){try{recorder.stop()}catch(e){}}
  }
  peers.forEach(peer=>disconnectGuest(peer.id));peers=[];renderPeers();controls(false);
  $("lvOnair").className="lv-onair";$("lvOnairText").textContent="Room ended";
  status(byGuest?"The room has ended.":"Room ended.");
}
$("lvCreate").onclick=async()=>{
  const btn=$("lvCreate");btn.disabled=true;status("Starting the live room…");
  try{
    const data=await liveApi({action:"create",title:$("lvTitle").value.trim(),by:HOST.who()});
    roomId=data.room.id;since=0;ended=false;peers=[];recBlob=null;chunks=[];peerConns.forEach(entry=>{try{entry.pc&&entry.pc.close()}catch(e){}});peerConns.clear();
    $("lvLink").value=location.origin+data.guestPath;$("lvInvite").hidden=false;
    $("lvChatLog").replaceChildren();$("lvQuestion").value="";
    controls(true);renderPeers();status("Live room ready. Share the guest link, then start recording.");
    try{await ensureMic();status("Mic ready. Share the guest link, then start recording.")}
    catch(e){note("Microphone unavailable: "+e.message+". Guests can still join chat, but there will be no host audio.",true)}
    clearInterval(pollTimer);pollTimer=setInterval(poll,1500);poll();
  }catch(e){status("Couldn’t start the room: "+e.message)}
  finally{btn.disabled=false}
};
$("lvCopy").onclick=async()=>{
  try{await navigator.clipboard.writeText($("lvLink").value);status("Guest link copied.")}
  catch(e){$("lvLink").select();status("Select and copy the highlighted link.")}
};
$("lvEnd").onclick=async()=>{
  if(!roomId||ended)return;
  if(!await HOST.confirm("End this live room? Guests will be disconnected immediately. Your recording stays here.","End live room"))return;
  try{await liveApi({action:"end",room:roomId});finishRoom(false);HOST.notify("Live room ended.")}
  catch(e){status("Couldn’t end the room: "+e.message)}
};
$("lvRecord").onclick=async()=>{
  if(!roomId||recording)return;
  try{
    await ensureMic();
    if(!window.MediaRecorder)throw new Error("This browser can’t record audio.");
    const types=["audio/webm;codecs=opus","audio/mp4","audio/webm"],mt=types.find(m=>window.MediaRecorder.isTypeSupported(m))||"";
    recorder=new MediaRecorder(mixDest.stream,{...(mt?{mimeType:mt}:{}),audioBitsPerSecond:96000});
    chunks=[];recBlob=null;
    recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    recorder.onstop=()=>{
      recBlob=new Blob(chunks,{type:(recorder&&recorder.mimeType)||"audio/webm"});
      $("lvDownload").disabled=!recBlob;$("lvSend").disabled=!recBlob;
      $("lvRecStatus").textContent="Recording ready ("+(recBlob.size/1048576).toFixed(1)+" MB).";
    };
    recorder.start(1000);recording=true;paused=false;accum=0;recStart=Date.now();
    $("lvRecord").disabled=true;$("lvPause").disabled=false;$("lvStop").disabled=false;
    $("lvOnair").className="lv-onair live";$("lvOnairText").textContent="Recording";
    $("lvRecStatus").textContent="Recording…";
    liveApi({action:"control",room:roomId,state:"recording"}).catch(()=>{});
  }catch(e){status("Couldn’t start recording: "+e.message)}
};
$("lvPause").onclick=()=>{
  if(!recording||!recorder)return;
  if(!paused){accum+=Date.now()-recStart;recorder.pause();paused=true;$("lvPause").textContent="Resume";$("lvOnair").className="lv-onair paused";$("lvOnairText").textContent="Paused";liveApi({action:"control",room:roomId,state:"paused"}).catch(()=>{})}
  else{recStart=Date.now();recorder.resume();paused=false;$("lvPause").textContent="Pause";$("lvOnair").className="lv-onair live";$("lvOnairText").textContent="Recording";liveApi({action:"control",room:roomId,state:"recording"}).catch(()=>{})}
};
$("lvStop").onclick=()=>{
  if(!recording||!recorder)return;
  accum+=paused?0:Date.now()-recStart;recording=false;paused=false;
  if(recorder.state!=="inactive")recorder.stop();
  $("lvRecord").disabled=false;$("lvPause").disabled=true;$("lvStop").disabled=true;$("lvPause").textContent="Pause";
  $("lvOnair").className="lv-onair";$("lvOnairText").textContent="Standby";
  liveApi({action:"control",room:roomId,state:"stopped"}).catch(()=>{});
};
$("lvDownload").onclick=()=>{
  if(!recBlob)return;const a=document.createElement("a");a.href=URL.createObjectURL(recBlob);a.download="live-episode."+((recBlob.type||"").includes("mp4")?"m4a":"webm");a.click();setTimeout(()=>URL.revokeObjectURL(a.href),30000);
};
$("lvSend").onclick=async()=>{
  if(!recBlob)return;
  try{await window.LiveStore.save(recBlob);HOST.notify("Live recording ready in the Record editor.");location.hash="#record"}
  catch(e){status("Couldn’t send the recording: "+e.message)}
};
function tone(freq,duration,peak,type,delay){
  const t=ctx.currentTime+(delay||0),osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=type||"sine";osc.frequency.setValueAtTime(freq,t);
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(peak,t+.015);
  gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(gain);gain.connect(mixDest);osc.start(t);osc.stop(t+duration+.05);
}
function noise(duration,peak,frequency,delay,sweep){
  const t=ctx.currentTime+(delay||0),rate=ctx.sampleRate,n=Math.max(1,Math.floor(rate*duration));
  const buf=ctx.createBuffer(1,n,rate),data=buf.getChannelData(0);
  for(let i=0;i<n;i++)data[i]=Math.random()*2-1;
  const src=ctx.createBufferSource();src.buffer=buf;
  const filter=ctx.createBiquadFilter();filter.type="bandpass";filter.frequency.setValueAtTime(frequency,t);
  if(sweep)filter.frequency.exponentialRampToValueAtTime(sweep,t+duration);
  filter.Q.value=.8;
  const gain=ctx.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(peak,t+Math.min(.05,duration/3));
  gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  src.connect(filter);filter.connect(gain);gain.connect(mixDest);src.start(t);src.stop(t+duration+.02);
}
async function playSfx(name){
  try{await ensureMic();await ctx.resume()}catch(e){return}
  if(name==="ding"){tone(880,.55,.3,"sine");tone(1320,.4,.12,"sine",.02)}
  else if(name==="bell"){[523,659,784,1046].forEach((f,i)=>tone(f,1.1,.16,"sine",i*.06))}
  else if(name==="whoosh"){noise(.9,.22,350,0,3000)}
  else if(name==="applause"){for(let i=0;i<14;i++)noise(.12,.05+Math.random()*.05,1200+Math.random()*2200,i*.075)}
  else if(name==="drumroll"){for(let i=0;i<18;i++)noise(.055,.13,180,i*.055)}
}
document.querySelectorAll(".lv-sfx button").forEach(btn=>btn.onclick=async()=>{
  const sfx=btn.dataset.sfx;await playSfx(sfx);
  try{await liveApi({action:"sfx",room:roomId,sfx})}catch(e){status("Couldn’t send the sound effect: "+e.message)}
});
$("lvShowQuestion").onclick=async()=>{
  try{await liveApi({action:"question",room:roomId,text:$("lvQuestion").value.trim()});status("Question shown to guests.")}
  catch(e){status("Couldn’t show the question: "+e.message)}
};
$("lvClearQuestion").onclick=async()=>{
  $("lvQuestion").value="";
  try{await liveApi({action:"question",room:roomId,text:""});status("On-screen text cleared.")}
  catch(e){status("Couldn’t clear the screen: "+e.message)}
};
$("lvSendChat").onclick=async()=>{
  const input=$("lvChat"),text=input.value.trim();if(!text)return;
  input.value="";
  try{await liveApi({action:"chat",room:roomId,from:HOST_TOKEN,text})}catch(e){note("Couldn’t send chat: "+e.message,true)}
};
$("lvChat").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("lvSendChat").click()}});
async function setTimer(running,seconds){
  try{await liveApi({action:"timer",room:roomId,running,seconds})}catch(e){status("Couldn’t update the timer: "+e.message)}
}
$("lvTimerStart").onclick=()=>{timerRunning=true;timerBase=Date.now();setTimer(true,Math.floor(timerElapsed()))};
$("lvTimerPause").onclick=()=>{timerSeconds=timerElapsed();timerRunning=false;setTimer(false,Math.floor(timerSeconds))};
$("lvTimerReset").onclick=()=>{timerRunning=false;timerSeconds=0;timerBase=Date.now();setTimer(false,0)};
window.addEventListener("pagehide",()=>{clearInterval(pollTimer);if(localStream)localStream.getTracks().forEach(t=>t.stop());if(ctx)ctx.close().catch(()=>{})});
});
