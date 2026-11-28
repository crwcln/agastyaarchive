// Browser captions: the built-in speech recognizer (the same technology behind Chromebook-style Live Caption).
// It runs live while you record, or in real time over audio you already have, so it has no episode-length limit.
// Chrome 139+ can run it fully on-device; older browsers use Google's online speech service instead. Support varies by browser.
window.Captions=(()=>{
const SRC=window.SpeechRecognition||window.webkitSpeechRecognition;
const supported=!!SRC;
// Captioning an existing recording needs the modern API that can listen to an audio track instead of the microphone.
const canCaptionTrack=supported&&typeof SRC.available==="function";
async function deviceStatus(lang){ // "available" | "downloadable" | "downloading" | "unavailable" | null (browser can't say)
  try{if(SRC&&typeof SRC.available==="function")return await SRC.available({langs:[lang||"en-US"],processLocally:true})}catch(e){}
  return null;
}
async function installDevice(lang){try{if(SRC&&typeof SRC.install==="function")return await SRC.install({langs:[lang||"en-US"],processLocally:true})}catch(e){}return false}

function wordsFrom(segments){ // spread each phrase's words across the time the phrase took
  const out=[];
  for(const s of segments){
    const toks=String(s.text||"").trim().split(/\s+/).filter(Boolean);if(!toks.length)continue;
    const weights=toks.map(t=>t.length+2),sum=weights.reduce((a,b)=>a+b,0),span=Math.max(.2*toks.length,s.end-s.start);
    let t=s.start;
    toks.forEach((w,i)=>{const d=span*weights[i]/sum;out.push({word:w,start:+t.toFixed(2),end:+(t+d).toFixed(2)});t+=d});
  }
  return out;
}
const textFrom=segments=>segments.map(s=>s.text).join(" ").replace(/\s+/g," ").trim();

function create(o){
  o=o||{};
  const lang=o.lang||navigator.language||"en-US",clock=o.clock||(()=>0),segs=[],seen=new Map();
  let rec=null,running=false,paused=false,fatal=null,failures=0,gen=0,timer=0,local=false,stopWaiters=[];
  function build(){
    const r=new SRC();r.continuous=true;r.interimResults=true;r.lang=lang;r.maxAlternatives=1;
    local=false;if(o.preferLocal!==false&&"processLocally" in r){try{r.processLocally=true;local=true}catch(e){}}
    r.onresult=e=>{
      failures=0;let interim="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const res=e.results[i],text=(res[0]&&res[0].transcript||"").trim(),key=gen+":"+i;
        if(!seen.has(key))seen.set(key,clock());
        if(res.isFinal){if(text){const end=clock(),start=Math.min(seen.get(key),end),seg={text,start,end};segs.push(seg);o.onSegment&&o.onSegment(seg)}seen.delete(key)}
        else interim+=text+" ";
      }
      o.onInterim&&o.onInterim(interim.trim());
    };
    r.onerror=e=>{
      const err=e&&e.error;if(err==="no-speech"||err==="aborted")return;
      if(err==="not-allowed"||err==="service-not-allowed"||err==="language-not-supported"||err==="audio-capture"){fatal=err}else failures++;
    };
    r.onend=()=>{
      gen++;const w=stopWaiters;stopWaiters=[];w.forEach(f=>f());
      if(!running||paused)return;
      if(fatal||failures>6){running=false;o.onFatal&&o.onFatal(fatal||"network");return}
      timer=setTimeout(begin,failures?Math.min(4000,300*Math.pow(2,failures)):150); // Chrome ends sessions on silence, so keep restarting
    };
    return r;
  }
  function begin(){
    if(!running||paused)return;
    rec=build();
    try{o.track?rec.start(o.track):rec.start()}
    catch(e){failures++;if(failures>6){running=false;o.onFatal&&o.onFatal("start-failed");return}timer=setTimeout(begin,400)}
  }
  return{
    start(){running=true;paused=false;fatal=null;failures=0;begin()},
    pause(){paused=true;clearTimeout(timer);try{rec&&rec.stop()}catch(e){}},
    resume(){if(!running)return;paused=false;failures=0;begin()},
    finish(){ // stop and wait briefly for the last phrase to be finalised
      running=false;clearTimeout(timer);
      return new Promise(res=>{const done=()=>res(segs.slice());if(!rec){done();return}stopWaiters.push(done);setTimeout(done,1500);try{rec.stop()}catch(e){done()}});
    },
    abort(){running=false;clearTimeout(timer);try{rec&&rec.abort()}catch(e){}},
    segments:()=>segs.slice(),isLocal:()=>local,isRunning:()=>running&&!paused
  };
}
return{supported,canCaptionTrack,deviceStatus,installDevice,create,wordsFrom,textFrom};
})();