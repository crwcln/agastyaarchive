// Text to speech: reads scripts, notes, descriptions and ideas aloud with the browser's built-in voices.
// (Browsers can speak text but can't export that speech as an audio file, so this is for rehearsal and proofreading.)
window.TTS=(()=>{
const synth=window.speechSynthesis,ok=!!synth&&typeof SpeechSynthesisUtterance!=="undefined";
const store=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}};
let stopCurrent=null;

function chunks(text){ // sentence-sized pieces keep long scripts from stalling in Chrome
  const out=[];
  String(text).split(/\n+/).forEach(par=>{
    (par.replace(/\s+/g," ").trim().match(/[^.!?…]+[.!?…]*["')\]]*|[^.!?…]+$/g)||[]).forEach(raw=>{
      let s=raw.trim();
      while(s.length>220){let cut=s.lastIndexOf(",",220);if(cut<80)cut=s.lastIndexOf(" ",220);if(cut<1)cut=220;out.push(s.slice(0,cut+1).trim());s=s.slice(cut+1).trim()}
      if(s)out.push(s);
    });
  });
  return out;
}
const voices=()=>synth.getVoices().slice().sort((a,b)=>(/^en/i.test(b.lang)-/^en/i.test(a.lang))||(b.localService-a.localService)||a.name.localeCompare(b.name));
const words=t=>(String(t).trim().match(/\S+/g)||[]).length;
const mmss=s=>Math.floor(s/60)+":"+String(Math.round(s%60)).padStart(2,"0");

function speak(text,o){
  const list=chunks(text),voice=o.voiceURI?synth.getVoices().find(v=>v.voiceURI===o.voiceURI):null;
  let i=0,stopped=false;
  const next=()=>{
    if(stopped)return;
    if(i>=list.length){o.onDone&&o.onDone(null);return}
    const idx=i,u=new SpeechSynthesisUtterance(list[idx]);if(voice)u.voice=voice;u.rate=o.rate||1;
    u.onstart=()=>o.onSentence&&o.onSentence(list[idx]);
    u.onboundary=e=>{if(o.onWord&&e.name!=="sentence")o.onWord(list[idx],e.charIndex,e.charLength)};
    u.onend=()=>{i++;next()};
    u.onerror=e=>{if(e.error==="interrupted"||e.error==="canceled")return;stopped=true;o.onDone&&o.onDone(e.error||"error")};
    synth.speak(u);
  };
  synth.cancel();next();
  return{pause:()=>synth.pause(),resume:()=>synth.resume(),stop:()=>{if(stopped)return;stopped=true;synth.cancel();o.onDone&&o.onDone(null)}};
}

function mount(box,sources){
  box.classList.add("tts");
  if(!ok){box.innerHTML='<p class="fine">Read aloud isn’t supported in this browser.</p>';return}
  box.innerHTML=`<div class="tts-row"><select class="tts-src" aria-label="What to read"></select><button type="button" class="tts-play go">🔊 Read aloud</button><button type="button" class="tts-pause" disabled>Pause</button><button type="button" class="tts-stop" disabled>Stop</button></div>
<div class="tts-row"><select class="tts-voice" aria-label="Voice"></select><label class="tts-rate">Speed <input type="range" min="0.6" max="1.6" step="0.05"> <output></output></label></div>
<div class="tts-est fine"></div><div class="tts-now" aria-live="polite" hidden></div>`;
  const q=s=>box.querySelector(s),src=q(".tts-src"),play=q(".tts-play"),pause=q(".tts-pause"),stop=q(".tts-stop"),vsel=q(".tts-voice"),rate=q(".tts-rate input"),rout=q(".tts-rate output"),est=q(".tts-est"),now=q(".tts-now");
  sources.forEach((s,i)=>src.append(new Option(s.label,i)));src.hidden=sources.length<2;
  rate.value=store("aa_tts_rate")||"1";
  const fillVoices=()=>{const keep=store("aa_tts_voice"),list=voices();vsel.replaceChildren(new Option("Default voice",""),...list.map(v=>new Option(v.name+" ("+v.lang+")",v.voiceURI)));if(keep&&list.some(v=>v.voiceURI===keep))vsel.value=keep};
  fillVoices();synth.addEventListener&&synth.addEventListener("voiceschanged",fillVoices);
  const text=()=>sources[+src.value].get()||"";
  const updateEst=()=>{const r=+rate.value,n=words(text());rout.textContent=r.toFixed(2)+"×";est.textContent=n?n+" words · about "+mmss(n/(165*r)*60)+" read aloud at this speed":"Nothing to read yet."};
  sources.forEach(s=>s.el&&s.el.addEventListener("input",updateEst));
  src.onchange=updateEst;rate.oninput=()=>{store("aa_tts_rate",rate.value);updateEst()};vsel.onchange=()=>store("aa_tts_voice",vsel.value);
  updateEst();

  let ctl=null,paused=false;
  const idle=()=>{ctl=null;paused=false;play.disabled=false;pause.disabled=stop.disabled=true;pause.textContent="Pause";now.hidden=true};
  const show=(sentence,at,len)=>{
    now.hidden=false;now.replaceChildren();
    if(at==null){now.textContent=sentence;return}
    const w=len||((sentence.slice(at).match(/^\S+/)||[""])[0].length),m=document.createElement("mark");m.textContent=sentence.slice(at,at+w);
    now.append(sentence.slice(0,at),m,sentence.slice(at+w));
  };
  const halt=()=>{if(ctl)ctl.stop()};
  play.onclick=()=>{
    const t=text();if(!t.trim()){est.textContent="Nothing to read yet.";return}
    if(stopCurrent)stopCurrent();
    play.disabled=true;pause.disabled=stop.disabled=false;
    ctl=speak(t,{rate:+rate.value,voiceURI:vsel.value,onSentence:s=>show(s),onWord:(s,at,len)=>show(s,at,len),
      onDone:err=>{idle();if(err)est.textContent="The speech engine stopped ("+err+"). Try another voice."}});
    stopCurrent=halt;
  };
  pause.onclick=()=>{if(!ctl)return;if(paused){ctl.resume();paused=false;pause.textContent="Pause"}else{ctl.pause();paused=true;pause.textContent="Resume"}};
  stop.onclick=halt;
}

function quick(text,btn){ // one-tap read for a button elsewhere on the page (e.g. an idea card)
  if(!ok)return;
  const label=btn.textContent;
  if(btn.dataset.speaking){if(stopCurrent)stopCurrent();return}
  if(stopCurrent)stopCurrent();
  btn.dataset.speaking="1";btn.textContent="⏹ Stop";
  const ctl=speak(text,{rate:+(store("aa_tts_rate")||1),voiceURI:store("aa_tts_voice")||"",onDone:()=>{delete btn.dataset.speaking;btn.textContent=label}});
  stopCurrent=()=>ctl.stop();
}
return{supported:ok,mount,quick,stopAll:()=>{if(stopCurrent)stopCurrent()}};
})();