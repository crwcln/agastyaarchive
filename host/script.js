// Script maker: write, rewrite and organise episode scripts. Scripts can be linked to ideas and handed to the Record tab or the live room.
HOST.ready(()=>{
const {api,features:F}=HOST,me=HOST.who(),$=id=>document.getElementById(id);
const h=(t,a,...k)=>{const e=document.createElement(t);for(const x in a||{}){const v=a[x];if(v===false||v==null)continue;if(x==="class")e.className=v;else if(x.startsWith("on"))e[x]=v;else e.setAttribute(x,v===true?"":v)}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const UNITS=["","Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const TONES=["Energetic and conversational","Dryly funny","Dramatic storytelling","Clear and classroom-friendly","Sharp and argumentative"];
UNITS.forEach(u=>$("scUnit").append(new Option(u||"Any unit",u)));TONES.forEach(t=>$("scTone").append(new Option(t,t)));
let list=[],ideas=[],cur=null,history=[],busy=false,saveTimer=0,q="";
const say=t=>$("scMsg").textContent=t,ago=iso=>{const s=Math.max(0,(Date.now()-Date.parse(iso))/1000);return s<60?"just now":s<3600?Math.floor(s/60)+" min ago":s<86400?Math.floor(s/3600)+" h ago":new Date(iso).toLocaleDateString()};
const words=t=>(String(t).match(/\S+/g)||[]).length;

/* ---------- list ---------- */
async function loadAll(){
  const [a,b]=await Promise.all([api({action:"list-scripts"}),api({action:"list-ideas"}).catch(()=>({ideas:[]}))]);
  list=a.scripts;ideas=b.ideas;renderList();fillIdeas();
}
function renderList(){
  const box=$("scList");box.replaceChildren();
  const shown=list.filter(s=>!q||s.title.toLowerCase().includes(q));
  if(!shown.length){box.append(h("div",{class:"mute sc-none"},list.length?"No scripts match.":"No scripts yet."));return}
  shown.forEach(s=>{
    const idea=ideas.find(i=>i.id===s.ideaId);
    box.append(h("button",{type:"button",class:"sc-item"+(cur&&cur.id===s.id?" on":""),onclick:()=>openScript(s.id)},h("b",null,s.title),
      h("span",{class:"fine"},s.words+" words · "+ago(s.updatedAt)+(s.updatedBy?" · "+s.updatedBy.name:"")),idea?h("span",{class:"sc-chip"},"from “"+idea.title.slice(0,32)+(idea.title.length>32?"…":"")+"”"):null));
  });
}
function fillIdeas(){
  const sel=$("scIdea"),keep=cur?cur.ideaId||"":"";sel.replaceChildren(new Option("No linked idea",""));
  ideas.forEach(i=>sel.append(new Option(i.title.slice(0,70)+" ("+i.status+")",i.id)));sel.value=keep;
}

/* ---------- current script ---------- */
function readForm(){
  if(!cur)return null;
  cur.title=$("scTitle").value.trim();cur.ideaId=$("scIdea").value||null;cur.unit=$("scUnit").value;cur.text=$("scText").value;
  cur.brief={minutes:+$("scMinutes").value,tone:$("scTone").value,rant:+$("scRant").value,format:$("scFormat").value,points:$("scPoints").value};
  return cur;
}
function setCurrent(sc){
  cur=sc;history=[];$("scUndo").hidden=true;$("scEmpty").hidden=true;$("scEditor").hidden=false;
  $("scTitle").value=sc.title||"";$("scUnit").value=sc.unit||"";$("scText").value=sc.text||"";
  const b=sc.brief||{};$("scMinutes").value=String(b.minutes||8);$("scTone").value=TONES.includes(b.tone)?b.tone:TONES[0];$("scRant").value=String(b.rant||3);$("scFormat").value=b.format||"monologue";$("scPoints").value=b.points||"";
  fillIdeas();$("scIdea").value=sc.ideaId||"";ideaContext();refreshMeter();say("");$("scSaved").textContent=sc.updatedAt?"Saved "+ago(sc.updatedAt)+(sc.updatedBy?" by "+sc.updatedBy.name:""):"Not saved yet";renderList();
}
function ideaContext(){
  const idea=ideas.find(i=>i.id===$("scIdea").value),box=$("scIdeaBody");$("scIdeaCtx").hidden=!idea;box.replaceChildren();
  if(!idea)return;
  box.append(h("p",null,h("b",null,idea.title)),idea.notes?h("p",{class:"sc-pre"},idea.notes):null,...idea.comments.slice(-8).map(c=>h("p",{class:"fine"},h("b",null,c.author.name+": "),c.text)),h("a",{href:"#ideas"},"Open the Ideas tab"));
}
function refreshMeter(){
  const text=$("scText").value,n=words(text),min=n/135,target=+$("scMinutes").value;
  $("scWords").textContent=n.toLocaleString()+" words";$("scTime").textContent=Math.floor(min)+":"+String(Math.round((min%1)*60)).padStart(2,"0");
  const t=$("scTarget");t.textContent=n?"(target "+target+" min)":"";t.className=n&&Math.abs(min-target)/target>.2?"sc-off":"";
  const ol=$("scOutline");ol.replaceChildren();
  let pos=0;text.split("\n").forEach(line=>{const m=line.match(/^##\s+(.+)/);if(m){const at=pos;ol.append(h("button",{type:"button",onclick:()=>{const ta=$("scText");ta.focus();ta.setSelectionRange(at,at+line.length)}},m[1]))}pos+=line.length+1});
  ol.hidden=!ol.children.length;
}
function pushHistory(){history.push($("scText").value);if(history.length>10)history.shift();$("scUndo").hidden=false}
$("scUndo").onclick=()=>{if(!history.length)return;$("scText").value=history.pop();$("scUndo").hidden=!history.length;refreshMeter();queueSave()};
async function save(quiet){
  if(!readForm())return null;
  clearTimeout(saveTimer);
  const r=await api({action:"save-script",script:{id:cur.id,title:cur.title,ideaId:cur.ideaId,unit:cur.unit,brief:cur.brief,text:cur.text}});
  cur.id=r.script.id;cur.updatedAt=r.script.updatedAt;cur.updatedBy=r.script.updatedBy;
  $("scSaved").textContent="Saved "+ago(cur.updatedAt)+" by "+cur.updatedBy.name;if(!quiet)say("Saved.");
  const i=list.findIndex(s=>s.id===cur.id),row={id:cur.id,title:r.script.title,ideaId:cur.ideaId,unit:cur.unit,words:r.script.words,author:r.script.author,updatedBy:r.script.updatedBy,createdAt:r.script.createdAt,updatedAt:r.script.updatedAt};
  if(i>=0)list.splice(i,1);list.unshift(row);renderList();return r.script;
}
const queueSave=()=>{if(!cur||!cur.id)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(true).catch(()=>{}),2500)};
async function openScript(id){
  try{const r=await api({action:"get-script",id});setCurrent(r.script)}catch(e){say("Couldn’t open that script: "+e.message)}
}
function newScript(seed){
  const idea=seed&&seed.idea;
  setCurrent({id:null,title:idea?idea.title:"",ideaId:idea?idea.id:null,unit:"",text:"",brief:{minutes:8,tone:TONES[0],rant:3,format:"monologue",points:idea?(idea.notes||""):""}});
  if(idea)say("Started from the idea “"+idea.title+"”. Add anything else you want covered, then press Write the script.");
}

/* ---------- AI ---------- */
async function runAI(action,payload,progress){
  const start=await api({action,...payload}),t0=Date.now();
  for(;;){
    await sleep(2200);
    if(Date.now()-t0>240000)throw new Error("the AI took too long. Try again.");
    progress(Math.round((Date.now()-t0)/1000));
    const r=await api({action:"script-status",id:start.interactionId});
    if(r.error)throw new Error(r.error);
    if(r.status==="completed")return r.script;
  }
}
function lock(on,btn){busy=on;[$("scGenerate"),$("scRewrite"),$("scSave"),$("scNew")].forEach(b=>b.disabled=on);if(btn)btn.textContent=btn.dataset.label}
$("scGenerate").onclick=async()=>{
  if(busy||!readForm())return;
  if(!cur.title){$("scGenStatus").textContent="Add a topic or title first.";return}
  if(cur.text.trim()&&!(await HOST.confirm("Replace the current script with a new AI draft? You can undo it afterwards.","Replace script")))return;
  const btn=$("scGenerate");btn.dataset.label=btn.textContent;lock(true);
  try{
    const text=await runAI("script-write",{brief:{...cur.brief,title:cur.title,unit:cur.unit,ideaId:cur.ideaId}},s=>{$("scGenStatus").textContent="Writing the script… "+s+"s"});
    pushHistory();$("scText").value=text;refreshMeter();$("scGenStatus").textContent="Draft ready. Edit it, then save.";await save(true);
  }catch(e){$("scGenStatus").textContent="Couldn’t write the script: "+e.message}
  finally{lock(false,btn)}
};
$("scRewrite").onclick=async()=>{
  if(busy||!cur)return;const ta=$("scText"),a=ta.selectionStart,b=ta.selectionEnd,instruction=$("scInstr").value.trim();
  if(a===b){say("Select the text you want changed first.");return}
  if(!instruction){say("Say how to change it (for example “make it punchier”).");return}
  const btn=$("scRewrite");btn.dataset.label=btn.textContent;lock(true);
  try{
    const out=await runAI("script-rewrite",{text:ta.value.slice(a,b),instruction,context:($("scTitle").value||"")+(($("scUnit").value)?" ("+$("scUnit").value+")":"")},s=>say("Rewriting… "+s+"s"));
    pushHistory();ta.value=ta.value.slice(0,a)+out+ta.value.slice(b);ta.setSelectionRange(a,a+out.length);refreshMeter();say("Rewritten. Use Undo AI change if you prefer the old version.");queueSave();
  }catch(e){say("Couldn’t rewrite that: "+e.message)}
  finally{lock(false,btn)}
};

/* ---------- buttons and handoffs ---------- */
$("scNew").onclick=()=>{if(!busy)newScript()};
$("scSearch").oninput=e=>{q=e.target.value.trim().toLowerCase();renderList()};
$("scText").addEventListener("input",()=>{refreshMeter();queueSave()});
["scTitle","scUnit","scMinutes","scTone","scRant","scFormat","scPoints"].forEach(id=>$(id).addEventListener("change",()=>{refreshMeter();queueSave()}));
$("scIdea").addEventListener("change",()=>{ideaContext();queueSave()});
$("scSave").onclick=async()=>{try{await save()}catch(e){say("Couldn’t save: "+e.message)}};
$("scCopy").onclick=async()=>{try{await navigator.clipboard.writeText($("scText").value);say("Copied to the clipboard.")}catch(e){say("Your browser blocked copying. Select the text and copy it instead.")}};
$("scDelete").onclick=async()=>{
  if(!cur)return;
  if(!cur.id){cur=null;$("scEditor").hidden=true;$("scEmpty").hidden=false;return}
  if(!(await HOST.confirm("Delete “"+(cur.title||"this script")+"” for good?","Delete script")))return;
  try{await api({action:"delete-script",id:cur.id});list=list.filter(s=>s.id!==cur.id);cur=null;$("scEditor").hidden=true;$("scEmpty").hidden=false;renderList()}catch(e){say("Couldn’t delete: "+e.message)}
};
async function handoff(view){
  if(!readForm())return;
  if(!cur.text.trim()){say("Write or generate a script first.");return}
  try{await save(true);location.hash="#"+view+"?script="+encodeURIComponent(cur.id)}catch(e){say("Couldn’t save before opening: "+e.message)}
}
$("scSendRecord").onclick=()=>handoff("record");
$("scSendLive").onclick=()=>handoff("live");
if(window.TTS&&TTS.supported&&F.textToSpeech!==false)TTS.mount($("scTTS"),[{label:"Whole script",get:()=>$("scText").value,el:$("scText")},{label:"Selected text",get:()=>{const t=$("scText");return t.value.slice(t.selectionStart,t.selectionEnd)}}]);
else $("scTTS").hidden=true;

/* ---------- routes: #scripts?idea=… / ?open=… / ?new=1 ---------- */
async function route(query){
  const p=new URLSearchParams(query||"");
  if(p.get("open")){await openScript(p.get("open"));return}
  if(p.get("idea")){
    const idea=ideas.find(i=>i.id===p.get("idea"));if(!idea)return;
    const existing=list.find(s=>s.ideaId===idea.id);
    if(existing&&p.get("again")!=="1"){await openScript(existing.id);say("This idea already has a script, so it’s open here.");return}
    newScript({idea});return;
  }
  if(p.get("new"))newScript();
}
window.addEventListener("host-route-query",e=>{if(e.detail.view==="scripts")route(e.detail.query)});
loadAll().then(()=>route(location.hash.split("?")[1]||"")).catch(e=>{$("scList").textContent="Couldn’t load scripts: "+e.message});
});