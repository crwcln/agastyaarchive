// Studio: live mic chain with filters, Voice-Memos-style waveform, level meter, chapter markers and review playback.
// Filters shape the live recording (they are baked into the audio). Imported files are used as-is.
window.Studio=(()=>{
const $=id=>document.getElementById(id);
const PRESETS={
  "Natural":  {gain:0,hp:60, warm:0, pres:0, air:0, lp:20000,comp:15,gate:-80,rev:0, echo:0},
  "Podcast":  {gain:3,hp:90, warm:2, pres:4, air:2, lp:20000,comp:55,gate:-60,rev:0, echo:0},
  "Warm FM":  {gain:3,hp:80, warm:5, pres:2, air:0, lp:16000,comp:70,gate:-62,rev:6, echo:0},
  "Bright":   {gain:2,hp:100,warm:-1,pres:5, air:5, lp:20000,comp:45,gate:-60,rev:4, echo:0},
  "Radio":    {gain:4,hp:220,warm:-2,pres:6, air:-2,lp:7000, comp:80,gate:-55,rev:0, echo:0},
  "Telephone":{gain:6,hp:450,warm:-6,pres:6, air:-9,lp:3200, comp:60,gate:-50,rev:0, echo:0},
  "Cathedral":{gain:0,hp:80, warm:2, pres:1, air:2, lp:18000,comp:30,gate:-70,rev:45,echo:10},
  "Slapback": {gain:2,hp:90, warm:1, pres:3, air:2, lp:20000,comp:50,gate:-62,rev:8, echo:30}};
const CTRL=[["gain","Input gain",-12,18,1],["hp","Rumble cut",20,400,5],["warm","Warmth",-9,9,.5],["pres","Presence",-9,9,.5],["air","Air",-9,9,.5],
  ["lp","Treble limit",3000,20000,100],["comp","Compression",0,100,1],["gate","Noise gate",-80,-30,1],["rev","Reverb",0,100,1],["echo","Echo",0,100,1]];
const sgn=v=>(v>0?"+":"")+v;
const fmt=(k,v)=>k==="gate"?(v<=-80?"Off":v+" dB"):/^(gain|warm|pres|air)$/.test(k)?sgn(v)+" dB":k==="hp"?v+" Hz":k==="lp"?(v>=1000?(v/1000).toFixed(1)+" kHz":v+" Hz"):v+"%";
const clock=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const clockT=s=>{s=Math.max(0,s);return Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0")+"."+Math.floor(s*10%10)};
const C={ink:"#f1e7d3",rec:"#ff453a",gold:"#e0b04a"};
const STATES={idle:"Standby",live:"Mic live",rec:"On air",paused:"Paused",review:"Review"};

function create(opts){
  opts=opts||{};
  let S=Object.assign({},PRESETS.Podcast),preset="Podcast",ns=true,ec=true,devId="";
  try{const j=JSON.parse(localStorage.getItem("aa_studio_v1")||"null");if(j&&j.S){S=Object.assign(S,j.S);preset=j.preset||"Custom";ns=j.ns!==false;ec=j.ec!==false}}catch(e){}
  const save=()=>{try{localStorage.setItem("aa_studio_v1",JSON.stringify({preset,S,ns,ec}))}catch(e){}};
  const el={studio:$("studio"),wave:$("stwave"),meter:$("stmeter"),dev:$("stdev"),empty:$("stempty"),review:$("streview"),
    start:$("hpstart"),pause:$("hppause"),mark:$("stmark"),check:$("stcheck"),play:$("stplay"),redo:$("stredo"),time:$("hptime"),total:$("sttotal"),clip:$("stclip"),mode:$("stmode")};
  el.editor=$("steditor");el.selection=$("stselection");el.cut=$("stcut");el.trim=$("sttrim");el.replace=$("streplacefile");el.replaceLabel=$("streplaceLabel");el.undo=$("stundo");el.redoEdit=$("stredoedit");el.clear=$("stclear");
  const audio=$("hpprev");
  let ctx,stream,nodes={},rec,chunks=[],mime="",open=false,recording=false,paused=false,checking=false;
  let t0=0,acc=0,hist=[],roll=[],markers=[],pk=0,nextBar=0,raf=0,pl=0,gateTimer=0,gateThr=-80,holdUntil=0;
  let mode="idle",peaks=null,curDur=0,lvl=-80,pkHold=-80,clipUntil=0,fileTok=0,seeking=false,dragStart=null,selection=null,undoStack=[],redoStack=[];

  /* ---------- filter rack UI ---------- */
  const outs={},ranges={};
  Object.keys(PRESETS).forEach(n=>{const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=n;
    b.onclick=()=>{S=Object.assign({},PRESETS[n]);preset=n;sync();apply();save()};$("stpresets").append(b)});
  CTRL.forEach(([k,label,min,max,step])=>{
    const w=document.createElement("label"),nm=document.createElement("span"),o=document.createElement("output"),r=document.createElement("input");
    w.className="sl";nm.textContent=label;r.type="range";r.min=min;r.max=max;r.step=step;
    r.addEventListener("input",()=>{S[k]=+r.value;preset="Custom";sync();apply();save()});
    w.append(nm,o,r);$("stsliders").append(w);outs[k]=o;ranges[k]=r});
  function sync(){CTRL.forEach(([k])=>{ranges[k].value=S[k];outs[k].textContent=fmt(k,S[k])});
    [...$("stpresets").children].forEach(c=>c.classList.toggle("on",c.textContent===preset));$("stcustom").hidden=preset!=="Custom"}
  $("stns").checked=ns;$("stec").checked=ec;
  const reopen=async()=>{if(open&&!recording){closeMic();try{await openMic()}catch(e){opts.onMessage&&opts.onMessage("Mic problem: "+e.message)}}};
  $("stns").onchange=e=>{ns=e.target.checked;save();reopen()};
  $("stec").onchange=e=>{ec=e.target.checked;save();reopen()};
  $("stmon").onchange=e=>{if(nodes.mon)nodes.mon.gain.setTargetAtTime(e.target.checked?1:0,ctx.currentTime,.03)};
  el.dev.onchange=()=>{devId=el.dev.value;reopen()};
  sync();

  /* ---------- audio engine ---------- */
  function apply(){
    const n=nodes;gateThr=S.gate;if(!n.inG)return;const t=ctx.currentTime,sm=(p,v)=>p.setTargetAtTime(v,t,.03);
    sm(n.inG.gain,Math.pow(10,S.gain/20));sm(n.hp.frequency,S.hp);sm(n.low.gain,S.warm);sm(n.pres.gain,S.pres);sm(n.high.gain,S.air);sm(n.lp.frequency,S.lp);
    const c=S.comp;n.comp.threshold.setTargetAtTime(-12-c*.28,t,.05);n.comp.ratio.setTargetAtTime(1.5+c*.065,t,.05);sm(n.mk.gain,Math.pow(10,c*.09/20));
    sm(n.rev.gain,S.rev/100*.9);sm(n.echo.gain,S.echo/100*.7);
  }
  function impulse(c){const len=Math.floor(c.sampleRate*1.8),b=c.createBuffer(2,len,c.sampleRate);
    for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3)}return b}
  async function openMic(){
    if(open)return;
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:ec,noiseSuppression:ns,autoGainControl:false,...(devId?{deviceId:{exact:devId}}:{})}});
    const AC=window.AudioContext||window.webkitAudioContext;ctx=new AC();if(ctx.resume)await ctx.resume();
    const bq=o=>{const f=ctx.createBiquadFilter();f.type=o.type;if(o.frequency!=null)f.frequency.value=o.frequency;if(o.Q!=null)f.Q.value=o.Q;return f},n=nodes={};
    const src=ctx.createMediaStreamSource(stream);
    n.inG=ctx.createGain();n.hp=bq({type:"highpass",Q:.7});n.low=bq({type:"lowshelf",frequency:200});n.pres=bq({type:"peaking",frequency:3500,Q:.9});
    n.high=bq({type:"highshelf",frequency:9000});n.lp=bq({type:"lowpass",Q:.7});
    n.gateAn=ctx.createAnalyser();n.gateAn.fftSize=1024;n.gate=ctx.createGain();
    n.comp=ctx.createDynamicsCompressor();n.comp.knee.value=12;n.comp.attack.value=.004;n.comp.release.value=.25;n.mk=ctx.createGain();
    n.conv=ctx.createConvolver();n.conv.buffer=impulse(ctx);n.rev=ctx.createGain();
    n.delay=ctx.createDelay(1);n.delay.delayTime.value=.28;n.fb=ctx.createGain();n.fb.gain.value=.32;n.echo=ctx.createGain();
    n.mix=ctx.createGain();n.lim=ctx.createDynamicsCompressor();n.lim.threshold.value=-2;n.lim.knee.value=0;n.lim.ratio.value=20;n.lim.attack.value=.001;n.lim.release.value=.1;
    n.an=ctx.createAnalyser();n.an.fftSize=2048;n.dest=ctx.createMediaStreamDestination();n.dest.channelCountMode="explicit";n.dest.channelCount=1;
    n.mon=ctx.createGain();n.mon.gain.value=$("stmon").checked?1:0;
    src.connect(n.inG);n.inG.connect(n.hp);n.hp.connect(n.low);n.low.connect(n.pres);n.pres.connect(n.high);n.high.connect(n.lp);
    n.lp.connect(n.gateAn);n.lp.connect(n.gate);n.gate.connect(n.comp);n.comp.connect(n.mk);
    n.mk.connect(n.mix);n.mk.connect(n.conv);n.conv.connect(n.rev);n.rev.connect(n.mix);
    n.mk.connect(n.delay);n.delay.connect(n.echo);n.echo.connect(n.mix);n.delay.connect(n.fb);n.fb.connect(n.delay);
    n.mix.connect(n.lim);n.lim.connect(n.an);n.an.connect(n.dest);n.an.connect(n.mon);n.mon.connect(ctx.destination);
    open=true;apply();listDevs();
    const gb=new Float32Array(1024);holdUntil=0;
    gateTimer=setInterval(()=>{
      if(gateThr<=-80||document.hidden){n.gate.gain.setTargetAtTime(1,ctx.currentTime,.01);return}
      n.gateAn.getFloatTimeDomainData(gb);let s=0;for(let i=0;i<gb.length;i++)s+=gb[i]*gb[i];
      const db=20*Math.log10(Math.sqrt(s/gb.length)+1e-9),now=performance.now();
      if(db>gateThr){holdUntil=now+250;n.gate.gain.setTargetAtTime(1,ctx.currentTime,.008)}
      else if(now>holdUntil)n.gate.gain.setTargetAtTime(.02,ctx.currentTime,.06)},20);
    roll=[];nextBar=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);ui();
  }
  function closeMic(){
    if(!open)return;open=false;cancelAnimationFrame(raf);clearInterval(gateTimer);
    try{stream.getTracks().forEach(t=>t.stop())}catch(e){}try{ctx.close()}catch(e){}
    nodes={};roll=[];lvl=pkHold=-80;ui();draw();
  }
  async function listDevs(){
    try{const d=(await navigator.mediaDevices.enumerateDevices()).filter(x=>x.kind==="audioinput"),tr=stream&&stream.getAudioTracks()[0],cur=tr&&tr.getSettings().deviceId;
      el.dev.replaceChildren(...d.map((x,i)=>new Option(x.label||"Microphone "+(i+1),x.deviceId)));if(cur)el.dev.value=cur;el.dev.hidden=d.length<2}catch(e){}
  }
  const elapsed=()=>acc+(recording&&!paused?(performance.now()-t0)/1000:0);
  const cur=()=>audio.currentTime||0;

  function tick(){
    raf=requestAnimationFrame(tick);const an=nodes.an;if(!an)return;
    const buf=tick.buf||(tick.buf=new Float32Array(an.fftSize));an.getFloatTimeDomainData(buf);
    let s=0,p=0;for(let i=0;i<buf.length;i++){const v=buf[i],a=v<0?-v:v;s+=v*v;if(a>p)p=a}
    const db=20*Math.log10(Math.sqrt(s/buf.length)+1e-9),pdb=20*Math.log10(p+1e-9),now=performance.now();
    lvl=Math.max(db,lvl-1.2);pkHold=Math.max(pdb,pkHold-.3);if(p>=.985)clipUntil=now+1500;
    el.clip.classList.toggle("on",now<clipUntil);
    pk=Math.max(pk,p);
    if(!paused&&now>=nextBar){const k=Math.max(1,Math.floor((now-nextBar)/50)+1);
      for(let i=0;i<k;i++){roll.push(pk);if(recording)hist.push(pk)}pk=0;nextBar+=k*50;if(roll.length>900)roll.splice(0,roll.length-900)}
    if(recording)el.time.textContent=clockT(elapsed());
    draw();
  }

  /* ---------- drawing ---------- */
  function fit(cv){const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1,w=Math.round(r.width*d),h=Math.round(r.height*d);
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}const g=cv.getContext("2d");g.setTransform(d,0,0,d,0,0);return[g,r.width,r.height]}
  const amp=v=>Math.min(1,Math.pow(v,.55)*1.25);
  function drawMeter(){
    const [g,W,H]=fit(el.meter);g.clearRect(0,0,W,H);const segs=40,sw=W/segs,pos=d=>Math.max(0,Math.min(1,(d+60)/60)),lit=Math.round(pos(lvl)*segs),pks=Math.round(pos(pkHold)*segs);
    for(let i=0;i<segs;i++){const d=-60+i/segs*60;g.fillStyle=i<lit?(d>-6?"#ff3b30":d>-18?"#facc15":"#4ade80"):"rgba(241,231,211,.1)";g.fillRect(i*sw+1,0,sw-2,H)}
    if(pks>0){g.fillStyle=C.ink;g.fillRect(Math.min(segs-1,pks-1)*sw+1,0,sw-2,H)}
  }
  function drawWave(){
    const [g,W,H]=fit(el.wave);g.clearRect(0,0,W,H);const mid=H/2,step=5;
    g.strokeStyle="rgba(241,231,211,.07)";g.beginPath();g.moveTo(0,mid);g.lineTo(W,mid);g.stroke();
    g.font="10px 'Space Grotesk',sans-serif";
    if(mode==="review"&&!open&&!recording){
      if(!peaks||!peaks.length){g.fillStyle="rgba(241,231,211,.55)";g.textAlign="center";g.fillText("Waveform unavailable for this file. It will still play and publish.",W/2,mid);g.textAlign="left";return}
      const dur=curDur||audio.duration||1,n=Math.max(1,Math.floor((W-16)/step)),r=Math.min(1,cur()/dur);
      if(selection){const left=8+selection.start/dur*(n*step),right=8+selection.end/dur*(n*step);g.fillStyle="rgba(224,176,74,.2)";g.fillRect(left,0,right-left,H);g.strokeStyle=C.gold;g.lineWidth=1;g.strokeRect(left+.5,.5,Math.max(0,right-left-1),H-1)}
      for(let i=0;i<n;i++){const s=Math.floor(i/n*peaks.length),e=Math.max(s+1,Math.floor((i+1)/n*peaks.length));let v=0;for(let k=s;k<e;k++)if(peaks[k]>v)v=peaks[k];
        const h=Math.max(2,amp(v)*(H-30));g.fillStyle=i/n<r?C.gold:"rgba(241,231,211,.38)";g.fillRect(8+i*step,mid-h/2,3,h)}
      const span=n*step;
      markers.forEach(m=>{const x=8+Math.min(1,m.t/dur)*span;g.fillStyle=C.gold;g.fillRect(x-.5,4,1.5,H-8);g.fillRect(x,4,10,6)});
      const px=8+r*span;g.fillStyle=C.rec;g.fillRect(px-1,0,2,H);g.beginPath();g.arc(px,5,4,0,7);g.fill();return;
    }
    const nowX=W*.8,n=roll.length,vis=Math.floor(nowX/step);
    g.setLineDash([2,6]);g.strokeStyle="rgba(241,231,211,.25)";g.beginPath();g.moveTo(nowX,mid);g.lineTo(W,mid);g.stroke();g.setLineDash([]);
    for(let i=0;i<Math.min(vis,n);i++){const h=Math.max(2,amp(roll[n-1-i])*(H-34));g.globalAlpha=Math.max(.2,1-i/vis*.8);g.fillStyle=recording?C.rec:C.ink;g.fillRect(nowX-i*step-1.5,mid-h/2,3,h)}
    g.globalAlpha=1;
    if(recording){const hl=hist.length;g.fillStyle="rgba(241,231,211,.55)";
      for(let i=0;i<vis;i++){const j=hl-1-i;if(j<0)break;if(j%100===0){const x=nowX-i*step;g.fillRect(x-.5,H-16,1,5);g.fillText(clock(j/20),x+3,H-6)}}
      markers.forEach(m=>{const i=hl-1-Math.round(m.t*20);if(i<0||i>=vis)return;const x=nowX-i*step;g.fillStyle=C.gold;g.fillRect(x-.5,6,1.5,H-22);g.fillRect(x,6,10,6)})}
    if(open){g.fillStyle=recording?C.rec:C.gold;g.fillRect(nowX-1,0,2,H);g.beginPath();g.arc(nowX,5,4,0,7);g.fill()}
  }
  function draw(){drawWave();drawMeter()}
  new ResizeObserver(draw).observe(el.wave.parentElement);

  /* ---------- UI state ---------- */
  function ui(){
    const st=recording?(paused?"paused":"rec"):open?"live":mode==="review"?"review":"idle";
    el.studio.dataset.state=st;el.studio.dataset.mode=mode;el.mode.textContent=STATES[st];
    el.start.setAttribute("aria-label",recording?"Stop recording":"Start recording");el.start.title=recording?"Stop":"Record";
    el.pause.disabled=!recording;el.pause.querySelector("span").textContent=paused?"Resume":"Pause";
    el.check.disabled=recording;el.check.querySelector("span").textContent=open&&!recording?"Stop check":"Mic check";
    el.mark.disabled=!(recording||mode==="review");el.empty.hidden=!(mode==="idle"&&!open&&!recording);
    el.review.hidden=!(mode==="review"&&!recording);el.dev.disabled=recording;
    el.play.classList.toggle("playing",!audio.paused&&mode==="review");
    const editable=mode==="review"&&!recording&&!!(opts.hasAudio&&opts.hasAudio());
    el.editor.hidden=!editable;
    el.cut.disabled=el.trim.disabled=el.replace.disabled=el.clear.disabled=!editable||!selection;
    el.replaceLabel.classList.toggle("disabled",!editable||!selection);
    el.undo.disabled=!undoStack.length;
    el.redoEdit.disabled=!redoStack.length;
    el.selection.textContent=selection?clockT(selection.start)+" – "+clockT(selection.end):"None";
  }

  /* ---------- recording ---------- */
  async function start(){
    if(recording)return;
    if(mode==="review"&&opts.hasAudio&&opts.hasAudio()&&!(await (opts.confirm?opts.confirm("Replace the current audio? This can’t be undone.","Replace recording"):Promise.resolve(window.confirm("Replace the current audio? This can’t be undone.")))))return;
    audio.pause();
    try{await openMic()}catch(e){opts.onMessage&&opts.onMessage("Mic blocked or unavailable: "+e.message);return}
    const mt=["audio/webm;codecs=opus","audio/mp4","audio/webm"].find(m=>window.MediaRecorder&&MediaRecorder.isTypeSupported(m))||"";mime=mt;
    rec=new MediaRecorder(nodes.dest.stream,{...(mt?{mimeType:mt}:{}),audioBitsPerSecond:48000});
    chunks=[];hist=[];markers=[];peaks=null;selection=null;undoStack=[];redoStack=[];acc=0;mode="idle";
    rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=finish;
    rec.start(1000);recording=true;paused=false;t0=performance.now();nextBar=t0;
    opts.onStart&&opts.onStart();el.time.textContent=clockT(0);el.total.textContent="";ui();
  }
  function stop(){if(!recording)return;acc=elapsed();if(rec.state!=="inactive")rec.stop()}
  function finish(){
    const b=new Blob(chunks,{type:(rec&&rec.mimeType)||mime||"audio/webm"}),dur=acc;
    recording=false;paused=false;checking=false;closeMic();
    mode="review";peaks=hist.slice();curDur=dur;
    opts.onAudio&&opts.onAudio(b);
    audio.addEventListener("loadedmetadata",fixDur,{once:true});
    el.time.textContent=clockT(0);el.total.textContent="/ "+clockT(dur);ui();draw();
  }
  function fixDur(){ // MediaRecorder files report an infinite duration until the end has been seen
    if(audio.duration===Infinity){const f=()=>{audio.removeEventListener("timeupdate",f);audio.currentTime=0};audio.addEventListener("timeupdate",f);audio.currentTime=1e101}
  }
  el.start.onclick=()=>recording?stop():start();
  el.pause.onclick=()=>{if(!recording)return;if(!paused){acc=elapsed();rec.pause();paused=true}else{t0=performance.now();nextBar=t0;rec.resume();paused=false}ui()};
  el.check.onclick=()=>{if(recording)return;if(open){checking=false;closeMic()}else{checking=true;openMic().catch(e=>{checking=false;opts.onMessage&&opts.onMessage("Mic blocked or unavailable: "+e.message)})}};
  el.mark.onclick=()=>{
    const t=recording?elapsed():cur();markers.push({t});opts.onMarker&&opts.onMarker(t,markers.length);
    el.mark.classList.add("flash");setTimeout(()=>el.mark.classList.remove("flash"),400);draw();
  };
  if(opts.markers===false)el.mark.hidden=true;

  /* ---------- review ---------- */
  function reset(){audio.pause();mode="idle";peaks=null;hist=[];markers=[];selection=null;undoStack=[];redoStack=[];curDur=0;fileTok++;el.time.textContent=clockT(0);el.total.textContent="";ui();draw()}
  el.redo.onclick=async()=>{if(await (opts.confirm?opts.confirm("Discard this recording and start over?","Discard recording"):Promise.resolve(window.confirm("Discard this recording and start over?")))){reset();opts.onDiscard&&opts.onDiscard()}};
  el.play.onclick=()=>{if(mode!=="review")return;if(audio.paused){if(audio.ended)audio.currentTime=0;audio.play()}else audio.pause()};
  const playLoop=()=>{draw();el.time.textContent=clockT(cur());if(!audio.paused&&!audio.ended)pl=requestAnimationFrame(playLoop)};
  audio.addEventListener("play",()=>{if(mode!=="review")return;cancelAnimationFrame(pl);playLoop();ui()});
  ["pause","ended"].forEach(ev=>audio.addEventListener(ev,()=>{if(mode!=="review")return;ui();draw()}));
  audio.addEventListener("loadedmetadata",()=>{if(mode==="review"&&Number.isFinite(audio.duration)&&audio.duration>0){curDur=audio.duration;el.total.textContent="/ "+clockT(curDur);draw()}});
  const pointerTime=e=>{const r=el.wave.getBoundingClientRect(),dur=curDur||audio.duration;if(!dur||!Number.isFinite(dur))return null;return Math.max(0,Math.min(1,(e.clientX-r.left-8)/(r.width-16)))*dur};
  const setSelection=(start,end)=>{
    if(start===null||end===null){selection=null;ui();draw();return}
    const a=Math.max(0,Math.min(start,end)),b=Math.min(curDur||audio.duration,Math.max(start,end));
    selection=b-a>.12?{start:a,end:b}:null;ui();draw();
  };
  const seek=e=>{const time=pointerTime(e);if(time===null)return;audio.currentTime=time;el.time.textContent=clockT(cur());draw()};
  el.wave.addEventListener("pointerdown",e=>{
    if(mode!=="review"||open||recording)return;
    dragStart=pointerTime(e);seeking=dragStart!==null;el.wave.setPointerCapture(e.pointerId);
  });
  el.wave.addEventListener("pointermove",e=>{if(seeking&&dragStart!==null)setSelection(dragStart,pointerTime(e))});
  const endSelection=e=>{if(!seeking)return;const end=pointerTime(e);seeking=false;if(dragStart!==null&&end!==null&&Math.abs(end-dragStart)>.12){setSelection(dragStart,end);audio.currentTime=Math.min(dragStart,end)}else seek(e);dragStart=null};
  ["pointerup","pointercancel"].forEach(ev=>el.wave.addEventListener(ev,endSelection));

  function writeWav(buffer){
    const channels=buffer.numberOfChannels,frames=buffer.length,dataSize=frames*channels*2,bytes=new ArrayBuffer(44+dataSize),view=new DataView(bytes);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i))};
    text(0,"RIFF");view.setUint32(4,36+dataSize,true);text(8,"WAVE");text(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
    view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,dataSize,true);
    const samples=Array.from({length:channels},(_,channel)=>buffer.getChannelData(channel));let offset=44;
    for(let frame=0;frame<frames;frame++)for(let channel=0;channel<channels;channel++){const sample=Math.max(-1,Math.min(1,samples[channel][frame]));view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2}
    return new Blob([bytes],{type:"audio/wav"});
  }
  function remember(stack,file){
    stack.push(file);
    while(stack.length>2||stack.reduce((sum,item)=>sum+item.size,0)>240*1024*1024)stack.shift();
  }
  async function editAudio(kind,replacementBlob){
    if(!selection||!opts.getAudio)return;
    const originalBlob=opts.getAudio();
    if(originalBlob.size>120*1024*1024)throw new Error("Audio edits are limited to 120 MB to protect this device’s memory.");
    const AC=window.AudioContext||window.webkitAudioContext,context=new AC();
    try{
      const original=await context.decodeAudioData(await originalBlob.arrayBuffer()),rate=original.sampleRate;
      const start=Math.floor(selection.start*rate),end=Math.min(original.length,Math.floor(selection.end*rate));
      let replacement=null;
      if(kind==="replace"){
        replacement=await context.decodeAudioData(await replacementBlob.arrayBuffer());
        if(replacement.sampleRate!==rate){
          const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
          if(!Offline)throw new Error("This browser cannot resample replacement audio.");
          const offline=new Offline(Math.min(original.numberOfChannels,2),Math.ceil(replacement.duration*rate),rate),source=offline.createBufferSource();
          source.buffer=replacement;source.connect(offline.destination);source.start();replacement=await offline.startRendering();
        }
      }
      const left=kind==="trim"?0:start,right=kind==="trim"?0:original.length-end,insertLength=kind==="trim"?end-start:kind==="replace"?replacement.length:0;
      const frames=kind==="trim"?insertLength:left+insertLength+right;
      if(!frames)throw new Error("This edit would leave no audio.");
      const output=context.createBuffer(original.numberOfChannels,frames,rate);
      for(let channel=0;channel<output.numberOfChannels;channel++){
        const out=output.getChannelData(channel),source=original.getChannelData(channel);
        if(kind==="trim")out.set(source.subarray(start,end));
        else{
          out.set(source.subarray(0,start),0);
          if(kind==="replace"){const insert=replacement.getChannelData(Math.min(channel,replacement.numberOfChannels-1));out.set(insert.subarray(0,insertLength),start)}
          if(right)out.set(source.subarray(end),start+insertLength);
        }
      }
      const result=writeWav(output);remember(undoStack,originalBlob);redoStack=[];
      opts.onAudio&&opts.onAudio(result);selection=null;showFile(result,true);ui();
      opts.onMessage&&opts.onMessage(kind==="cut"?"Selection removed. Undo is available.":kind==="trim"?"Audio trimmed to the selection. Undo is available.":"Selection replaced. Undo is available.");
    }finally{await context.close()}
  }
  async function runEdit(kind,file){
    el.cut.disabled=el.trim.disabled=el.replace.disabled=el.undo.disabled=true;
    try{await editAudio(kind,file)}catch(error){opts.onMessage&&opts.onMessage("Audio edit failed: "+error.message)}
    finally{ui()}
  }
  el.cut.onclick=()=>runEdit("cut");
  el.trim.onclick=()=>runEdit("trim");
  el.replace.onchange=event=>{const file=event.target.files[0];if(file)runEdit("replace",file);event.target.value=""};
  el.clear.onclick=()=>setSelection(null,null);
  el.undo.onclick=()=>{
    const previous=undoStack.pop();if(!previous)return;
    remember(redoStack,opts.getAudio());opts.onAudio&&opts.onAudio(previous);selection=null;showFile(previous,true);ui();opts.onMessage&&opts.onMessage("Last audio edit undone.");
  };
  el.redoEdit.onclick=()=>{
    const next=redoStack.pop();if(!next)return;
    remember(undoStack,opts.getAudio());opts.onAudio&&opts.onAudio(next);selection=null;showFile(next,true);ui();opts.onMessage&&opts.onMessage("Audio edit redone.");
  };

  async function peaksFromFile(f){
    if(f.size>60e6)return null;
    try{const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext,buf=await new AC(1,1,8000).decodeAudioData(await f.arrayBuffer());
      const d=buf.getChannelData(0),bins=1600,step=Math.max(1,Math.floor(d.length/bins)),out=[];
      for(let i=0;i<bins;i++){let m=0;const s=i*step,e=Math.min(d.length,s+step);for(let k=s;k<e;k++){const a=d[k]<0?-d[k]:d[k];if(a>m)m=a}out.push(m)}
      return{peaks:out,dur:buf.duration}}catch(e){return null}
  }
  function showFile(f,keepHistory){
    if(recording)return;audio.pause();if(open&&!checking)closeMic();
    if(!keepHistory){undoStack=[];redoStack=[]}
    selection=null;
    mode="review";markers=[];peaks=null;curDur=0;const tok=++fileTok;el.time.textContent=clockT(0);el.total.textContent="";ui();draw();
    peaksFromFile(f).then(r=>{if(tok!==fileTok)return;if(r){peaks=r.peaks;curDur=r.dur;el.total.textContent="/ "+clockT(r.dur)}draw()});
  }

  /* ---------- keyboard: M = marker, Space = pause / play ---------- */
  addEventListener("keydown",e=>{
    const t=e.target;if(e.metaKey||e.ctrlKey||e.altKey||(t.closest&&t.closest("input,textarea,select")))return;
    if(e.key==="m"||e.key==="M"){if(!el.mark.disabled&&!el.mark.hidden){e.preventDefault();el.mark.click()}}
    else if(e.key===" "&&!(t.closest&&t.closest("button,a,summary"))){if(recording){e.preventDefault();el.pause.click()}else if(mode==="review"){e.preventDefault();el.play.click()}}
  });
  addEventListener("pagehide",()=>{if(open&&!recording)closeMic()});
  ui();draw();
  return{reset,showFile};
}
return{create};
})();
