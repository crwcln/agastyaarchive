// Guest page for a live room: WebRTC audio to the host plus chat, timer, sound effects and host questions.
(()=>{
const $=id=>document.getElementById(id),room=new URLSearchParams(location.search).get("room")||"",HOST_ID="0".repeat(32);
let peerId="",pc=null,localStream=null,ctx=null,since=0,pollTimer=null,timerRunning=false,timerSeconds=0,timerBase=0,ended=false,muted=false,pendingCandidates=[];
try{if(sessionStorage.getItem("aa_live_room")===room)peerId=sessionStorage.getItem("aa_live_peer")||""}catch(e){}
const status=t=>$("gvStatus").textContent=t;
const clock=s=>{s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")};
async function api(body){
  const r=await fetch("/api/live",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const text=await r.text();let d={};try{d=JSON.parse(text)}catch(e){}
  if(!r.ok)throw new Error(d.error||"HTTP "+r.status);
  return d;
}
function connection(state,message){
  const box=$("gvConnection");box.className="lv-connection"+(state==="on"?" on":state==="bad"?" bad":"");
  $("gvConnText").textContent=message;
}
function say(name,text,question){
  const row=document.createElement("div");row.className="lv-msg"+(question?" question":"");
  const b=document.createElement("b");b.textContent=name;
  row.append(b,document.createTextNode(": "+text));
  $("gvChat").append(row);$("gvChat").scrollTop=$("gvChat").scrollHeight;
}
function overlay(text){$("gvOverlayText").textContent=text||"";$("gvOverlay").hidden=!text}
function sendSignal(data){return api({action:"signal",room,from:peerId,to:HOST_ID,data})}
async function handleSignal(data){
  if(!pc||!data)return;
  try{
    if(data.type==="offer"){
      await pc.setRemoteDescription(data.sdp);
      for(const candidate of pendingCandidates.splice(0))await pc.addIceCandidate(candidate).catch(()=>{});
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      await sendSignal({type:"answer",sdp:pc.localDescription});connection("on","Connected to the host.");
    }else if(data.type==="candidate"){
      if(pc.remoteDescription)await pc.addIceCandidate(data.candidate);
      else pendingCandidates.push(data.candidate);
    }else if(data.type==="bye")connection("bad","The host ended the call.");
  }catch(e){connection("bad","Couldn’t connect: "+e.message)}
}
function tone(freq,duration,peak,type,delay){
  const t=ctx.currentTime+(delay||0),osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=type||"sine";osc.frequency.setValueAtTime(freq,t);
  gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(peak,t+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+duration+.05);
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
  src.connect(filter);filter.connect(gain);gain.connect(ctx.destination);src.start(t);src.stop(t+duration+.02);
}
function playSfx(name){
  try{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();ctx.resume()}catch(e){return}
  if(name==="ding"){tone(880,.55,.18);tone(1320,.4,.07,"sine",.02)}
  else if(name==="bell"){[523,659,784,1046].forEach((f,i)=>tone(f,1.1,.09,"sine",i*.06))}
  else if(name==="whoosh")noise(.9,.14,350,0,3000);
  else if(name==="applause"){for(let i=0;i<14;i++)noise(.12,.035,1200+Math.random()*2200,i*.075)}
  else if(name==="drumroll"){for(let i=0;i<18;i++)noise(.055,.08,180,i*.055)}
}
function handleEvent(event){
  if(event.type==="signal"&&event.to===peerId){handleSignal(event.data);return}
  if(event.type==="chat"){say(event.name||"Host",event.text,event.question);return}
  if(event.type==="sfx"){playSfx(event.sfx);return}
  if(event.type==="question"){overlay(String(event.text||""));return}
  if(event.type==="timer"){timerRunning=!!event.running;timerSeconds=Number(event.seconds)||0;timerBase=Date.now();return}
  if(event.type==="control"){
    const labels={recording:"Host is recording",paused:"Host paused the recording",stopped:"Recording stopped",idle:"Standby"};
    connection("on",labels[event.state]||"Connected");return
  }
  if(event.type==="end"){endRoom("The live show has ended.");return}
  if(event.type==="join"||event.type==="leave"){return}
}
async function poll(){
  if(!peerId||ended)return;
  try{
    const d=await api({action:"poll",room,peer:peerId,since});
    since=d.since;
    d.events.forEach(handleEvent);
    $("gvOverlayTimer").textContent=clock(timerSeconds+(timerRunning?(Date.now()-timerBase)/1000:0));
  }catch(e){
    if(/ended|incorrect/i.test(e.message))endRoom("The live show has ended.");
    else connection("bad",e.message);
  }
}
async function setupMedia(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("This browser can’t use a microphone.");
  localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false}});
  pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]});
  localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  pc.ontrack=e=>{
    const audio=$("gvAudio");audio.srcObject=e.streams[0]||new MediaStream([e.track]);
    audio.play().catch(()=>{});connection("on","Connected to the host.");
  };
  pc.onicecandidate=e=>{if(e.candidate)sendSignal({type:"candidate",candidate:e.candidate.toJSON?e.candidate.toJSON():{candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex}}).catch(()=>{})};
  pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed")connection("bad","Connection failed. Try rejoining.")};
}
function endRoom(message){
  ended=true;clearInterval(pollTimer);if(pc){try{pc.close()}catch(e){}}
  if(localStream)localStream.getTracks().forEach(t=>t.stop());
  overlay(message);connection("bad",message);$("gvJoinCard").hidden=false;$("gvLive").hidden=true;
}
$("gvJoin").onclick=async()=>{
  if(!room){status("This invite link is missing a room ID.");return}
  const name=$("gvName").value.trim();if(!name){status("Enter your name first.");return}
  const btn=$("gvJoin");btn.disabled=true;status("Joining…");
  try{
    const d=await api({action:"join",room,name,token:peerId});
    peerId=d.peer.id;ended=false;since=0;
    try{sessionStorage.setItem("aa_live_room",room);sessionStorage.setItem("aa_live_peer",peerId)}catch(e){}
    $("gvTitle").textContent=d.room.title+" · "+d.room.host.name;
    if(d.room.timer){timerRunning=!!d.room.timer.running;timerSeconds=Number(d.room.timer.seconds)||0;timerBase=Date.now()}
    if(d.room.question)overlay(d.room.question);
    if(d.room.status!=="live")throw new Error("This room has ended.");
    $("gvJoinCard").hidden=true;$("gvLive").hidden=false;$("gvChat").replaceChildren();
    connection("","Connecting to the host…");
    await setupMedia();
    clearInterval(pollTimer);pollTimer=setInterval(poll,1500);poll();
    status("Joined.");
  }catch(e){status("Couldn’t join: "+e.message);$("gvJoinCard").hidden=false;$("gvLive").hidden=true}
  finally{btn.disabled=false}
};
async function sendMessage(question){
  const input=$("gvMessage"),text=input.value.trim();if(!text||!peerId||ended)return;
  input.value="";
  try{await api({action:"chat",room,from:peerId,text,question});say("You",text,question)}
  catch(e){status("Couldn’t send: "+e.message)}
}
$("gvSend").onclick=()=>sendMessage(false);$("gvAsk").onclick=()=>sendMessage(true);
$("gvMessage").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();sendMessage(false)}});
$("gvMute").onclick=()=>{
  muted=!muted;if(localStream)localStream.getAudioTracks().forEach(t=>t.enabled=!muted);
  $("gvMute").textContent=muted?"Unmute my mic":"Mute my mic";
};
$("gvLeave").onclick=async()=>{
  if(peerId)api({action:"leave",room,from:peerId}).catch(()=>{});
  endRoom("You left the live show.");peerId="";
  try{sessionStorage.removeItem("aa_live_peer");sessionStorage.removeItem("aa_live_room")}catch(e){}
};
window.addEventListener("pagehide",()=>{if(peerId&&!ended)fetch("/api/live",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"leave",room,from:peerId}),keepalive:true}).catch(()=>{})});
setInterval(()=>{$("gvTimer").textContent=clock(timerSeconds+(timerRunning?(Date.now()-timerBase)/1000:0))},250);
if(!room)status("This invite link is missing a room ID.");
})();
