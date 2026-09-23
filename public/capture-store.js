// PNGs live in IndexedDB; canvas layout and chat metadata stay in localStorage.
window.studyCaptures=(()=>{
 const name='live-annotation-captures';let database;
 function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async function open(){
  if(!database)database=(async()=>{
   const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('images');const db=await request(r);
   // Import existing local captures without deleting the source database or overwriting newer images.
   const legacy=(await indexedDB.databases?.()||[]).filter(item=>item.name!==name&&item.name?.endsWith('-study-captures'));
   for(const item of legacy){
    const old=await request(indexedDB.open(item.name));
    try{if(!old.objectStoreNames.contains('images'))continue;const read=old.transaction('images').objectStore('images');const [keys,values]=await Promise.all([request(read.getAllKeys()),request(read.getAll())]);
     await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');keys.forEach((key,index)=>{const existing=store.get(key);existing.onsuccess=()=>{if(existing.result===undefined)store.put(values[index],key)}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
    }finally{old.close()}
   }return db;
  })();return database;
 }
 return {async put(id,data){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(data,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})},async get(id){const db=await open();return request(db.transaction('images').objectStore('images').get(id))}};
})();
