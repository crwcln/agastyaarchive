// Visual motion + procedural background jazz (Web Audio, no audio files, nothing to license).
(()=>{
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches,root=document.documentElement;

/* ---------- background ---------- */
const bg=document.createElement("div");bg.className="bg";bg.innerHTML='<div class="blob b1"></div><div class="blob b2"></div>';
document.body.prepend(bg);

/* ---------- scroll reveal ---------- */
if(!reduce&&"IntersectionObserver" in window){
  root.classList.add("fx");
  const io=new IntersectionObserver(es=>es.forEach(en=>{
    if(!en.isIntersecting)return;const el=en.target;io.unobserve(el);el.classList.add("in");
    setTimeout(()=>{el.classList.remove("rv","in");el.style.transitionDelay=""},1300+(+el.dataset.d||0));
  }),{threshold:.1});
  const watch=(el,d=0)=>{if(el.dataset.w)return;el.dataset.w=1;el.dataset.d=d;el.style.transitionDelay=d+"ms";el.classList.add("rv");io.observe(el)};
  document.querySelectorAll(".sec,.chips,.about,footer,.rule").forEach(el=>watch(el));
  const scan=()=>document.querySelectorAll(".ep").forEach((el,i)=>watch(el,Math.min(i,6)*90));
  new MutationObserver(scan).observe(document.getElementById("list"),{childList:true});scan();
}

/* ---------- jazz engine ---------- */
const music=(()=>{
  const BPM=92,spb=60/BPM,vol=.3;
  let ctx,master,wet,nb,timer=null,on=false,nextT=0,n=0,mi=3;const holds=new Set();
  const mtof=m=>440*Math.pow(2,(m-69)/12);
  // Dm9 | G13 | Cmaj9 | A7b13
  const BAR=[
    {bass:[38,41,45,44],chord:[53,57,60,64],mel:[62,65,67,69,72,74,76]},
    {bass:[43,47,50,49],chord:[53,59,64],mel:[67,69,71,72,74,76,77]},
    {bass:[48,52,55,46],chord:[52,55,59,62],mel:[64,67,69,71,72,74,76]},
    {bass:[45,49,52,39],chord:[55,61,65],mel:[69,70,73,75,77,79]}];
  function tone(t,f,dur,o={}){
    const {type="sine",gain=.2,att=.01,lp=2000,out=master}=o;
    const os=ctx.createOscillator(),g=ctx.createGain(),fl=ctx.createBiquadFilter();
    os.type=type;os.frequency.value=f;fl.type="lowpass";fl.frequency.value=lp;
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(gain,t+att);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    os.connect(fl);fl.connect(g);g.connect(out);os.start(t);os.stop(t+dur+.05);
  }
  function noise(t,dur,hp,gain){
    const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();
    s.buffer=nb;f.type="highpass";f.frequency.value=hp;
    g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    s.connect(f);f.connect(g);g.connect(master);s.start(t,Math.random());s.stop(t+dur+.02);
  }
  function beat(t,k){
    const B=BAR[Math.floor(k/4)%4],b=k%4,sw=spb*2/3;
    tone(t,mtof(B.bass[b]),spb*.9,{type:"triangle",gain:.42,att:.012,lp:520});   // walking bass
    tone(t,58,.16,{gain:.1,att:.004,lp:180});                                    // feathered kick
    noise(t,.25,7000,.032);                                                       // ride
    if(b===1||b===3){noise(t+sw,.18,7500,.028);noise(t,.05,3000,.05)}            // swung "and" + hat chick
    if(b===0)B.chord.forEach((m,i)=>tone(t+i*.012,mtof(m),spb*1.7,{type:"triangle",gain:.07,att:.02,lp:1400,out:wet}));
    if(b===1||(b===3&&Math.random()<.4))B.chord.forEach(m=>tone(t+sw,mtof(m),.22,{type:"triangle",gain:.06,att:.01,lp:1600,out:wet}));
    [0,sw].forEach(o=>{if(Math.random()<.34){            // sparse vibes melody
      mi=Math.max(0,Math.min(B.mel.length-1,mi+Math.round((Math.random()-.5)*4)));
      const f=mtof(B.mel[mi]);tone(t+o,f,.9,{gain:.09,att:.008,lp:3500,out:wet});tone(t+o,f*4,.3,{gain:.014,att:.004,out:wet})}});
  }
  const tick=()=>{while(nextT<ctx.currentTime+.25)beat(nextT,n++),nextT+=spb};
  const level=()=>on&&!holds.size?vol:0;
  const sync=()=>{if(master)master.gain.setTargetAtTime(level(),ctx.currentTime,.45)};
  function build(){
    ctx=new (window.AudioContext||window.webkitAudioContext)();
    master=ctx.createGain();master.gain.value=0;
    const comp=ctx.createDynamicsCompressor();master.connect(comp);comp.connect(ctx.destination);
    wet=ctx.createGain();wet.gain.value=.9;const dl=ctx.createDelay(2),fb=ctx.createGain(),dg=ctx.createGain();
    dl.delayTime.value=spb*.75;fb.gain.value=.3;dg.gain.value=.35;
    wet.connect(master);wet.connect(dl);dl.connect(fb);fb.connect(dl);dl.connect(dg);dg.connect(master);
    nb=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  }
  return{
    get on(){return on},
    start(){if(!ctx)build();ctx.resume();on=true;if(!timer){nextT=ctx.currentTime+.1;n=0;timer=setInterval(tick,50)}sync()},
    stop(){on=false;sync();setTimeout(()=>{if(!on&&timer){clearInterval(timer);timer=null}},900)},
    hold(k,v){v?holds.add(k):holds.delete(k);sync()},
    suspend(v){if(ctx&&on)v?ctx.suspend():ctx.resume()}
  };
})();
window.AAmusic=music;

// Browsers require a user gesture before starting audio, so begin on the first tap or keypress.
const first=()=>{
  const p=document.getElementById("hp");if(p&&p.classList.contains("open"))return;
  ["pointerdown","keydown","touchstart"].forEach(v=>removeEventListener(v,first));
  if(!music.on)music.start();
};
["pointerdown","keydown","touchstart"].forEach(v=>addEventListener(v,first,{passive:true}));
document.addEventListener("visibilitychange",()=>music.suspend(document.hidden));
/* ---------- episode playback state (duck jazz while an episode plays) ---------- */
const mark=(e,on)=>{const c=e.target.closest&&e.target.closest(".ep");if(c)c.classList.toggle("playing",on)};
const anyPlaying=()=>[...document.querySelectorAll("audio")].some(a=>!a.paused);
document.addEventListener("play",e=>{
  if(e.target.tagName!=="AUDIO")return;
  document.querySelectorAll("audio").forEach(a=>{if(a!==e.target&&!a.paused)a.pause()});
  mark(e,true);music.hold("audio",true);
},true);
["pause","ended"].forEach(ev=>document.addEventListener(ev,e=>{
  if(e.target.tagName!=="AUDIO")return;mark(e,false);if(!anyPlaying())music.hold("audio",false);
},true));
})();
