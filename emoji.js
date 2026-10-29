// Apple-style emoji on every device: swaps emoji characters for Apple emoji images (same idea as MemberScript #77).
// Turn off with features.appleEmojis = false in site-config.js. If an image can't load, the native emoji is shown instead.
// Heads up: Apple's emoji artwork is Apple's copyright. Use at your own risk, or switch the sources below to an open set.
(()=>{
const F=(window.SITE_CONFIG&&window.SITE_CONFIG.features)||{};
if(F.appleEmojis===false)return;
const SOURCES=["https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/","https://unpkg.com/emoji-datasource-apple@16.0.0/img/apple/64/"];
const PIECE="(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)[\\u{1F3FB}-\\u{1F3FF}]?";
const SRC=`\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${PIECE}(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic})\\uFE0F?[\\u{1F3FB}-\\u{1F3FF}]?)*`;
const RE=new RegExp(SRC,"gu"),TEST=new RegExp(SRC,"u");
const SKIP="SCRIPT,STYLE,TEXTAREA,SELECT,OPTION,INPUT,TITLE,NOSCRIPT,CANVAS,SVG";
const blocked="[data-native-emoji],[contenteditable],svg,textarea,select,option,script,style,title,noscript,canvas";
const failed=new Set();

function make(ch){
  const hex=[...ch].map(c=>c.codePointAt(0).toString(16).padStart(4,"0")).join("-");
  const names=[...new Set([hex,hex.replace(/-fe0f/g,"")])],tries=names.flatMap(n=>SOURCES.map(b=>b+n+".png"));
  const img=new Image();img.className="emoji";img.alt=ch;img.draggable=false;img.decoding="async";
  let i=0;img.onerror=()=>{
    if(++i<tries.length){img.src=tries[i];return}
    failed.add(ch);const span=document.createElement("span");span.dataset.nativeEmoji="";span.textContent=ch;img.replaceWith(span);
  };
  img.src=tries[0];return img;
}
function convert(node){
  const text=node.nodeValue;if(!TEST.test(text))return;
  const found=[...text.matchAll(RE)];
  if(!found.some(m=>!failed.has(m[0])))return; // nothing left to swap (e.g. every image failed): leave the native emoji alone
  const frag=document.createDocumentFragment();let last=0;
  for(const m of found){
    if(m.index>last)frag.append(text.slice(last,m.index));
    frag.append(failed.has(m[0])?m[0]:make(m[0]));last=m.index+m[0].length;
  }
  if(last<text.length)frag.append(text.slice(last));
  node.replaceWith(frag);
}
const allowed=el=>el&&!el.closest(blocked);
function scan(root){
  if(root.nodeType===3){if(allowed(root.parentElement))convert(root);return}
  if(root.nodeType!==1||!allowed(root))return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>TEST.test(n.nodeValue)&&allowed(n.parentElement)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}),list=[];
  while(w.nextNode())list.push(w.currentNode);list.forEach(convert);
}
function start(){
  const st=document.createElement("style");
  st.textContent="img.emoji{display:inline-block;width:1.15em;height:1.15em;margin:0 .05em 0 .1em;vertical-align:-.22em;object-fit:contain;-webkit-user-drag:none}";
  document.head.append(st);
  scan(document.body);
  const pending=new Set();let queued=false;
  const flush=()=>{queued=false;const items=[...pending];pending.clear();items.forEach(n=>{if(n.isConnected)scan(n)})};
  new MutationObserver(ms=>{
    for(const m of ms){if(m.type==="characterData")pending.add(m.target);else m.addedNodes.forEach(n=>pending.add(n))}
    if(!queued&&pending.size){queued=true;requestAnimationFrame(flush)}
  }).observe(document.body,{childList:true,subtree:true,characterData:true});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();