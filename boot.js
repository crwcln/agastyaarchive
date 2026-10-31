// Loading screen controller. The splash markup + CSS live inline in each page so it paints before anything else loads.
// It only becomes visible if loading takes longer than ~0.2s, so fast loads never flash it. Call AABoot.done() when content is ready.
(()=>{
const el=document.getElementById("boot");
if(!el)return;
const t0=performance.now(),SHOW_AFTER=200,MIN_VISIBLE=450,text=el.querySelector(".boot-text");
let finished=false;
const remove=()=>{if(el.isConnected)el.remove();document.body.classList.remove("booting")};
function done(){
  if(finished)return;finished=true;
  const age=performance.now()-t0;
  if(age<SHOW_AFTER){remove();return}                 // content was ready before the splash appeared
  setTimeout(()=>{el.classList.add("out");el.addEventListener("animationend",remove,{once:true});setTimeout(remove,800)},Math.max(0,SHOW_AFTER+MIN_VISIBLE-age));
}
window.AABoot={done,set:t=>{if(text&&!finished)text.textContent=t}};
setTimeout(done,12000);                               // never trap the page behind the splash
})();