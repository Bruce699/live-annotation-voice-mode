(()=>{
 const requests=new Map();let deliveryError='';
 window.LiveAnnotationHost={submit(draft){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{requests.delete(requestId);reject(Error('Delivery could not be confirmed. Your draft is still here; retry safely.'))},25000);requests.set(requestId,{resolve,reject,timer});parent.postMessage({type:'live-submit',requestId,draft},parent.location.origin)})}};
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==parent.location.origin)return;
  if(e.data?.type==='live-delivery-status'){
   deliveryError=e.data.error||'';const send=document.querySelector('#chat-send');if(send)send.title=deliveryError||'Send';
   const status=document.querySelector('#live-delivery-status'),last=e.data.submissions?.at(-1);
   if(status){status.textContent=deliveryError||(last?.status==='delivered'?'Delivered to agent':last?.status==='delivering'?'Sending to agent…':last?.status==='queued'?(e.data.mode==='queue'?'Saved locally — waiting for your agent receiver':'Waiting to send to agent…'):last?.status==='claimed'?'Agent receiver is processing…':'');status.dataset.error=String(!!deliveryError)}
   const retry=document.querySelector('#live-delivery-retry');if(retry)retry.hidden=!e.data.submissions?.some(item=>item.status==='failed');
  }
  if(e.data?.type==='live-submit-result'){const pending=requests.get(e.data.requestId);if(!pending)return;clearTimeout(pending.timer);requests.delete(e.data.requestId);e.data.error?pending.reject(Error(e.data.error)):pending.resolve(e.data.receipt)}
 });
 window.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#chat-panel').setAttribute('aria-label','Live annotation conversation');
  document.querySelector('label[for="chat-input"]').textContent='Message your agent';
  const status=document.createElement('p');status.id='live-delivery-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.style.cssText='font-size:12px;line-height:1.4;margin:6px 0;overflow-wrap:anywhere;color:#62626b';document.querySelector('#chat-form').before(status);
  const retry=document.createElement('button');retry.type='button';retry.id='live-delivery-retry';retry.textContent='Retry delivery';retry.hidden=true;retry.style.cssText='font:inherit;font-size:12px;margin-bottom:6px';retry.onclick=()=>parent.postMessage({type:'live-retry'},parent.location.origin);status.after(retry);
  const picker=document.querySelector('#chat-image-picker'),attach=document.querySelector('#chat-attach');picker.accept='image/png,image/jpeg,image/webp';
  const configure=()=>{attach.disabled=false;attach.title='Add screenshots';document.querySelector('#chat-send').title=deliveryError||'Send'};
  new MutationObserver(configure).observe(attach,{attributes:true,attributeFilter:['disabled']});
  attach.onclick=()=>picker.click();picker.onchange=()=>{for(const file of picker.files)parent.postMessage({type:'live-upload',file},parent.location.origin);picker.value=''};configure();
 });
})();
