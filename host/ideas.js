// Ideas board: a shared space for hosts and co-hosts to pitch, discuss and organise episode ideas.
HOST.ready(()=>{
const {api}=HOST,me=HOST.who(),$=id=>document.getElementById(id);
const h=(t,a,...k)=>{const e=document.createElement(t);for(const x in a||{}){if(x==="class")e.className=a[x];else if(x.startsWith("on"))e[x]=a[x];else e.setAttribute(x,a[x])}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const STATUS=[["new","New"],["discussing","Discussing"],["planned","Planned"],["recorded","Recorded"],["parked","Parked"]];
let ideas=[],filter="all",q="",sig="",baseline="";
try{baseline=localStorage.getItem("aa_ideas_seen")||""}catch(e){}
const say=t=>$("itStatus").textContent=t;
let generation=0;
function selectTab(name){
  const board=name==="board";
  $("itBoard").hidden=!board;$("itGenerator").hidden=board;
  $("itBoardTab").classList.toggle("on",board);$("itGeneratorTab").classList.toggle("on",!board);
  $("itBoardTab").setAttribute("aria-selected",String(board));$("itGeneratorTab").setAttribute("aria-selected",String(!board));
}
const ago=iso=>{const s=Math.max(0,(Date.now()-Date.parse(iso))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";if(s<604800)return Math.floor(s/86400)+" d ago";return new Date(iso).toLocaleDateString()};
const byline=p=>p.name+" · "+p.role;
const fresh=i=>!!baseline&&Date.parse(i.updatedAt)>Date.parse(baseline)&&i.updatedBy&&i.updatedBy.name!==me.name;

async function load(){
  try{
    const d=await api({action:"list-ideas"}),next=JSON.stringify(d.ideas.map(i=>[i.id,i.updatedAt,i.status,i.comments.length]));
    ideas=d.ideas;if(next!==sig){sig=next;render()}say("");
  }catch(e){say("Couldn’t load ideas: "+e.message)}
}
function card(i){
  const sel=h("select",{class:"pill s-"+i.status,"aria-label":"Status"},...STATUS.map(([v,l])=>h("option",{value:v},l)));
  sel.value=i.status;
  sel.onchange=async()=>{try{await api({action:"save-idea",id:i.id,status:sel.value});await load()}catch(e){say("Couldn’t update: "+e.message)}};
  const input=h("input",{class:"cmt-in","data-id":i.id,placeholder:"Add a comment…",maxlength:"2000","aria-label":"Comment on "+i.title});
  const send=async()=>{const t=input.value.trim();if(!t)return;input.disabled=true;try{await api({action:"comment-idea",id:i.id,text:t});input.value="";await load()}catch(e){say("Couldn’t post: "+e.message);input.disabled=false}};
  input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();send()}});
  const read=HOST&&window.TTS&&TTS.supported?h("button",{type:"button"},"🔊 Read aloud"):null;
  if(read)read.onclick=()=>TTS.quick(i.title+". "+(i.notes||""),read);
  const del=h("button",{type:"button",class:"danger"},"Delete");
  del.onclick=async()=>{if(!await HOST.confirm("Delete “"+i.title+"” and its comments?","Delete idea"))return;try{await api({action:"delete-idea",id:i.id});await load()}catch(e){say("Couldn’t delete: "+e.message);HOST.notify("Couldn’t delete idea: "+e.message,"error")}};
  return h("article",{class:"idea","data-id":i.id},
    h("div",{class:"idea-top"},h("div",null,h("h3",null,i.title,fresh(i)?h("span",{class:"badge"},"New"):null),
      h("div",{class:"sub"},byline(i.author)+" · "+ago(i.createdAt)+(i.updatedAt!==i.createdAt?" · updated "+ago(i.updatedAt):""))),sel),
    i.notes?h("p",{class:"notes"},i.notes):null,
    h("div",{class:"idea-acts"},h("a",{class:"btn go",href:"/host/record.html?idea="+encodeURIComponent(i.id)},"Start episode"),read,del),
    h("div",{class:"thread"},...i.comments.map(c=>h("div",{class:"cmt"},h("b",null,c.author.name,h("span",null,c.author.role+" · "+ago(c.at))),h("p",null,c.text))),
      h("div",{class:"cmt-form"},input,h("button",{type:"button",onclick:send},"Send"))));
}
function render(){
  const typed={};document.querySelectorAll("#itList .cmt-in").forEach(i=>{if(i.value)typed[i.dataset.id]=i.value});
  const act=document.activeElement,focus=act&&act.classList&&act.classList.contains("cmt-in")?{id:act.dataset.id,s:act.selectionStart,e:act.selectionEnd}:null;
  const bar=$("itFilters");bar.replaceChildren();
  [["all","All"],...STATUS].forEach(([v,l])=>{const n=v==="all"?ideas.length:ideas.filter(i=>i.status===v).length;
    bar.append(h("button",{type:"button",class:"chip"+(v===filter?" on":""),onclick:()=>{filter=v;render()}},l+" "+n))});
  const list=ideas.filter(i=>(filter==="all"||i.status===filter)&&(!q||(i.title+" "+i.notes).toLowerCase().includes(q)));
  const box=$("itList");box.replaceChildren();
  if(!list.length)box.append(h("div",{class:"empty"},ideas.length?"No ideas match.":"No ideas yet. Pitch the first one above."));
  list.forEach(i=>box.append(card(i)));
  box.querySelectorAll(".cmt-in").forEach(i=>{if(typed[i.dataset.id])i.value=typed[i.dataset.id]});
  if(focus){const t=box.querySelector('.cmt-in[data-id="'+focus.id+'"]');if(t){t.focus();try{t.setSelectionRange(focus.s,focus.e)}catch(e){}}}
}
$("itShare").addEventListener("click",async()=>{
  const title=$("itTitle").value.trim(),msg=$("itMsg");
  if(!title){msg.textContent="Give the idea a title first.";return}
  $("itShare").disabled=true;msg.textContent="Sharing…";
  try{await api({action:"save-idea",title,notes:$("itNotes").value});$("itTitle").value=$("itNotes").value="";msg.textContent="Shared with the team.";await load()}
  catch(e){msg.textContent="Failed: "+e.message}
  $("itShare").disabled=false;
});
$("itSearch").addEventListener("input",e=>{q=e.target.value.trim().toLowerCase();render()});
$("itBoardTab").addEventListener("click",()=>selectTab("board"));
$("itGeneratorTab").addEventListener("click",()=>selectTab("generator"));
$("itGenerate").addEventListener("click",async()=>{
  const button=$("itGenerate"),status=$("itGenStatus"),results=$("itGenResults"),topic=$("itGenTopic").value.trim(),unit=$("itGenUnit").value;
  button.disabled=true;results.replaceChildren();status.textContent="Starting the idea generator…";
  try{
    const started=await api({action:"generate-ideas",topic,unit});
    if(!started.interactionId)throw new Error("The idea generator did not start.");
    const token=++generation,deadline=Date.now()+5*60*1000;let result;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,2000));
      if(token!==generation)return;
      status.textContent="Finding fresh episode angles…";
      try{result=await api({action:"ideas-status",id:started.interactionId})}
      catch(error){if(/HTTP 50[234]/.test(error.message))continue;throw error}
      if(result.status==="completed")break;
      if(result.error)throw new Error(result.error);
    }
    if(!result||result.status!=="completed")throw new Error("Idea generation is taking too long. Please try again.");
    if(!Array.isArray(result.ideas)||!result.ideas.length)throw new Error("The generator returned no usable ideas.");
    result.ideas.forEach(idea=>{
      const title=String(idea.title||"").trim(),notes=String(idea.notes||"").trim();
      if(!title)return;
      const card=h("article",{class:"idea-result"},h("h3",null,title),notes?h("p",null,notes):null,
        h("div",{class:"idea-acts"},
          h("button",{type:"button",class:"go",onclick:async event=>{
            const add=event.currentTarget;add.disabled=true;
            try{await api({action:"save-idea",title,notes});add.textContent="Added to idea board";$("itMsg").textContent="Generated idea added to the shared board.";load()}
            catch(error){add.disabled=false;status.textContent="Couldn’t add idea: "+error.message}
          }},"Add to idea board"),
          h("a",{class:"btn",href:"/host/record.html?title="+encodeURIComponent(title)+"&unit="+encodeURIComponent(unit)},"Start episode")));
      results.append(card);
    });
    status.textContent=results.childElementCount?"Here are some starting points. Refine them or add one to the shared board.":"The generator returned no usable ideas.";
  }catch(error){status.textContent="Idea generation failed: "+error.message}
  finally{button.disabled=false}
});
const markSeen=()=>{try{localStorage.setItem("aa_ideas_seen",new Date().toISOString())}catch(e){}};
addEventListener("pagehide",markSeen);document.addEventListener("visibilitychange",()=>{if(document.hidden)markSeen()});
setInterval(()=>{if(!document.hidden)load()},15000);
load();
});