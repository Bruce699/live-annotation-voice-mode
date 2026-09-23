(()=>{
const token=document.querySelector('meta[name="study-voice-token"]')?.content;let owner=null;window.studyVoiceActive=false;
function release(s){if(owner===s){clearTimeout(s.timer);owner=null;window.studyVoiceActive=false}}
const send=(frame,event)=>frame.contentWindow?.postMessage({type:'study-voice-event',event},'*');
async function api(route,data){const response=await fetch('/api/voice/'+route,{method:data?'POST':'GET',headers:{'X-Study-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(5000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Local dictation is unavailable.');return result}
async function poll(s){
 if(owner!==s)return;
 try{const result=await api('events?id='+encodeURIComponent(s.id)+'&after='+s.after);if(owner!==s)return;for(const event of result.events){s.after=event.seq;send(s.frame,event)}if(result.done){release(s);return}s.timer=setTimeout(()=>poll(s),80)}
 catch(e){send(s.frame,{id:s.id,type:'error',message:e.message});send(s.frame,{id:s.id,type:'done'});api('stop',{id:s.id,cancel:true}).catch(()=>{});release(s)}
}
window.addEventListener('message',async e=>{
 const frame=[...document.querySelectorAll('.surface iframe')].find(frame=>frame.contentWindow===e.source);if(!frame)return;
 if(e.data?.type==='study-voice-hello'){frame.contentWindow.postMessage({type:'study-voice-capability',available:!!token&&window.serviceConfig?.voiceAvailable!==false},'*');return}
 if(e.data?.type!=='study-voice-command')return;const {command,id,locale}=e.data;
 if(command==='start'){
  if(!token){send(frame,{id,type:'error',message:'Open this canvas from its local preview to use dictation.'});send(frame,{id,type:'done'});return}
  if(owner){send(frame,{id,type:'error',message:'Finish the current dictation first.'});send(frame,{id,type:'done'});return}
  if(!frame.closest('.frame.focused'))return;
  const s={frame,id,after:0};owner=s;window.studyVoiceActive=true;
  try{s.starting=api('start',{id,locale});await s.starting;if(owner===s)poll(s)}catch(error){send(frame,{id,type:'error',message:error.message});send(frame,{id,type:'done'});release(s)}
 }else if((command==='stop'||command==='cancel')&&owner?.frame===frame&&owner.id===id){try{const s=owner;await s.starting;await api('stop',{id,cancel:command==='cancel'})}catch(error){send(frame,{id,type:'error',message:error.message});send(frame,{id,type:'done'});if(owner?.id===id)release(owner)}}
});
window.addEventListener('study-exit-focus',()=>{if(owner){send(owner.frame,{id:owner.id,type:'stopping'});const s=owner;Promise.resolve(s.starting).then(()=>api('stop',{id:s.id})).catch(()=>{})}});
window.addEventListener('pagehide',()=>{if(owner)fetch('/api/voice/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token},body:JSON.stringify({id:owner.id,cancel:true}),keepalive:true}).catch(()=>{})});
})();
