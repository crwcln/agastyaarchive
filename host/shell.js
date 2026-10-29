// Shared host-area shell: password gate, "who are you" identity, header/nav, and the API helper every host page uses.
window.HOST=(()=>{
const FEATURES=(window.SITE_CONFIG&&window.SITE_CONFIG.features)||{};
let pw="",unlocked=false,identity=null;const cbs=[];
try{pw=sessionStorage.getItem("hp_pw")||"";identity=JSON.parse(localStorage.getItem("aa_host_identity")||"null")}catch(e){}
if(!identity||!identity.name)identity=null;
const $=id=>document.getElementById(id);

async function api(body){
  const r=await fetch("/api/episodes",{method:"POST",headers:{"Content-Type":"application/json","x-admin-password":pw},body:JSON.stringify({by:identity||undefined,...body})});
  const t=await r.text();let d={};try{d=JSON.parse(t)}catch(e){}
  if(!r.ok)throw new Error(d.error||(r.status===404?"API not found (HTTP 404): the cloud-functions folder isn’t deployed.":"HTTP "+r.status+(t?": "+t.slice(0,120):"")));
  if(!Object.keys(d).length)throw new Error("API returned something that isn’t JSON (functions probably aren’t deployed).");
  return d;
}
function header(){
  const page=document.body.dataset.page,link=(p,href,label)=>`<a href="${href}"${p===page?' class="on"':""}>${label}</a>`;
  $("hdr").innerHTML=`<header class="hbar"><a class="brand" href="/host/"><img src="/logo.svg" alt=""><span>The Agastya Archive</span><em>Host</em></a>
<nav class="hnav">${link("dashboard","/host/","Dashboard")}${link("record","/host/record.html","Record")}${FEATURES.hostIdeas!==false?link("ideas","/host/ideas.html","Ideas"):""}</nav>
<div class="hright"><span class="who" id="hwho" hidden></span><button type="button" id="hswitch" hidden>Switch</button><a class="btn" href="/">View site ↗</a><button type="button" id="hlock">Lock</button></div></header>`;
  if(identity){$("hwho").hidden=$("hswitch").hidden=false;$("hwho").textContent=identity.name+" · "+identity.role;
    $("hswitch").addEventListener("click",()=>{try{localStorage.removeItem("aa_host_identity")}catch(e){}location.reload()})}
  $("hlock").addEventListener("click",()=>{try{sessionStorage.removeItem("hp_pw")}catch(e){}location.reload()});
}
function finish(){unlocked=true;$("gate").replaceChildren();header();$("app").hidden=false;cbs.splice(0).forEach(cb=>cb())}
function askWho(){
  $("gate").innerHTML=`<div class="gate"><div class="card"><h1>Who’s this?</h1><p class="mute">Your name shows on ideas, comments and drafts so the team knows who wrote what. Names aren’t verified, so don’t share the host password with anyone you don’t trust.</p>
<label for="gname">Your name</label><input id="gname" maxlength="40" autocomplete="nickname">
<div class="roles"><label><input type="radio" name="grole" value="Host" checked> Host</label><label><input type="radio" name="grole" value="Co-host"> Co-host</label></div>
<div class="acts"><button class="go" type="button" id="gcont">Continue</button><span id="gnmsg" class="mute"></span></div></div></div>`;
  const input=$("gname"),go=()=>{
    const name=input.value.trim();if(!name){$("gnmsg").textContent="Enter a name first.";return}
    identity={name,role:document.querySelector('input[name="grole"]:checked').value};
    try{localStorage.setItem("aa_host_identity",JSON.stringify(identity))}catch(e){}
    finish();
  };
  $("gcont").addEventListener("click",go);input.addEventListener("keydown",e=>{if(e.key==="Enter")go()});input.focus();
}
const open=()=>identity?finish():askWho();
async function tryPw(p){
  pw=p;
  try{await api({action:"check"});try{sessionStorage.setItem("hp_pw",pw)}catch(e){}return ""}
  catch(e){pw="";try{sessionStorage.removeItem("hp_pw")}catch(x){}return e.message==="Wrong password"?"Wrong password.":"Couldn’t reach the API: "+e.message}
}
function showGate(note){
  $("gate").innerHTML=`<div class="gate"><div class="card"><h1>Host access</h1><p class="mute">Enter the admin password to manage the show.</p>
<label for="gpw">Admin password</label><div class="pwrow"><input id="gpw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"><button type="button" id="gshow">Show</button></div>
<div class="acts"><button class="go" type="button" id="gunlock">Unlock</button><span id="gmsg" class="mute"></span></div></div></div>`;
  const input=$("gpw"),msg=$("gmsg");msg.textContent=note||"";
  const go=async()=>{$("gunlock").disabled=true;msg.textContent="Checking…";const err=await tryPw(input.value);if(err){msg.textContent=err;$("gunlock").disabled=false}else open()};
  $("gunlock").addEventListener("click",go);
  input.addEventListener("keydown",e=>{if(e.key==="Enter")go()});
  $("gshow").addEventListener("click",()=>{const s=input.type==="password";input.type=s?"text":"password";$("gshow").textContent=s?"Hide":"Show";input.focus()});
  input.focus();
}
async function start(){
  if(FEATURES.hostPanel===false){$("gate").innerHTML='<div class="gate"><div class="card"><h1>Host area is off</h1><p class="mute">Turn <b>hostPanel</b> back on in site-config.js.</p><a class="btn" href="/">Back to the site</a></div></div>';return}
  if(pw){const err=await tryPw(pw);if(!err){open();return}showGate(err==="Wrong password."?"":err);return}
  showGate();
}
start();
return{api,features:FEATURES,pw:()=>pw,who:()=>identity,ready:cb=>unlocked?cb():cbs.push(cb)};
})();