// Audio editor: non-destructive timeline editing with undo/redo.
// The recording is kept as untouched source audio plus a list of segments (an "edit list"), so cutting, pasting, replacing and
// fading are instant and never lose quality. Audio is only rendered (to a compact MP3) when you publish, save a draft, or press
// "Render edits now". Working format is mono 22.05 kHz, which is plenty for speech.
window.AudioEditor=(()=>{
const SR=22050,BLOCK=256,MIN_SEL=0.05,MAX_FILE=100e6;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const clock=(s,tenths)=>{s=Math.max(0,s);const m=Math.floor(s/60),r=s-m*60;return m+":"+(r<10?"0":"")+(tenths?r.toFixed(1):Math.floor(r))};
const byId=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function create(opts){
  opts=opts||{};
  const E=Object.fromEntries(["aeditor","aecanvas","aemini","aeview","aeplay","aeplaysel","aepreview","aesel","aezout","aezfit","aezin","aedelete","aecut","aecopy","aepaste","aetrim","aerec","aerecsel",
    "aefile","aefilesel","aefilesellab","aepre","aesilence","aeinsil","aefadein","aefadeout","aegain","aenorm","aepauses","aeundo","aeredo","aerevert","aeparams","aerecbar","aerectime","aerectext",
    "aerecstop","aereccancel","aebusy","aebusytext","aestatus","aeapply","hptime","sttotal"].map(id=>[id,byId(id)||document.createElement("div")]));
  const box=E.aeditor,cv=E.aecanvas,mini=E.aemini;
  let sources=[],segs=[],origSig="",renderedSig="",blobCurrent=null,clipSegs=null,sel=null,head=0,pps=60,scroll=0,ver=0;
  let undoS=[],redoS=[],play=null,recCtl=null,recMode=null,recTimer=0,drag=null,miniCache=null,token=0,failed=false,busyFlag=false,raf=0,drawQueued=false;

  /* ---------- model ---------- */
  const total=()=>segs.reduce((n,s)=>n+(s.b-s.a),0);
  const sig=()=>JSON.stringify(segs);
  const ready=()=>segs.length>0&&!failed&&!busyFlag;
  const snapshot=()=>({segs:segs.map(s=>({...s})),sel:sel&&{...sel},head,chapters:opts.getChapters?opts.getChapters():null});
  const remember=()=>{undoS.push(snapshot());if(undoS.length>100)undoS.shift();redoS=[]};
  const emit=op=>{if(opts.onEdit)opts.onEdit(op)};
  function addSource(buf){
    const data=buf.getChannelData(0),n=data.length,np=Math.ceil(n/BLOCK),peaks=new Float32Array(np);
    for(let k=0;k<np;k++){let m=0;const e=Math.min(n,(k+1)*BLOCK);for(let i=k*BLOCK;i<e;i++){const v=data[i]<0?-data[i]:data[i];if(v>m)m=v}peaks[k]=m}
    sources.push({buf,data,peaks});return sources.length-1;
  }
  function splitAt(pos){ // make sure a segment boundary exists at timeline sample pos; returns the index of the segment that starts there
    let t=0;
    for(let i=0;i<segs.length;i++){
      const len=segs[i].b-segs[i].a;
      if(pos===t)return i;
      if(pos<t+len){const s=segs[i],cut=s.a+(pos-t);segs.splice(i,1,{...s,b:cut},{...s,a:cut});return i+1}
      t+=len;
    }
    return segs.length;
  }
  function removeRange(a,b){const i=splitAt(a),j=splitAt(b);segs.splice(i,j-i)}
  function insertSegs(pos,list){const i=splitAt(pos);segs.splice(i,0,...list.map(s=>({...s})))}
  function extract(a,b){const out=[];let pos=0;for(const s of segs){const len=s.b-s.a,sa=Math.max(a,pos),sb=Math.min(b,pos+len);if(sb>sa)out.push({...s,a:s.a+(sa-pos),b:s.a+(sb-pos)});pos+=len;if(pos>=b)break}return out}
  function compact(){const out=[];for(const s of segs){if(s.b<=s.a)continue;const p=out[out.length-1];
    if(p&&p.s===s.s&&(p.g||1)===(s.g||1)&&(s.s<0||p.b===s.a)){if(s.s<0){p.b+=s.b-s.a}else p.b=s.b}else out.push({...s})}segs=out}
  function peakOf(a,b){let pos=0,m=0;for(const s of segs){const len=s.b-s.a,sa=Math.max(a,pos),sb=Math.min(b,pos+len);
    if(sb>sa&&s.s>=0){const d=sources[s.s].data,g=s.g||1,o=s.a-pos;for(let i=sa+o;i<sb+o;i++){const v=(d[i]<0?-d[i]:d[i])*g;if(v>m)m=v}}pos+=len;if(pos>=b)break}return m}
  function processRange(a,b,fn){ // copy a (short) region into a new source, run fn over it, and drop it back in place
    const n=b-a,buf=new AudioBuffer({length:n,sampleRate:SR,numberOfChannels:1}),out=buf.getChannelData(0);let o=0;
    for(const s of extract(a,b)){const len=s.b-s.a;if(s.s>=0){const d=sources[s.s].data,g=s.g||1;for(let i=s.a;i<s.b;i++)out[o++]=d[i]*g}else o+=len}
    fn(out,n);const si=addSource(buf);removeRange(a,b);insertSegs(a,[{s:si,a:0,b:n,g:1}]);
  }
  function findPauses(thr,minLen){
    const runs=[];let pos=0,start=-1;
    const flush=end=>{if(start>=0&&end-start>=minLen)runs.push({a:start,b:end});start=-1};
    for(const s of segs){
      const len=s.b-s.a;
      if(s.s<0){if(start<0)start=pos}
      else{const pk=sources[s.s].peaks,g=s.g||1;
        for(let k=Math.floor(s.a/BLOCK),k1=Math.floor((s.b-1)/BLOCK);k<=k1;k++){
          const ts=pos+(Math.max(s.a,k*BLOCK)-s.a);
          if(pk[k]*g<thr){if(start<0)start=ts}else flush(ts);
        }}
      pos+=len;
    }
    flush(pos);return runs;
  }

  /* ---------- decoding / loading ---------- */
  async function decodeBlob(blob){
    if(blob.size>MAX_FILE)throw new Error("this file is too large to edit in the browser (limit "+Math.round(MAX_FILE/1e6)+" MB)");
    const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext,ctx=new AC(1,1,SR),ab=await blob.arrayBuffer();
    let dec=await new Promise((res,rej)=>{const p=ctx.decodeAudioData(ab,res,rej);if(p&&p.then)p.then(res,rej)});
    if(dec.numberOfChannels>1){
      const out=new AudioBuffer({length:dec.length,sampleRate:dec.sampleRate,numberOfChannels:1}),o=out.getChannelData(0),chs=[];
      for(let c=0;c<dec.numberOfChannels;c++)chs.push(dec.getChannelData(c));
      for(let i=0;i<dec.length;i++){let v=0;for(let c=0;c<chs.length;c++)v+=chs[c][i];o[i]=v/chs.length}
      dec=out;
    }
    if(Math.abs(dec.sampleRate-SR)>1){const off=new AC(1,Math.max(1,Math.ceil(dec.duration*SR)),SR),src=off.createBufferSource();src.buffer=dec;src.connect(off.destination);src.start();dec=await off.startRendering()}
    return dec;
  }
  function busy(on,text){busyFlag=on;E.aebusy.hidden=!on;if(text)E.aebusytext.textContent=text;ui()}
  function say(t){E.aestatus.textContent=t}
  async function load(blob){
    reset();box.hidden=false;const my=++token;failed=false;busy(true,"Preparing the editor…");
    try{
      const buf=await decodeBlob(blob);if(my!==token)return;
      sources=[];const si=addSource(buf);segs=[{s:si,a:0,b:buf.length,g:1}];origSig=sig();renderedSig=origSig;blobCurrent=blob;
      undoS=[];redoS=[];sel=null;head=0;ver++;fit();
    }catch(e){
      if(my!==token)return;failed=true;segs=[];blobCurrent=blob;
      say("This audio couldn’t be opened for editing ("+(e&&e.message||"unsupported format")+"). It will be published exactly as it is.");
      opts.notify&&opts.notify("Couldn’t open the audio for editing: "+(e&&e.message||"unsupported format"),"error");
    }finally{if(my===token)busy(false)}
    if(my===token){refreshStatus();redraw()}
  }
  function reset(){
    token++;stopPlay();if(recCtl){try{recCtl.cancel()}catch(e){}recCtl=null;recMode=null;clearInterval(recTimer);E.aerecbar.hidden=true}
    sources=[];segs=[];origSig=renderedSig="";blobCurrent=null;clipSegs=null;sel=null;head=0;undoS=[];redoS=[];failed=false;miniCache=null;ver++;
    box.hidden=true;E.aeparams.hidden=true;E.aebusy.hidden=true;busyFlag=false;ui();
  }

  /* ---------- view ---------- */
  const dur=()=>total()/SR,vis=()=>(cv.clientWidth||600)/pps;
  function clampScroll(){scroll=clamp(scroll,0,Math.max(0,dur()-vis()))}
  function fit(){const W=cv.clientWidth||600;pps=Math.max(.5,W/Math.max(.5,dur()));scroll=0;queueDraw()}
  function zoomAt(factor,x){const W=cv.clientWidth||600,minPps=Math.max(.5,W/Math.max(.5,dur())),tA=scroll+x/pps;pps=clamp(pps*factor,minPps,3000);scroll=tA-x/pps;clampScroll();queueDraw()}
  function zoomSel(){if(!sel){fit();return}const W=cv.clientWidth||600,len=(sel.b-sel.a)/SR;pps=clamp(W/(len*1.3),.5,3000);scroll=sel.a/SR-len*.15;clampScroll();queueDraw()}
  const xToSample=x=>clamp(Math.round((scroll+x/pps)*SR),0,total());
  const sampleToX=s=>(s/SR-scroll)*pps;
  function follow(){const t=head/SR,v=vis();if(t<scroll||t>scroll+v*.92){scroll=t-v*.1;clampScroll()}}
  function queueDraw(){if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;draw()})}
  const redraw=queueDraw;
  function fitCanvas(c){const r=c.getBoundingClientRect(),d=window.devicePixelRatio||1,w=Math.round(r.width*d),h=Math.round(r.height*d);if(c.width!==w||c.height!==h){c.width=w;c.height=h}const g=c.getContext("2d");g.setTransform(d,0,0,d,0,0);return{g,W:r.width,H:r.height}}
  function colPeaks(t0,t1,n){ // loudest sample per column between t0 and t1 seconds
    const out=new Float32Array(n),s0=t0*SR,s1=t1*SR,per=(s1-s0)/n;let pos=0;
    for(const s of segs){
      const len=s.b-s.a,end=pos+len;
      if(end>s0&&pos<s1&&s.s>=0){
        const pk=sources[s.s].peaks,g=s.g||1,from=Math.max(0,s0-pos),to=Math.min(len,s1-pos);
        for(let k=Math.floor((s.a+from)/BLOCK),k1=Math.floor((s.a+to-1)/BLOCK);k<=k1;k++){
          const ts=pos+(Math.max(s.a,k*BLOCK)-s.a),te=pos+(Math.min(s.b,(k+1)*BLOCK)-s.a),v=pk[k]*g;
          const x0=Math.max(0,Math.floor((ts-s0)/per)),x1=Math.min(n-1,Math.floor((te-1-s0)/per));
          for(let x=x0;x<=x1;x++)if(v>out[x])out[x]=v;
        }
      }
      pos=end;if(pos>=s1)break;
    }
    return out;
  }
  const amp=v=>Math.min(1,Math.pow(v,.55)*1.25);
  function draw(){if(box.hidden)return;drawMain();drawMini();updateClock()}
  function drawMain(){
    const {g,W,H}=fitCanvas(cv);g.clearRect(0,0,W,H);
    const RULER=22,mid=RULER+(H-RULER)/2,room=(H-RULER)/2-6;
    g.font="10px 'Space Grotesk',sans-serif";g.textBaseline="top";
    if(!segs.length){g.fillStyle="rgba(241,231,211,.55)";g.textAlign="center";g.fillText(failed?"Editing isn’t available for this file.":"Loading…",W/2,mid-6);g.textAlign="left";return}
    clampScroll();const t0=scroll,t1=scroll+W/pps,D=dur();
    g.strokeStyle="rgba(241,231,211,.08)";g.beginPath();g.moveTo(0,mid);g.lineTo(W,mid);g.stroke();
    // ruler
    const steps=[.05,.1,.2,.5,1,2,5,10,15,30,60,120,300,600,1200],step=steps.find(s=>s*pps>=80)||1200;
    g.fillStyle="rgba(241,231,211,.5)";g.strokeStyle="rgba(241,231,211,.18)";
    for(let t=Math.ceil(t0/step)*step;t<=t1;t+=step){const x=Math.round((t-t0)*pps)+.5;g.beginPath();g.moveTo(x,RULER-6);g.lineTo(x,RULER);g.stroke();g.fillText(clock(t,step<1),x+3,3)}
    // waveform
    const bw=3,nb=Math.ceil(W/bw),pk=colPeaks(t0,t1,nb);
    for(let i=0;i<nb;i++){
      const x=i*bw,t=t0+(i+.5)*bw/pps;if(t>D)break;
      const h=Math.max(1.5,amp(pk[i])*room*2);
      const inSel=sel&&x+bw>sampleToX(sel.a)&&x<sampleToX(sel.b),played=play&&t*SR<head;
      g.fillStyle=inSel?"#ffe08a":played?"#e0b04a":"rgba(241,231,211,.62)";g.fillRect(x,mid-h/2,bw-1,h);
    }
    // end of audio
    const ex=sampleToX(total());if(ex<W){g.fillStyle="rgba(0,0,0,.35)";g.fillRect(Math.max(0,ex),RULER,W,H);g.fillStyle="rgba(241,231,211,.35)";g.fillRect(ex,RULER,1,H)}
    // selection
    if(sel){const ax=sampleToX(sel.a),bx=sampleToX(sel.b);g.fillStyle="rgba(224,176,74,.16)";g.fillRect(ax,RULER,bx-ax,H-RULER);g.fillStyle="#e0b04a";g.fillRect(ax-1,RULER,2,H-RULER);g.fillRect(bx-1,RULER,2,H-RULER);g.fillRect(ax-4,RULER,8,10);g.fillRect(bx-4,RULER,8,10)}
    // playhead
    const hx=sampleToX(head);if(hx>=-2&&hx<=W+2){g.fillStyle="#ff453a";g.fillRect(hx-1,RULER-2,2,H-RULER+2);g.beginPath();g.moveTo(hx-5,RULER-2);g.lineTo(hx+5,RULER-2);g.lineTo(hx,RULER+6);g.fill()}
  }
  function drawMini(){
    const {g,W,H}=fitCanvas(mini);g.clearRect(0,0,W,H);if(!segs.length)return;
    if(!miniCache||miniCache.ver!==ver||miniCache.W!==Math.round(W))miniCache={ver,W:Math.round(W),pk:colPeaks(0,dur(),Math.max(1,Math.round(W/2)))};
    const D=dur(),n=miniCache.pk.length;
    for(let i=0;i<n;i++){const h=Math.max(1,amp(miniCache.pk[i])*(H-6));g.fillStyle="rgba(241,231,211,.45)";g.fillRect(i*2,(H-h)/2,1.5,h)}
    if(sel){g.fillStyle="rgba(224,176,74,.4)";g.fillRect(sel.a/SR/D*W,0,Math.max(2,(sel.b-sel.a)/SR/D*W),H)}
    const v0=scroll/D*W,vw=Math.min(W,vis()/D*W);g.strokeStyle="#e0b04a";g.lineWidth=1.5;g.strokeRect(v0+.5,.5,Math.max(4,vw)-1,H-1);g.lineWidth=1;
    g.fillStyle="#ff453a";g.fillRect(head/SR/D*W-1,0,2,H);
  }
  function updateClock(){
    E.hptime.textContent=clock(head/SR,true);E.sttotal.textContent=segs.length?"/ "+clock(dur(),true):"";
    E.aesel.textContent=sel?clock(sel.a/SR,true)+" – "+clock(sel.b/SR,true)+"  ("+((sel.b-sel.a)/SR).toFixed(1)+" s)":"No selection";
  }

  /* ---------- playback (straight from the edit list, no rendering) ---------- */
  function stopPlay(){
    if(!play)return;cancelAnimationFrame(play.raf);
    play.nodes.forEach(n=>{try{n.onended=null;n.stop()}catch(e){}});try{play.ctx.close()}catch(e){}
    play=null;ui();
  }
  function startPlay(ranges,endHead){
    stopPlay();if(!ready())return;
    const AC=window.AudioContext||window.webkitAudioContext,ctx=new AC(),nodes=[],t=ctx.currentTime+.06;
    let off=0;
    for(const [from,to] of ranges){
      let pos=0;
      for(const s of segs){
        const len=s.b-s.a,sa=Math.max(from,pos),sb=Math.min(to,pos+len);
        if(sb>sa&&s.s>=0){
          const n=ctx.createBufferSource();n.buffer=sources[s.s].buf;
          if(s.g&&s.g!==1){const gn=ctx.createGain();gn.gain.value=s.g;n.connect(gn);gn.connect(ctx.destination)}else n.connect(ctx.destination);
          n.start(t+off+(sa-from)/SR,(s.a+(sa-pos))/SR,(sb-sa)/SR);nodes.push(n);
        }
        pos+=len;if(pos>=to)break;
      }
      off+=(to-from)/SR;
    }
    play={ctx,nodes,ranges,t0:t,endHead,raf:0};ui();
    const loop=()=>{
      if(!play)return;
      let rem=Math.max(0,play.ctx.currentTime-play.t0),pos=null;
      for(const [f,to] of play.ranges){const len=(to-f)/SR;if(rem<=len){pos=f+rem*SR;break}rem-=len}
      if(pos===null){const end=play.endHead;stopPlay();head=end;follow();ui();draw();return}
      head=Math.round(pos);follow();draw();play.raf=requestAnimationFrame(loop);
    };
    play.raf=requestAnimationFrame(loop);
  }
  function togglePlay(){
    if(!ready()||recCtl)return;
    if(play){stopPlay();return}
    const T=total();if(head>=T-SR*.05)head=0;
    startPlay([[head,T]],T);
  }
  function playSelection(){if(sel&&ready()&&!recCtl){startPlay([[sel.a,sel.b]],sel.b)}}
  function previewCut(){
    if(!sel||!ready()||recCtl)return;const lead=Math.round(1.5*SR),T=total(),a=sel.a,b=sel.b;
    const r=[];if(a>0)r.push([Math.max(0,a-lead),a]);if(b<T)r.push([b,Math.min(T,b+lead)]);
    if(r.length)startPlay(r,a);
  }

  /* ---------- edits ---------- */
  function commit(fn,message){
    remember();fn();compact();ver++;miniCache=null;
    const T=total();if(sel&&(sel.b>T||sel.a>=T))sel=null;head=clamp(head,0,T);
    clampScroll();refreshStatus(typeof message==="function"?message():message);ui();draw();opts.onChange&&opts.onChange();
  }
  function refreshStatus(message){
    if(failed)return;
    const changed=sig()!==origSig;
    say((message?message+" ":"")+(changed?"Edited: "+clock(dur())+" long. Edits are rendered when you publish or save a draft.":"Drag to select, click to move the playhead, Space plays, Delete removes the selection, Ctrl+Z undoes."));
  }
  const need=()=>ready()&&!recCtl;
  function doDelete(){
    if(!sel||!need())return;const a=sel.a,b=sel.b;
    if(b-a>=total()){opts.notify&&opts.notify("You can’t delete everything. Use Discard & re-record instead.","error");return}
    stopPlay();commit(()=>{removeRange(a,b);sel=null;head=a;emit({type:"delete",at:a/SR,len:(b-a)/SR})},"Deleted "+((b-a)/SR).toFixed(1)+" s.");
  }
  function doCopy(){if(!sel||!need())return;clipSegs=extract(sel.a,sel.b);ui();say("Copied "+((sel.b-sel.a)/SR).toFixed(1)+" s. Move the playhead and press Paste.")}
  function doCut(){if(!sel||!need())return;clipSegs=extract(sel.a,sel.b);doDelete()}
  function insertAt(list,message){ // replaces the selection if there is one, otherwise inserts at the playhead
    const n=list.reduce((t,s)=>t+(s.b-s.a),0);
    commit(()=>{
      let at=head;
      if(sel){const a=sel.a,b=sel.b;removeRange(a,b);emit({type:"delete",at:a/SR,len:(b-a)/SR});at=a}
      insertSegs(at,list);emit({type:"insert",at:at/SR,len:n/SR});sel={a:at,b:at+n};head=at+n;
    },message);
  }
  function doPaste(){if(!clipSegs||!need())return;stopPlay();insertAt(clipSegs,"Pasted "+(clipSegs.reduce((t,s)=>t+(s.b-s.a),0)/SR).toFixed(1)+" s.")}
  function doTrim(){
    if(!sel||!need())return;const a=sel.a,b=sel.b,T=total();stopPlay();
    commit(()=>{if(b<T){removeRange(b,T);emit({type:"delete",at:b/SR,len:(T-b)/SR})}if(a>0){removeRange(0,a);emit({type:"delete",at:0,len:a/SR})}sel=null;head=0},"Kept only the selection.");
  }
  function doMute(){if(!sel||!need())return;const a=sel.a,b=sel.b;commit(()=>{removeRange(a,b);insertSegs(a,[{s:-1,a:0,b:b-a}])},"Muted the selection.")}
  function doFade(kind){
    if(!sel||!need())return;const a=sel.a,b=sel.b;
    commit(()=>processRange(a,b,(o,n)=>{for(let i=0;i<n;i++)o[i]*=kind==="in"?i/n:1-i/n}),kind==="in"?"Faded in.":"Faded out.");
  }
  function applyGain(a,b,mult){const i=splitAt(a),j=splitAt(b);for(let k=i;k<j;k++)if(segs[k].s>=0)segs[k].g=(segs[k].g||1)*mult}
  function doNormalize(){
    if(!need())return;const a=sel?sel.a:0,b=sel?sel.b:total(),pk=peakOf(a,b);
    if(pk<.001){opts.notify&&opts.notify("That part is silent, so there’s nothing to normalize.","error");return}
    const mult=.89/pk;
    if(Math.abs(mult-1)<.02){say("That’s already at a good level.");return}
    commit(()=>applyGain(a,b,mult),"Normalized "+(sel?"the selection":"everything")+" ("+(20*Math.log10(mult)).toFixed(1)+" dB).");
  }

  /* ---------- small parameter bar (replaces browser prompts) ---------- */
  function ask(title,fields,okLabel,onOk){
    const bar=E.aeparams;bar.replaceChildren();bar.hidden=false;
    const t=document.createElement("b");t.textContent=title;bar.append(t);
    const inputs=fields.map(f=>{const l=document.createElement("label"),i=document.createElement("input");i.type="number";i.value=f.value;i.min=f.min;i.max=f.max;i.step=f.step;
      l.append(f.label+" ",i);if(f.suffix){const s=document.createElement("span");s.textContent=" "+f.suffix;l.append(s)}bar.append(l);return i});
    const ok=document.createElement("button"),no=document.createElement("button");ok.type=no.type="button";ok.className="go";ok.textContent=okLabel;no.textContent="Cancel";
    const close=()=>{bar.hidden=true;bar.replaceChildren()};
    ok.onclick=()=>{const v=inputs.map(i=>Number(i.value));close();onOk(...v)};no.onclick=close;bar.append(ok,no);
    inputs[0]&&inputs[0].focus();inputs.forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter")ok.click();if(e.key==="Escape")no.click()}));
  }
  function askSilence(){if(!need())return;ask("Add silence at the playhead",[{label:"Length",value:1,min:.1,max:60,step:.1,suffix:"seconds"}],"Add",s=>{
    const n=Math.round(clamp(s,.1,60)*SR);stopPlay();commit(()=>{insertSegs(head,[{s:-1,a:0,b:n}]);emit({type:"insert",at:head/SR,len:n/SR});head+=n},"Added "+s+" s of silence.")})}
  function askGain(){if(!need())return;ask("Change volume of "+(sel?"the selection":"everything"),[{label:"Change by",value:3,min:-30,max:30,step:.5,suffix:"dB"}],"Apply",db=>{
    if(!db)return;const a=sel?sel.a:0,b=sel?sel.b:total();commit(()=>applyGain(a,b,Math.pow(10,db/20)),"Changed the volume by "+db+" dB.")})}
  function askPauses(){if(!need())return;ask("Tighten long pauses"+(sel?" in the selection":""),[
    {label:"Quieter than",value:-45,min:-70,max:-20,step:1,suffix:"dB"},{label:"and longer than",value:.8,min:.2,max:10,step:.1,suffix:"s"},{label:"shorten to",value:.35,min:0,max:3,step:.05,suffix:"s"}],"Tighten",(db,longer,keepS)=>{
      const thr=Math.pow(10,db/20),min=Math.round(longer*SR),keep=Math.round(Math.min(keepS,longer)*SR),lo=sel?sel.a:0,hi=sel?sel.b:total();
      const runs=findPauses(thr,min).map(r=>({a:Math.max(r.a,lo),b:Math.min(r.b,hi)})).filter(r=>r.b-r.a>=min).reverse();
      let removed=0,count=0;
      if(!runs.length){say("No pauses that long were found. Try a higher noise level (for example -40 dB) or a shorter pause.");return}
      stopPlay();
      commit(()=>{for(const r of runs){const a=r.a+Math.floor(keep/2),b=r.b-Math.ceil(keep/2);if(b-a<SR*.05)continue;removeRange(a,b);emit({type:"delete",at:a/SR,len:(b-a)/SR});removed+=b-a;count++}sel=null;head=Math.min(head,total())},
        ()=>"Tightened "+count+" pause"+(count===1?"":"s")+", removing "+(removed/SR).toFixed(1)+" s.");
    })}

  /* ---------- undo / redo ---------- */
  function restore(sn){segs=sn.segs;sel=sn.sel;head=sn.head;if(sn.chapters!=null&&opts.setChapters)opts.setChapters(sn.chapters);ver++;miniCache=null;clampScroll();refreshStatus();ui();draw();opts.onChange&&opts.onChange()}
  function undo(){if(!undoS.length||!need())return;stopPlay();redoS.push(snapshot());restore(undoS.pop())}
  function redo(){if(!redoS.length||!need())return;stopPlay();undoS.push(snapshot());restore(redoS.pop())}
  async function revert(){
    if(!need()||sig()===origSig)return;
    const yes=opts.confirm?await opts.confirm("Undo every edit and go back to the original recording?","Revert all"):window.confirm("Revert all edits?");
    if(!yes)return;stopPlay();remember();segs=JSON.parse(origSig);sel=null;head=0;ver++;miniCache=null;fit();refreshStatus("Reverted.");ui();draw();opts.onChange&&opts.onChange();
  }

  /* ---------- recording and files ---------- */
  async function takeToSource(blob,label){
    busy(true,"Processing "+label+"…");
    try{const buf=await decodeBlob(blob);if(buf.length<SR*.15)throw new Error("that was too short to use");return addSource(buf)}
    finally{busy(false)}
  }
  async function startClip(mode){
    if(!need()||(mode==="replace"&&!sel))return;
    stopPlay();const point=mode==="replace"?sel.a:head,endPoint=mode==="replace"?sel.b:head;
    if(E.aepre.checked&&point>SR*.2){
      await new Promise(res=>{startPlay([[Math.max(0,point-2*SR),point]],point);const w=setInterval(()=>{if(!play){clearInterval(w);res()}},50)});
    }
    try{recCtl=await opts.recordClip()}catch(e){recCtl=null;opts.notify&&opts.notify("Couldn’t start recording: "+(e&&e.message||e),"error");return}
    recMode={mode,a:point,b:endPoint};E.aerecbar.hidden=false;
    E.aerectext.textContent=mode==="replace"?"Recording the replacement…":"Recording at the playhead…";
    const started=performance.now();recTimer=setInterval(()=>{E.aerectime.textContent=clock((performance.now()-started)/1000,true)},100);ui();
  }
  async function finishClip(){
    const ctl=recCtl,rm=recMode;if(!ctl)return;recCtl=null;recMode=null;clearInterval(recTimer);E.aerecbar.hidden=true;ui();
    let si;
    try{const blob=await ctl.stop();si=await takeToSource(blob,"your new take")}catch(e){opts.notify&&opts.notify("That take couldn’t be used: "+(e&&e.message||e),"error");return}
    const n=sources[si].data.length;stopPlay();
    commit(()=>{
      if(rm.mode==="replace"){removeRange(rm.a,rm.b);emit({type:"delete",at:rm.a/SR,len:(rm.b-rm.a)/SR})}
      insertSegs(rm.a,[{s:si,a:0,b:n,g:1}]);emit({type:"insert",at:rm.a/SR,len:n/SR});sel={a:rm.a,b:rm.a+n};head=rm.a;
    },rm.mode==="replace"?"Replaced the selection with your new take.":"Inserted your new take.");
    E.hptime.textContent=clock(head/SR,true);
  }
  function cancelClip(){if(recCtl){try{recCtl.cancel()}catch(e){}}recCtl=null;recMode=null;clearInterval(recTimer);E.aerecbar.hidden=true;ui()}
  async function fromFile(file,mode){
    if(!file||!need())return;
    try{const si=await takeToSource(file,"“"+file.name+"”");const n=sources[si].data.length;stopPlay();
      if(mode==="insert"&&sel)sel=null;
      insertAt([{s:si,a:0,b:n,g:1}],mode==="replace"?"Replaced the selection with “"+file.name+"”.":"Inserted “"+file.name+"”.")}
    catch(e){opts.notify&&opts.notify("Couldn’t use that file: "+(e&&e.message||e),"error")}
  }

  /* ---------- rendering to MP3 ---------- */
  let lameLoad=null;
  const loadLame=()=>window.lamejs?Promise.resolve():(lameLoad||(lameLoad=new Promise((res,rej)=>{
    const s=document.createElement("script");s.src=opts.lameUrl||"/host/vendor/lame.min.js";
    s.onload=()=>window.lamejs?res():rej(new Error("the MP3 encoder didn’t start"));s.onerror=()=>{lameLoad=null;rej(new Error("couldn’t load the MP3 encoder"))};document.head.append(s)})));
  async function renderMp3(onProgress){
    await loadLame();
    const enc=new window.lamejs.Mp3Encoder(1,SR,opts.kbps||64),parts=[],T=total(),FRAME=1152*10,pcm=new Int16Array(FRAME);
    let fill=0,done=0,last=performance.now();
    const push=n=>{const out=enc.encodeBuffer(n===FRAME?pcm:pcm.subarray(0,n));if(out&&out.length)parts.push(new Uint8Array(out.buffer,out.byteOffset,out.length).slice())};
    for(const s of segs){
      const d=s.s>=0?sources[s.s].data:null,g=s.g||1;
      for(let i=s.a;i<s.b;i++){
        let v=d?d[i]*g:0;v=v<-1?-1:v>1?1:v;pcm[fill++]=v<0?v*32768:v*32767;done++;
        if(fill===FRAME){push(FRAME);fill=0;if(performance.now()-last>14){await sleep(0);last=performance.now();onProgress&&onProgress(done/T)}}
      }
    }
    if(fill)push(fill);
    const tail=enc.flush();if(tail&&tail.length)parts.push(new Uint8Array(tail.buffer,tail.byteOffset,tail.length).slice());
    return new Blob(parts,{type:"audio/mpeg"});
  }
  async function apply(onProgress){
    if(!segs.length||failed)return blobCurrent;
    const s=sig();if(s===renderedSig)return blobCurrent;
    stopPlay();busy(true,"Rendering your edits…");
    try{const out=await renderMp3(p=>{if(onProgress)onProgress(p);E.aebusytext.textContent="Rendering your edits… "+Math.round(p*100)+"%"});blobCurrent=out;renderedSig=s;return out}
    finally{busy(false);ui()}
  }

  /* ---------- UI state ---------- */
  function ui(){
    const r=ready(),rec=!!recCtl,can=r&&!rec,hasSel=can&&!!sel;
    box.classList.toggle("recording",rec);
    E.aeplay.disabled=!can;E.aeplay.classList.toggle("playing",!!play);
    E.aeplaysel.disabled=E.aepreview.disabled=!hasSel;
    [E.aedelete,E.aecut,E.aecopy,E.aetrim,E.aesilence,E.aefadein,E.aefadeout,E.aerecsel].forEach(b=>b.disabled=!hasSel);
    E.aepaste.disabled=!(can&&clipSegs);
    [E.aeinsil,E.aegain,E.aenorm,E.aepauses,E.aerec,E.aezin,E.aezout,E.aezfit].forEach(b=>b.disabled=!can);
    E.aefile.disabled=!can;E.aefilesel.disabled=!hasSel;E.aefilesellab.classList.toggle("disabled",!hasSel);
    E.aeundo.disabled=!can||!undoS.length;E.aeredo.disabled=!can||!redoS.length;E.aerevert.disabled=!can||sig()===origSig;
    E.aeapply.disabled=!can||sig()===renderedSig;
    updateClock();
  }

  /* ---------- wiring ---------- */
  E.aeplay.onclick=togglePlay;E.aeplaysel.onclick=playSelection;E.aepreview.onclick=previewCut;
  E.aedelete.onclick=doDelete;E.aecut.onclick=doCut;E.aecopy.onclick=doCopy;E.aepaste.onclick=doPaste;E.aetrim.onclick=doTrim;
  E.aesilence.onclick=doMute;E.aeinsil.onclick=askSilence;E.aefadein.onclick=()=>doFade("in");E.aefadeout.onclick=()=>doFade("out");
  E.aegain.onclick=askGain;E.aenorm.onclick=doNormalize;E.aepauses.onclick=askPauses;
  E.aeundo.onclick=undo;E.aeredo.onclick=redo;E.aerevert.onclick=revert;
  E.aerec.onclick=()=>startClip("insert");E.aerecsel.onclick=()=>startClip("replace");E.aerecstop.onclick=finishClip;E.aereccancel.onclick=cancelClip;
  E.aefile.onchange=e=>{const f=e.target.files[0];e.target.value="";fromFile(f,"insert")};
  E.aefilesel.onchange=e=>{const f=e.target.files[0];e.target.value="";fromFile(f,"replace")};
  E.aezin.onclick=()=>zoomAt(1.6,(cv.clientWidth||600)/2);E.aezout.onclick=()=>zoomAt(1/1.6,(cv.clientWidth||600)/2);E.aezfit.onclick=()=>{sel?zoomSel():fit()};
  E.aeapply.onclick=async()=>{try{const b=await apply();opts.notify&&opts.notify("Edits rendered ("+(b.size/1048576).toFixed(1)+" MB).","success");opts.onRendered&&opts.onRendered(b)}catch(e){opts.notify&&opts.notify("Couldn’t render the edits: "+(e&&e.message||e),"error")}};
  box.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest("button");if(b&&!b.closest(".ae-params"))b.blur()});

  cv.addEventListener("pointerdown",e=>{
    if(!segs.length||busyFlag||recCtl)return;
    cv.setPointerCapture(e.pointerId);cv.focus({preventScroll:true});
    const x=e.offsetX,s=xToSample(x);
    if(sel){const ax=sampleToX(sel.a),bx=sampleToX(sel.b);
      if(Math.abs(x-ax)<=7){drag={mode:"edge",fixed:sel.b};return}
      if(Math.abs(x-bx)<=7){drag={mode:"edge",fixed:sel.a};return}}
    if(e.shiftKey){const anchor=sel?(Math.abs(s-sel.a)<Math.abs(s-sel.b)?sel.b:sel.a):head;setSel(anchor,s);drag={mode:"edge",fixed:anchor};ui();draw();return}
    drag={mode:"new",anchor:s,startX:x,moved:false,wasPlaying:!!play};
  });
  cv.addEventListener("pointermove",e=>{
    const x=e.offsetX;
    if(!drag){cv.style.cursor=sel&&(Math.abs(x-sampleToX(sel.a))<=7||Math.abs(x-sampleToX(sel.b))<=7)?"ew-resize":"text";return}
    if(drag.mode==="new"){if(!drag.moved&&Math.abs(x-drag.startX)<4)return;drag.moved=true}
    const W=cv.clientWidth,v=vis();if(x<24)scroll-=v*.03;else if(x>W-24)scroll+=v*.03;clampScroll();
    setSel(drag.mode==="edge"?drag.fixed:drag.anchor,xToSample(x));ui();draw();
  });
  const endDrag=()=>{
    if(!drag)return;const d=drag;drag=null;
    if(d.mode==="new"&&!d.moved){head=d.anchor;sel=null;if(d.wasPlaying)startPlay([[head,total()]],total());ui();draw()}
  };
  cv.addEventListener("pointerup",endDrag);cv.addEventListener("pointercancel",endDrag);
  cv.addEventListener("wheel",e=>{
    if(!segs.length)return;
    if(e.ctrlKey||e.metaKey){e.preventDefault();zoomAt(e.deltaY<0?1.25:.8,e.offsetX)}
    else if(Math.abs(e.deltaX)>Math.abs(e.deltaY)){e.preventDefault();scroll+=e.deltaX/pps;clampScroll();draw()}
  },{passive:false});
  function setSel(a,b){if(a>b)[a,b]=[b,a];if((b-a)/SR<MIN_SEL){sel=null;return}sel={a,b}}
  const miniSeek=e=>{if(!segs.length)return;const r=mini.getBoundingClientRect(),t=clamp((e.clientX-r.left)/r.width,0,1)*dur();scroll=t-vis()/2;clampScroll();draw()};
  let miniDrag=false;mini.addEventListener("pointerdown",e=>{miniDrag=true;mini.setPointerCapture(e.pointerId);miniSeek(e)});
  mini.addEventListener("pointermove",e=>{if(miniDrag)miniSeek(e)});["pointerup","pointercancel"].forEach(ev=>mini.addEventListener(ev,()=>miniDrag=false));
  new ResizeObserver(()=>{if(!box.hidden){miniCache=null;queueDraw()}}).observe(cv.parentElement);

  document.addEventListener("keydown",e=>{
    if(box.hidden||!segs.length)return;
    const t=e.target;if(t&&t.closest&&t.closest("input,textarea,select"))return;
    const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(mod){
      if(k==="z"){e.preventDefault();e.shiftKey?redo():undo()}else if(k==="y"){e.preventDefault();redo()}
      else if(k==="x"&&sel){e.preventDefault();doCut()}else if(k==="c"&&sel){e.preventDefault();doCopy()}else if(k==="v"&&clipSegs){e.preventDefault();doPaste()}
      else if(k==="a"&&need()){e.preventDefault();setSel(0,total());ui();draw()}
      return;
    }
    if(e.altKey)return;
    if(e.key===" "&&!(t.closest&&t.closest("button,a,summary"))){e.preventDefault();togglePlay()}
    else if(e.key==="Delete"||e.key==="Backspace"){if(sel&&need()){e.preventDefault();doDelete()}}
    else if(e.key==="Escape"){if(!E.aeparams.hidden){E.aeparams.hidden=true;E.aeparams.replaceChildren()}else if(recCtl)cancelClip();else{sel=null;ui();draw()}}
    else if(e.key==="ArrowLeft"||e.key==="ArrowRight"){if(!need())return;e.preventDefault();const was=!!play;stopPlay();head=clamp(head+(e.key==="ArrowRight"?1:-1)*(e.shiftKey?5:.5)*SR,0,total());follow();ui();draw();if(was)startPlay([[head,total()]],total())}
    else if(e.key==="Home"){head=0;scroll=0;ui();draw()}else if(e.key==="End"){head=total();follow();ui();draw()}
    else if(e.key==="+"||e.key==="="){zoomAt(1.6,(cv.clientWidth||600)/2)}else if(e.key==="-"){zoomAt(1/1.6,(cv.clientWidth||600)/2)}else if(e.key==="0"){fit()}
  });
  ui();
  return{load,reset,apply,fit,
    isDirty:()=>segs.length>0&&sig()!==renderedSig,hasAudio:()=>segs.length>0&&!failed,duration:()=>dur(),playhead:()=>head/SR,current:()=>blobCurrent,
    _debug:()=>({segs:JSON.parse(sig()),sources:sources.length,sel,head,pps,scroll,total:total()}),_select:(a,b)=>{setSel(Math.round(a*SR),Math.round(b*SR));ui();draw()},_head:t=>{head=Math.round(t*SR);ui();draw()}};
}
return{create};
})();