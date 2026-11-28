// AI cleanup: the AI reads the episode's transcript and suggests cuts (false starts, repeats, tangents, filler).
// You see every suggestion with its time range, can preview it, and apply only the ones you pick, as one undoable step.
window.AIEdit=(()=>{
const byId=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clock=s=>Math.floor(s/60)+":"+String(Math.floor(s%60)).padStart(2,"0");
const KINDS={false_start:"False start",repeat:"Repeated take",tangent:"Tangent",filler:"Filler",other:"Suggested cut"};

function linesFrom(words){ // group timed words into sentence-sized lines the AI can point at
  const out=[];let cur=[];
  const flush=()=>{if(cur.length){out.push({i:out.length,start:cur[0].start,end:cur[cur.length-1].end,text:cur.map(w=>w.word).join(" ")});cur=[]}};
  words.forEach((w,k)=>{
    cur.push(w);const next=words[k+1],gap=next?next.start-w.end:9;
    if((/[.!?…]["')\]]?$/.test(w.word)&&cur.length>=3)||gap>1.1||cur.length>=26)flush();
  });
  flush();return out;
}
function create(o){
  const ed=o.editor,E=Object.fromEntries(["aeai","aeaipanel","aeaiclose","aeaigo","aeaistatus","aeailist","aeaifoot","aeaiapply","aeaisaving","aeaifs","aeaifill","aeaitan","aeaimin","aeaiinstr"].map(i=>[i,byId(i)||document.createElement("div")]));
  let cuts=[],busy=false;
  if(o.enabled===false){E.aeai.hidden=true;return{}}
  const status=t=>E.aeaistatus.textContent=t;
  E.aeai.onclick=()=>{if(!ed.hasAudio()){o.notify&&o.notify("Add some audio first.","error");return}E.aeaipanel.hidden=!E.aeaipanel.hidden;if(E.aeaipanel.hidden)ed.setHighlights([])};
  E.aeaiclose.onclick=()=>{E.aeaipanel.hidden=true;ed.setHighlights([])};

  async function ask(payload,progress){ // start the AI job, then poll it
    const start=await o.api({action:"ai-edit-plan",...payload}),t0=Date.now();
    for(;;){
      await sleep(2200);if(Date.now()-t0>240000)throw new Error("the AI took too long");
      progress(Math.round((Date.now()-t0)/1000));
      const r=await o.api({action:"script-status",id:start.interactionId});
      if(r.error)throw new Error(r.error);if(r.status==="completed")return r.script;
    }
  }
  function parse(text){
    const a=text.indexOf("{"),b=text.lastIndexOf("}");if(a<0||b<=a)throw new Error("the AI’s answer wasn’t in the expected format");
    return JSON.parse(text.slice(a,b+1));
  }
  async function find(){
    if(busy)return;busy=true;E.aeaigo.disabled=true;cuts=[];render();
    try{
      let words=o.getWords();
      if(!words.length){status("Transcribing the audio first…");words=await o.ensureWords(status)}
      const ls=linesFrom(words);if(ls.length<6)throw new Error("there isn’t enough speech to analyse");
      const options={falseStarts:E.aeaifs.checked,filler:E.aeaifill.checked,tangents:E.aeaitan.checked,targetMinutes:+E.aeaimin.value||0,instruction:E.aeaiinstr.value.trim()};
      const text=await ask({lines:ls.map(l=>({i:l.i,t:l.start,text:l.text})),options},s=>status("The AI is reading the transcript… "+s+"s"));
      const parsed=parse(text),found=[];
      for(const c of Array.isArray(parsed.cuts)?parsed.cuts:[]){
        const from=Math.round(+c.from),to=Math.round(+c.to);
        if(!(from>=2&&to<=ls.length-3&&to>=from))continue; // never the first or last two lines
        const a0=ls[from].start,b0=ls[to].end,a=Math.min(ed.snapQuiet(a0,.3),b0-.1),b=Math.max(ed.snapQuiet(b0,.3),a+.1);
        found.push({a,b,kind:KINDS[c.kind]?c.kind:"other",reason:String(c.reason||"").slice(0,140),text:ls.slice(from,to+1).map(l=>l.text).join(" ").slice(0,160),on:true});
      }
      found.sort((x,y)=>x.a-y.a);cuts=found.filter((c,i)=>i===0||c.a>=found[i-1].b); // drop overlaps
      status(cuts.length?cuts.length+" suggested cut"+(cuts.length===1?"":"s")+". Preview them, untick any you don’t want, then apply.":"The AI didn’t find anything worth cutting. That’s a good sign.");
    }catch(e){status("Couldn’t analyse the episode: "+e.message)}
    busy=false;E.aeaigo.disabled=false;render();
  }
  function render(){
    const box=E.aeailist;box.replaceChildren();
    cuts.forEach(c=>{
      const row=document.createElement("div");row.className="ae-ai-item";
      const cb=document.createElement("input");cb.type="checkbox";cb.checked=c.on;cb.setAttribute("aria-label","Apply this cut");cb.onchange=()=>{c.on=cb.checked;render()};
      const info=document.createElement("div"),h=document.createElement("b"),s=document.createElement("span");
      h.textContent=clock(c.a)+" – "+clock(c.b)+" (cuts "+(c.b-c.a).toFixed(1)+" s) · "+KINDS[c.kind];s.textContent=(c.reason?c.reason+": ":"")+"“"+c.text+"”";info.append(h,document.createElement("br"),s);
      const btns=document.createElement("div");btns.className="ae-ai-btns";
      const pv=document.createElement("button"),go=document.createElement("button");pv.type=go.type="button";pv.textContent="Preview";go.textContent="Go to";
      pv.onclick=()=>ed.previewRange(c.a,c.b);go.onclick=()=>ed.goTo(Math.max(0,c.a-1));btns.append(pv,go);row.append(cb,info,btns);box.append(row);
    });
    const on=cuts.filter(c=>c.on),sum=on.reduce((t,c)=>t+(c.b-c.a),0);
    E.aeaifoot.hidden=!cuts.length;E.aeaisaving.textContent=on.length?"Applying "+on.length+" cut"+(on.length===1?"":"s")+" saves "+sum.toFixed(1)+" s ("+clock(sum)+").":"No cuts selected.";E.aeaiapply.disabled=!on.length;
    ed.setHighlights(on);
  }
  E.aeaigo.onclick=find;
  E.aeaiapply.onclick=()=>{
    const on=cuts.filter(c=>c.on);if(!on.length)return;
    const saved=ed.applyCuts(on,"Applied "+on.length+" AI cut"+(on.length===1?"":"s")+".");
    cuts=[];render();status(saved?"Done: removed "+saved.toFixed(1)+" s. Undo brings everything back.":"Nothing was removed.");
  };
  return{find,linesFrom};
}
return{create,linesFrom};
})();