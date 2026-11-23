// Temporary hand-off for a finished live recording: IndexedDB holds the blob until the Record tab opens it.
window.LiveStore=(()=>{
const DB="aa_live_recordings",STORE="files",KEY="latest",FLAG="aa_live_pending";
function open(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE)};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
})}
async function save(blob){
  const db=await open();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(blob,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
  finally{db.close()}
  try{localStorage.setItem(FLAG,JSON.stringify({at:Date.now(),size:blob.size,type:blob.type}))}catch(e){}
}
async function load(){
  try{if(!localStorage.getItem(FLAG))return null}catch(e){return null}
  const db=await open();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get(KEY);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)})}
  finally{db.close()}
}
async function clear(){
  try{localStorage.removeItem(FLAG)}catch(e){}
  const db=await open();
  try{await new Promise(resolve=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(KEY);tx.oncomplete=resolve;tx.onerror=resolve})}
  finally{db.close()}
}
return{save,load,clear};
})();
