// Dashboard: stats, scheduled episodes, and published-episode management.
HOST.ready(()=>{
const {api,features:F}=HOST,$=id=>document.getElementById(id);
const h=(t,a,...k)=>{const e=document.createElement(t);for(const x in a||{}){if(x==="class")e.className=a[x];else if(x.startsWith("on"))e[x]=a[x];else e.setAttribute(x,a[x])}for(const c of k.flat())if(c!=null&&c!==false)e.append(c);return e};
const mb=b=>(b||0)/1048576,size=b=>mb(b)>=1024?(mb(b)/1024).toFixed(2)+" GB":mb(b).toFixed(1)+" MB";
const day=d=>{try{return new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}catch(e){return d||""}};
const localDT=iso=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
let pub=[],sch=[],drafts=[],comments=[],q="",analytics=null,analyticsError="",backfilling=false;
const say=t=>$("dstatus").textContent=t;
const hasTimedWords=e=>e.hasWords===true||Array.isArray(e.transcriptWords)&&e.transcriptWords.some(word=>word&&String(word.word||"").trim()&&Number.isFinite(Number(word.start))&&Number.isFinite(Number(word.end))&&Number(word.start)>=0&&Number(word.end)>=Number(word.start));
function count(el,to){const t0=performance.now(),step=t=>{const p=Math.min(1,(t-t0)/700);el.textContent=Math.round(to*p);if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)}

async function load(){
  say("Loading…");
  try{
    const [a,b,dr]=await Promise.all([
      fetch("/api/episodes").then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}),
      F.episodeScheduling===false?{episodes:[]}:api({action:"list-scheduled"}),
      F.episodeDrafts===false?[]:api({action:"list-drafts"}).then(d=>d.drafts||[]).catch(()=>[])]);
    pub=(a.episodes||[]).sort((x,y)=>y.num-x.num);sch=b.episodes||[];
    drafts=dr;analytics=null;analyticsError="";
    say("");render();
    api({action:"analytics-summary"}).then(data=>{analytics=data;analyticsError="";renderAnalytics()})
      .catch(error=>{analytics=null;analyticsError=error.message;renderAnalytics()});
    api({action:"list-recent-comments"}).then(data=>{comments=data.comments||[];renderComments()})
      .catch(error=>{$("commentlist").replaceChildren(h("p",{class:"analytics-error"},"Comments unavailable: "+error.message))});
  }catch(e){say("Couldn’t load the dashboard: "+e.message)}
}
const act=(label,fn,ok,cls)=>{const b=h("button",{type:"button",class:cls||""},label);
  b.onclick=async()=>{b.disabled=true;try{if(await fn()===false){b.disabled=false;return}say(ok);HOST.notify(ok);load()}catch(x){say("Failed: "+x.message);HOST.notify("Failed: "+x.message,"error");b.disabled=false}};return b};
const remove=e=>act("Delete",async()=>{if(!await HOST.confirm("Delete “"+e.title+"” and its audio for good?","Delete episode"))return false;await api({action:"delete",id:e.id})},"Episode deleted.","danger");

