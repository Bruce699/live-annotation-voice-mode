// PNGs live in IndexedDB; canvas layout and chat metadata stay in localStorage.
window.studyCaptures=(()=>{
 const name='live-annotation-captures';let database;
 function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async function open(){
  if(!database)database=(async()=>{
   const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('images');const db=await request(r);
   // Import existing local captures without deleting the source database or overwriting newer images.
   let known=[];try{known=await indexedDB.databases?.()||[]}catch{}
   const legacy=known.filter(item=>item.name!==name&&item.name?.endsWith('-study-captures'));
   for(const item of legacy){
    let old;
    try{old=await request(indexedDB.open(item.name));if(!old.objectStoreNames.contains('images'))continue;const read=old.transaction('images').objectStore('images');const [keys,values]=await Promise.all([request(read.getAllKeys()),request(read.getAll())]);
     await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');keys.forEach((key,index)=>{const existing=store.get(key);existing.onsuccess=()=>{if(existing.result===undefined)store.put(values[index],key)}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
    }catch{console.warn('An older screenshot store could not be imported; its source is preserved.')}finally{old?.close()}
   }db.onversionchange=()=>{db.close();database=null};return db;
  })().catch(error=>{database=null;throw error});return database;
 }
 return {async put(id,data){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(data,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('Could not store the screenshot'));tx.onabort=()=>reject(tx.error||Error('Screenshot storage was interrupted. Retry the capture.'))})},async get(id){const db=await open();return request(db.transaction('images').objectStore('images').get(id))}};
})();
