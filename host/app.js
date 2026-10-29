// Load each host tool into a shared shell and keep its state alive while switching views.
HOST.ready(()=>{
  const names=HOST.features.hostIdeas===false?["dashboard","record"]:["dashboard","record","ideas"],$=id=>document.getElementById(id),panels=Object.fromEntries(["dashboard","record","ideas"].map(name=>[name,$("workspace-"+name)]));
  const sources={dashboard:"/host/dashboard-view.html",record:"/host/record.html",ideas:"/host/ideas.html"};
  const scripts={dashboard:["/host/dashboard.js"],record:["/host/studio.js","/host/record.js"],ideas:["/host/tts.js","/host/ideas.js"]};
  const loadedScripts=new Set(),pendingScripts=new Map();let active="dashboard",touchX=null;
  document.querySelector('[data-view="ideas"]').hidden=HOST.features.hostIdeas===false;
  $("workspace-ideas").hidden=HOST.features.hostIdeas===false;
  $("workspaceTrack").style.width=(names.length*100)+"%";
  names.forEach(name=>{panels[name].style.flexBasis=(100/names.length)+"%"});
  function parseRoute(){
    const raw=location.hash.replace(/^#\/?/,"")||new URLSearchParams(location.search).get("view")||"dashboard",parts=raw.split("?"),name=names.includes(parts[0])?parts[0]:"dashboard";
    return{name,query:parts.slice(1).join("?")};
  }
  function setTabs(name){
    document.querySelectorAll(".workspace-tab").forEach(tab=>{const selected=tab.dataset.view===name;tab.classList.toggle("on",selected);tab.setAttribute("aria-selected",String(selected))});
    document.querySelectorAll(".hnav a").forEach(link=>link.classList.toggle("on",link.getAttribute("href").endsWith("#"+name)));
  }
  function loadScript(src){
    if(loadedScripts.has(src))return Promise.resolve();
    if(pendingScripts.has(src))return pendingScripts.get(src);
    const promise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");script.src=src;script.onload=()=>{loadedScripts.add(src);resolve()};script.onerror=()=>reject(new Error("Couldn’t load "+src));
      document.body.append(script);
    }).finally(()=>pendingScripts.delete(src));
    pendingScripts.set(src,promise);return promise;
  }
  async function loadView(name,query){
    const panel=panels[name],alreadyLoaded=panel.dataset.loaded==="true";
    if(!panel.dataset.loaded){
      $("workspaceLoading").hidden=false;$("workspaceLoadingText").textContent="Opening "+name+"…";
      try{
        const response=await fetch(sources[name],{cache:"force-cache"});
        if(!response.ok)throw new Error("HTTP "+response.status);
        const html=await response.text();
        if(name==="dashboard")panel.innerHTML=html;
        else{
          const doc=new DOMParser().parseFromString(html,"text/html"),content=doc.querySelector("#app");
          if(!content)throw new Error("Page content was not found");
          panel.innerHTML=content.innerHTML;
        }
        panel.dataset.loaded="true";
        document.body.dataset.page=name;
        for(const src of scripts[name])await loadScript(src);
      }catch(error){delete panel.dataset.loaded;const notice=document.createElement("div");notice.className="empty";notice.textContent="Couldn’t open "+name+". "+error.message+" ";const retry=document.createElement("button");retry.type="button";retry.textContent="Try again";retry.onclick=()=>loadView(name,query);notice.append(retry);panel.replaceChildren(notice)}
      finally{$("workspaceLoading").hidden=true}
    }
    active=name;document.body.dataset.page=name;setTabs(name);
    const index=names.indexOf(name);$("workspaceTrack").style.transform="translateX(-"+(index*100/names.length)+"%)";
    names.forEach(view=>panels[view].setAttribute("aria-hidden",String(view!==name)));
    if(alreadyLoaded)window.dispatchEvent(new CustomEvent("host-route-query",{detail:{view:name,query}}));
  }
  function route(){const target=parseRoute();loadView(target.name,target.query)}
  function goto(name,query=""){
    const route="#"+name+(query?"?"+query:"");if(location.hash===route)routeView();else location.hash=route;
  }
  function routeView(){const target=parseRoute();loadView(target.name,target.query)}
  document.addEventListener("click",event=>{
    const anchor=event.target.closest("a[href]");if(!anchor||anchor.target||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||!url.pathname.startsWith("/host/"))return;
    let name=url.hash?url.hash.replace(/^#\/?/,"").split("?")[0]:"";
    if(!names.includes(name))name=url.pathname.includes("record")?"record":url.pathname.includes("ideas")?"ideas":"dashboard";
    if(name==="ideas"&&HOST.features.hostIdeas===false)return;
    event.preventDefault();goto(name,url.searchParams.toString());
  });
  window.addEventListener("hashchange",route);
  $("workspaceSlider").addEventListener("touchstart",event=>{if(event.touches.length===1)touchX=event.touches[0].clientX},{passive:true});
  $("workspaceSlider").addEventListener("touchend",event=>{
    if(touchX===null||event.changedTouches.length!==1)return;
    const delta=event.changedTouches[0].clientX-touchX;touchX=null;
    if(Math.abs(delta)<90||event.target.closest("input,textarea,select,button,a"))return;
    const next=Math.max(0,Math.min(names.length-1,names.indexOf(active)+(delta<0?1:-1)));
    if(names[next]!==active)goto(names[next]);
  },{passive:true});
  if(location.hash)route();else goto(new URLSearchParams(location.search).get("view")||"dashboard");
});
