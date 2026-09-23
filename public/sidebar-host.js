(()=>{
 const requests=new Map();
 window.LiveAnnotationHost={submit(draft){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('Delivery could not be confirmed. Your draft is still here; retry safely.'))},25000);requests.set(requestId,{resolve,reject,timer});parent.postMessage({type:'live-submit',requestId,draft},parent.location.origin)})}};
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==parent.location.origin)return;
  if(e.data?.type==='live-delivery-status'){const activity=document.querySelector('#chat-activity');if(activity)activity.textContent=e.data.text;}
  if(e.data?.type==='live-submit-result'){const pending=requests.get(e.data.requestId);if(!pending)return;clearTimeout(pending.timer);requests.delete(e.data.requestId);e.data.error?pending.reject(Error(e.data.error)):pending.resolve(e.data.receipt)}
 });
 window.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#chat-panel').setAttribute('aria-label','Live annotation conversation');
  document.querySelector('label[for="chat-input"]').textContent='Message your agent';
  for(const id of ['refresh','chat-toggle','home'])document.querySelector('#'+id).hidden=true;
  const picker=document.querySelector('#chat-image-picker'),attach=document.querySelector('#chat-attach');picker.accept='image/png,image/jpeg,image/webp';
  const configure=()=>{attach.disabled=false;attach.title='Add screenshots';document.querySelector('#chat-send').title='Send to connected agent'};
  new MutationObserver(configure).observe(attach,{attributes:true,attributeFilter:['disabled']});
  attach.onclick=()=>picker.click();picker.onchange=()=>{for(const file of picker.files)parent.postMessage({type:'live-upload',file},parent.location.origin);picker.value=''};configure();
 });
})();