function stats(){
  const total=[...pub,...sch].reduce((s,e)=>s+(e.size||0),0),pct=Math.min(100,mb(total)/1024*100),last=pub[0];
  const box=$("stats");box.replaceChildren();
  const num=(label,n,i)=>{const b=h("b",null,"0");box.append(h("div",{class:"stat",style:"animation-delay:"+i*70+"ms"},b,h("span",null,label)));count(b,n)};
  num("Published",pub.length,0);
  if(F.episodeScheduling!==false)num("Scheduled",sch.length,1);
  if(F.episodeDrafts!==false)num("Drafts",drafts.length,2);
  const m=h("i");box.append(h("div",{class:"stat",style:"animation-delay:140ms"},h("b",{class:"sm"},size(total)),h("span",null,"Storage used of 1 GB"),h("div",{class:"meter"},m)));
  requestAnimationFrame(()=>requestAnimationFrame(()=>m.style.width=Math.max(pct,total?2:0)+"%"));
  box.append(h("div",{class:"stat",style:"animation-delay:210ms"},h("b",{class:"sm",title:last?last.title:""},last?last.title:"Nothing yet"),h("span",null,last?"Latest · "+day(last.date):"Latest episode")));
}
function hourLabel(hour){
  const suffix=hour<12?"AM":"PM",value=hour%12||12;
  return value+" "+suffix;
}
function renderAnalytics(){
  const range=$("analytics-range"),metrics=$("analytics-stats"),hours=$("hour-chart"),days=$("daily-chart"),dateRange=$("daily-range"),top=$("top-episodes"),error=$("analytics-error");
  metrics.replaceChildren();hours.replaceChildren();days.replaceChildren();dateRange.replaceChildren();top.replaceChildren();
  error.hidden=!analyticsError;error.textContent=analyticsError?"Listening data unavailable: "+analyticsError:"";
  if(!analytics){
    range.textContent="No listening data available";
    return;
  }
  range.textContent="Rolling 30 days";
  const topHour=analytics.topHour,peak=topHour===null||topHour===undefined?"—":hourLabel(topHour);
  for(const [label,value] of [
    ["Estimated listeners",analytics.listeners||0],
    ["Play sessions",analytics.plays||0],
    ["Peak listening hour",peak]
  ]){
    metrics.append(h("div",{class:"analytics-stat"},h("b",null,typeof value==="number"?value.toLocaleString():value),h("span",null,label)));
  }
  const hourly=Array.isArray(analytics.hourly)?analytics.hourly:Array(24).fill(0),hourMax=Math.max(...hourly,0);
  hours.setAttribute("role","img");hours.setAttribute("aria-label","Play sessions by listeners' local hour over the last 30 days");
  hourly.forEach((value,hour)=>{
    const column=h("div",{class:"hour-col",title:hourLabel(hour)+": "+value+" play sessions"},
      h("span",{class:"hour-bar",style:"--bar:"+(hourMax?Math.round(value/hourMax*100):0)}),
      h("span",{class:"hour-label","aria-hidden":"true"},hour%6===0?hourLabel(hour).replace(" ",""):""));
    hours.append(column);
  });
  const daily=Array.isArray(analytics.daily)?analytics.daily:[],dayMax=Math.max(...daily.map(item=>Number(item.plays)||0),0);
  days.setAttribute("role","img");days.setAttribute("aria-label","Daily play sessions during the last 30 days");
  daily.forEach(item=>{
    const value=Number(item.plays)||0;
    days.append(h("div",{class:"daily-col",title:day(item.date)+": "+value+" play sessions"},
      h("span",{class:"daily-bar",style:"--bar:"+(dayMax?Math.round(value/dayMax*100):0)})));
  });
  const dates=daily.length?[day(daily[0].date),day(daily[daily.length-1].date)]:["",""];
  dateRange.replaceChildren(h("span",null,dates[0]),h("span",null,dates[1]));
  const episodes=Array.isArray(analytics.topEpisodes)?analytics.topEpisodes:[];
  if(!episodes.length)top.append(h("div",{class:"empty"},"No listening data yet. Plays are counted when an episode starts."));
  else{
    const list=h("ol",{class:"top-episode-list"});
    episodes.forEach((episode,index)=>list.append(h("li",{class:"top-episode"},h("span",null,(index+1)+". "+episode.title),h("b",null,(Number(episode.plays)||0).toLocaleString()))));
    top.append(list);
  }
}
const when=iso=>{const s=(Date.now()-Date.parse(iso))/1000;return s<60?"just now":s<3600?Math.floor(s/60)+" min ago":s<86400?Math.floor(s/3600)+" h ago":new Date(iso).toLocaleDateString()};
function draftList(){
  $("draftsec").hidden=F.episodeDrafts===false;const box=$("drafts");box.replaceChildren();
  if(!drafts.length){box.append(h("div",{class:"empty"},"No drafts. Use “Save draft” on the Record page to park an episode and finish it later."));return}
  drafts.forEach((d,i)=>box.append(h("article",{class:"item",style:"animation-delay:"+i*50+"ms"},
    h("span",{class:"n draft"},"DRAFT"),
    h("div",null,h("h3",null,d.title||"Untitled draft"),h("div",{class:"sub"},"Updated "+when(d.updatedAt)+" by "+(d.updatedBy?d.updatedBy.name:"someone")+(d.unit?" · "+d.unit:"")),
      h("div",{class:"tags"},d.audio&&h("span",null,"audio · "+size(d.audio.size)),d.hasNotes&&h("span",null,"script"),d.ideaId&&h("span",null,"from an idea"))),
    h("div",{class:"acts2"},h("a",{class:"btn go",href:"/host/record.html?draft="+encodeURIComponent(d.id)},"Continue"),
      act("Delete",async()=>{if(!await HOST.confirm("Delete the draft “"+(d.title||"Untitled draft")+"”? Its saved audio goes too.","Delete draft"))return false;await api({action:"delete-draft",id:d.id})},"Draft deleted.","danger")))));
}
function scheduled(){
  $("schedsec").hidden=F.episodeScheduling===false;const box=$("sched");box.replaceChildren();
  if(!sch.length){box.append(h("div",{class:"empty"},"Nothing scheduled. Pick a future date on the Record page to queue an episode."));return}
  sch.forEach((e,i)=>{
    const input=h("input",{type:"datetime-local",value:localDT(e.publishAt),"aria-label":"Reschedule "+e.title});
    box.append(h("article",{class:"item sched",style:"animation-delay:"+i*50+"ms"},
      h("div",{class:"srow"},h("span",{class:"n"},"EP "+e.num),h("div",null,h("h3",null,e.title),h("div",{class:"sub"},"Goes live "+new Date(e.publishAt).toLocaleString()))),
      h("div",{class:"srow"},input,
        act("Save time",async()=>{if(!input.value){say("Choose a schedule time.");return false}await api({action:"set-schedule",id:e.id,publishAt:new Date(input.value).toISOString()})},"Schedule updated."),
        act("Publish now",async()=>{if(!await HOST.confirm("Publish “"+e.title+"” now?","Publish episode"))return false;await api({action:"publish-now",id:e.id})},"Episode published."),
        F.episodeDeletion!==false&&remove(e))));
  });
}
function published(){
  const box=$("plist");box.replaceChildren();
  const backfill=$("dbackfill"),missing=pub.filter(e=>!hasTimedWords(e));
  backfill.hidden=F.transcript===false||!missing.length;
  backfill.disabled=backfilling;
  backfill.textContent=backfilling?"Generating word highlights…":"Generate missing word highlights ("+missing.length+")";
  const list=pub.filter(e=>!q||(e.title+" "+(e.unit||"")).toLowerCase().includes(q));
  if(!list.length){box.append(h("div",{class:"empty"},pub.length?"No episodes match that search.":h("span",null,"No episodes yet. ",h("a",{href:"/host/record.html"},"Record the first one →"))));return}
  list.forEach((e,i)=>box.append(h("article",{class:"item",style:"animation-delay:"+Math.min(i,8)*45+"ms"},
    h("span",{class:"n"},"EP "+e.num),
    h("div",null,h("h3",null,e.title),h("div",{class:"sub"},[e.unit,day(e.date),size(e.size)].filter(Boolean).join(" · ")),
      h("div",{class:"tags"},(e.hasTranscript||e.transcript)&&h("span",null,"transcript"),e.chapters&&e.chapters.length>0&&h("span",null,e.chapters.length+" chapters"),e.rant&&h("span",null,"\u{1F525}".repeat(Math.min(5,e.rant))))),
    F.episodeDeletion!==false?remove(e):h("span"))));
}
function renderComments(){
  const box=$("commentlist");box.replaceChildren();
  if(!comments.length){box.append(h("div",{class:"empty"},"No public comments yet."));return}
  comments.forEach(comment=>box.append(h("article",{class:"comment-inbox"},
    h("div",{class:"comment-inbox-head"},h("b",null,comment.name),h("span",null,"EP: "+comment.episodeTitle+" · "+new Date(comment.createdAt).toLocaleString())),
    h("p",null,comment.text),
    h("button",{type:"button",class:"danger",onclick:async event=>{
      if(!await HOST.confirm("Delete this public comment?","Delete comment"))return;
      event.currentTarget.disabled=true;
      try{await api({action:"delete-comment",id:comment.episodeId,commentId:comment.id});comments=comments.filter(item=>item.id!==comment.id);renderComments();HOST.notify("Comment deleted.")}
      catch(error){event.currentTarget.disabled=false;HOST.notify("Couldn’t delete comment: "+error.message,"error")}
    }},"Delete"))));
}
function render(){stats();renderAnalytics();scheduled();draftList();published()}
$("dsearch").addEventListener("input",e=>{q=e.target.value.trim().toLowerCase();published()});
$("dbackfill").addEventListener("click",async()=>{
  const targets=pub.filter(e=>!hasTimedWords(e));
  if(!targets.length||backfilling)return;
  if(!await HOST.confirm("Generate accurate word timestamps for "+targets.length+" episode"+(targets.length===1?"":"s")+" using Gemini? This retranscribes each episode and may incur API usage.","Generate word highlights"))return;
  backfilling=true;published();
  let completed=0;const failures=[];
  for(const [index,episode] of targets.entries()){
    say("Generating word highlights for EP "+episode.num+" ("+(index+1)+" of "+targets.length+")…");
    try{
      const result=await api({action:"transcribe",id:episode.id,parts:episode.chunks,size:episode.size,type:episode.type});
      if(!Array.isArray(result.words)||!result.words.length)throw new Error("No timed words were returned.");
      const saved=await api({action:"save-transcript-words",id:episode.id,words:result.words,transcript:result.transcript});
      episode.hasWords=true;episode.hasTranscript=!!saved.transcript||episode.hasTranscript;
      completed++;
    }catch(error){failures.push("EP "+episode.num+": "+error.message)}
  }
  backfilling=false;published();
  say("Generated word highlights for "+completed+" of "+targets.length+" episodes."+(failures.length?" Failed: "+failures.join(" | "):""));
});
$("drefresh").addEventListener("click",load);
load();
});