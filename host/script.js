// Script maker: a private script workspace linked to ideas and the Record tab.
HOST.ready(()=>{
const {api}=HOST,$=id=>document.getElementById(id);
const UNITS=["Unit 1 · Global Tapestry","Unit 2 · Networks of Exchange","Unit 3 · Land-Based Empires","Unit 4 · Transoceanic Interconnections","Unit 5 · Revolutions","Unit 6 · Industrialization","Unit 7 · Global Conflict","Unit 8 · Cold War & Decolonization","Unit 9 · Globalization","Bonus · Off-Syllabus"];
const h=(t,a,...k)=>{const e=document.createElement(t);for(const x in a||{}){if(x==="class")e.className=a[x];else if(x.startsWith("on"))e[x]=a[x];else e.setAttribute(x,a[x])}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const say=t=>{$("scStatus").textContent=t};
let scripts=[],currentId=null,ideaId=null,q="",generation=0;
UNITS.forEach(u=>$("scUnit").append(new Option(u,u)));
[1,2,3,4,5].forEach(n=>$("scRant").append(new Option("Level "+n,n,false,n===4)));
const params=()=>new URLSearchParams(location.hash.includes("?")?location.hash.slice(location.hash.indexOf("?")+1):location.search.slice(1));
const ago=iso=>{const s=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";return new Date(iso).toLocaleDateString()};
async function load(){
  try{const d=await api({action:"list-scripts"});scripts=Array.isArray(d.scripts)?d.scripts:[];render()}
  catch(e){$("scStatusList").textContent="Couldn’t load scripts: "+e.message}
}
function render(){
  const list=scripts.filter(s=>(!q||(s.title+" "+(s.notes||"")+" "+(s.text||"")).toLowerCase().includes(q)));
  const box=$("scList");box.replaceChildren();
  $("scStatusList").textContent=list.length?list.length+" saved script"+(list.length===1?"":"s")+".":"";
  if(!list.length){box.append(h("div",{class:"empty"},scripts.length?"No scripts match that search.":"No scripts yet. Generate one above or write your own."));return}
  list.forEach(s=>{
    const open=h("a",{class:"btn go",href:"/host/#record?title="+encodeURIComponent(s.title)+"&unit="+encodeURIComponent(s.unit||"")+"&script="+s.id},"Open in Record");
    const edit=h("button",{type:"button"},"Edit");
    edit.onclick=()=>{
      currentId=s.id;ideaId=s.ideaId||null;
      $("scTitle").value=s.title||"";$("scUnit").value=UNITS.includes(s.unit)?s.unit:"";
      $("scNotes").value=s.notes||"";$("scText").value=s.text||"";
      say("Editing “"+s.title+"”.");window.scrollTo({top:0,behavior:"smooth"});
    };
    const del=h("button",{type:"button",class:"danger"},"Delete");
    del.onclick=async()=>{
      if(!await HOST.confirm("Delete “"+s.title+"”? This can’t be undone.","Delete script"))return;
      try{await api({action:"delete-script",id:s.id});if(currentId===s.id){currentId=null;$("scText").value=""}await load();HOST.notify("Script deleted.")}
      catch(e){say("Couldn’t delete: "+e.message)}
    };
    box.append(h("article",{class:"idea"},
      h("div",{class:"idea-top"},h("div",null,h("h3",null,s.title),h("div",{class:"sub"},(s.author?s.author.name+" · ":"")+"updated "+ago(s.updatedAt)+(s.unit?" · "+s.unit:"")))),
      s.notes?h("p",{class:"notes"},s.notes):null,
      h("p",{class:"notes mute"},String(s.text||"").slice(0,220)+(String(s.text||"").length>220?"…":"")),
      h("div",{class:"idea-acts"},open,edit,del)));
  });
}
async function loadIdea(id){
  try{
    const {ideas}=await api({action:"list-ideas"}),idea=(ideas||[]).find(item=>item.id===id);
    if(!idea)throw new Error("Idea not found.");
    ideaId=idea.id;$("scTitle").value=idea.title;$("scNotes").value=idea.notes||"";
    if(UNITS.includes(idea.unit))$("scUnit").value=idea.unit;
    say("Drafting a script from “"+idea.title+"”.");
  }catch(e){say("Couldn’t load that idea: "+e.message)}
}
async function loadScript(id){
  try{
    const {script}=await api({action:"get-script",id});if(!script)throw new Error("Script not found.");
    currentId=script.id;ideaId=script.ideaId||null;
    $("scTitle").value=script.title||"";$("scUnit").value=UNITS.includes(script.unit)?script.unit:"";
    $("scNotes").value=script.notes||"";$("scText").value=script.text||"";
    say("Opened “"+script.title+"”.");
  }catch(e){say("Couldn’t load that script: "+e.message)}
}
async function saveScript(){
  const title=$("scTitle").value.trim(),text=$("scText").value;
  if(!title){say("Give the script a title first.");return null}
  const saved=await api({action:"save-script",script:{id:currentId||undefined,title,unit:$("scUnit").value,notes:$("scNotes").value,text,ideaId}});
  currentId=saved.script.id;await load();return saved.script;
}
$("scGenerate").onclick=async()=>{
  const btn=$("scGenerate"),title=$("scTitle").value.trim();
  if(!title){say("Add a title or topic first.");return}
  btn.disabled=true;const token=++generation;say("Gemini is writing the script…");
  try{
    const started=await api({action:"generate-script",title,unit:$("scUnit").value,minutes:+$("scMinutes").value,tone:$("scTone").value,rant:+$("scRant").value,description:$("scNotes").value.trim()});
    if(!started.interactionId)throw new Error("Gemini did not start script generation.");
    const deadline=Date.now()+15*60*1000;let result;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,2500));
      if(token!==generation)return;
      say("Gemini is writing the script… this can take a few minutes.");
      try{result=await api({action:"script-status",id:started.interactionId})}
      catch(e){if(/HTTP 50[234]/.test(e.message))continue;throw e}
      if(result.status==="completed")break;
      if(result.error)throw new Error(result.error);
    }
    if(!result||result.status!=="completed"||!result.script)throw new Error("Gemini is still working. Try again in a moment.");
    if(token!==generation)return;
    $("scText").value=result.script;say("Script ready. Edit it, then save it or open it in Record.");
  }catch(e){say("Script generation failed: "+e.message)}
  finally{btn.disabled=false}
};
$("scSave").onclick=async()=>{
  const btn=$("scSave");btn.disabled=true;say("Saving script…");
  try{await saveScript();say("Script saved to the shared studio.");HOST.notify("Script saved.")}
  catch(e){say("Couldn’t save: "+e.message)}
  finally{btn.disabled=false}
};
$("scCopy").onclick=async()=>{
  const text=$("scText").value.trim();if(!text){say("Write or generate a script first.");return}
  try{await navigator.clipboard.writeText(text);say("Script copied to clipboard.")}
  catch(e){$("scText").select();say("Select and copy the highlighted script.")}
};
$("scRecord").onclick=async event=>{
  if(currentId)return;
  event.preventDefault();
  try{
    const script=await saveScript();if(!script)return;
    location.hash="#record?title="+encodeURIComponent(script.title)+"&unit="+encodeURIComponent(script.unit||"")+"&script="+script.id;
  }catch(e){say("Couldn’t prepare the script for Record: "+e.message)}
};
$("scSearch").oninput=e=>{q=e.target.value.trim().toLowerCase();render()};
function route(){
  const p=params();
  if(p.has("idea"))loadIdea(p.get("idea"));
  if(p.has("script"))loadScript(p.get("script"));
  if(p.has("title"))$("scTitle").value=p.get("title").slice(0,200);
  if(p.has("notes"))$("scNotes").value=p.get("notes").slice(0,8000);
  if(p.has("unit")&&UNITS.includes(p.get("unit")))$("scUnit").value=p.get("unit");
}
window.addEventListener("host-route-query",route);
route();load();
});
