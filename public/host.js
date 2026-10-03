(async()=>{
 if(new URLSearchParams(location.search).get('view')==='sidebar')document.body.classList.add('sidebar-only');
 const project=window.serviceConfig?.project,preview=window.serviceConfig?.preview;
 const draftScope=project?.id||window.serviceConfig?.sessionId;
 const token=document.querySelector('meta[name="study-voice-token"]').content,storage='live-annotation-draft-v1'+(draftScope?':'+draftScope:'');
 let model;try{model=JSON.parse(localStorage.getItem(storage))}catch{}if(!model?.id)model={id:crypto.randomUUID(),name:'Live Annotation',layout:'current',text:'',images:[],notes:[],messages:[],nextImageNumber:1};
 model.name='Live Annotation';
 const save=()=>localStorage.setItem(storage,JSON.stringify(model));
 const sidebar=document.createElement('iframe');sidebar.title='Voice and annotation composer';document.querySelector('.surface').append(sidebar);
 const assets=await(await fetch('sidebar-assets.json')).json();
 const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
 const script=src=>'<script src="'+src+'"></'+'script>';
 sidebar.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>'+assets.css+'</style><link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="sidebar.css"></head><body>'+assets.aside+'<script>window.studyModel='+json(model)+'</'+'script>'+script('annotation-model.js')+script('voice-waveform.js')+script('expanded-composer.js')+script('sidebar-host.js')+script('frame.js')+'</body></html>';
 const post=data=>sidebar.contentWindow.postMessage(data,location.origin),capture=document.querySelector('#capture'),stage=document.querySelector('#capture-stage'),empty=document.querySelector('#capture-empty');
 const projectFrame=document.querySelector('#project-preview'),pendingContexts=new Map();
 const pending=new Set();let aspect=16/9,inflight=null,projectLoaded=false,projectTimer;
 const activateProject=active=>{if(preview)projectFrame.contentWindow.postMessage({type:'project-activate',active},preview.origin)};
 const cancelProjectCaptures=()=>{for(const [id]of pendingContexts){pending.delete(id);pendingContexts.delete(id);post({type:'study-capture-cancel',id})}};
 if(project&&preview){
  document.body.classList.add('has-project');
  const link=document.querySelector('#open-project');link.href=project.url;link.hidden=false;
  const reload=document.querySelector('#reload-project');reload.hidden=false;reload.onclick=()=>{projectLoaded=false;projectFrame.src=preview.url};
  projectFrame.onload=()=>{cancelProjectCaptures();projectLoaded=false;projectFrame.contentWindow.postMessage({type:'project-check'},preview.origin);clearTimeout(projectTimer);projectTimer=setTimeout(()=>{if(!projectLoaded)document.querySelector('#capture-status').textContent='The project has not connected. Check its local server, reload, or share its window.'},5000)};
  projectFrame.hidden=false;empty.hidden=true;projectFrame.src=preview.url;
  document.querySelector('#capture-status').textContent='Connecting to your project…';
  document.querySelector('#show-project').onclick=()=>{capture.contentWindow.stopSharing?.();capture.hidden=true;projectFrame.hidden=false;activateProject(true);document.querySelector('#show-project').hidden=true;document.querySelector('#capture-status').textContent='Browse normally, or select the box or laser to annotate.'};
 }
 function fit(){const width=Math.min(stage.clientWidth,stage.clientHeight*aspect);capture.style.width=width+'px';capture.style.height=width/aspect+'px'}new ResizeObserver(fit).observe(stage);
 async function api(route,data){const res=await fetch('/api/'+route,{method:data?'POST':'GET',headers:{'X-Study-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(22000)});const value=await res.json();if(!res.ok)throw Error(value.error||'Request failed');return value}
 function fail(id,error){pending.delete(id);pendingContexts.delete(id);post({type:'study-capture-error',id,message:error.message});document.querySelector('#capture-status').textContent=error.message}
 async function addCapture(id,data,kind,time){
  if(inflight){fail(id,Error('Finish sending before adding another screenshot.'));return}
  try{await studyCaptures.put(id,data);if(!pending.has(id))return;const number=model.nextImageNumber++;save();const context=pendingContexts.get(id);pendingContexts.delete(id);pending.delete(id);document.querySelector('#capture-status').textContent='Screenshot added';post({type:'study-capture',image:{id,number,name:'Image '+number+'.png',data,kind,time,...(context?{context}:{})}})}catch(error){fail(id,error)}
 }
 document.querySelector('#share').onclick=async()=>{
  try{await capture.contentWindow.startSharing();activateProject(false);projectFrame.hidden=true;document.querySelector('#show-project').hidden=!project;capture.hidden=false;empty.hidden=true;fit();document.querySelector('#capture-status').textContent='Shared window is live. Draw on its preview to annotate.'}catch(error){document.querySelector('#capture-status').textContent=error.message}
 };
 window.addEventListener('message',async e=>{
  const fromProject=!!preview&&e.source===projectFrame.contentWindow&&e.origin===preview.origin;
  if(!fromProject&&e.origin!==location.origin)return;const message=e.data;
  if(e.source===capture.contentWindow||fromProject){
   if(fromProject&&message?.type==='project-ready'){cancelProjectCaptures();projectLoaded=true;clearTimeout(projectTimer);activateProject(!projectFrame.hidden);document.querySelector('#capture-status').textContent='Browse normally, or select the box or laser to annotate.';return}
   if(fromProject&&message?.type==='project-leaving'){projectLoaded=false;cancelProjectCaptures();return}
   if(message?.type==='capture-size'){aspect=message.width/message.height;fit();return}
   if(message?.type==='capture-ended'){document.querySelector('#capture-status').textContent='Screen sharing stopped. Existing screenshots are preserved.';return}
   if(message?.type==='study-capture-pending'){pending.add(message.id);if(fromProject&&message.context)pendingContexts.set(message.id,message.context);post(message);return}
   if(message?.type==='study-capture-mark'&&pending.has(message.id)){post(message);return}
   if(message?.type==='study-capture'&&pending.has(message.id)){await addCapture(message.id,message.data,message.kind,message.time);return}
   if(['study-capture-cancel','study-capture-error'].includes(message?.type)&&pending.has(message.id)){pending.delete(message.id);pendingContexts.delete(message.id);if(message.message)document.querySelector('#capture-status').textContent=message.message;post(message)}return;
  }
  if(e.source!==sidebar.contentWindow)return;
  if(message?.type==='study-rail-ready'){previousStatus=null;refreshStatus();return}
  if(message?.type==='live-retry'){document.querySelector('#retry').click();return}
  if(message?.type==='sidebar-study'){
   Object.assign(model,{text:message.text,images:message.images,notes:message.notes,messages:message.messages});if(!model.text&&!model.images.length&&!model.notes.length)model.pendingSubmission=null;try{save()}catch{document.querySelector('#delivery-status').textContent='Draft storage is full; keep this window open.'}return;
  }
  if(message?.type==='study-image-get'){
   const known=[...(model.images||[]),...(model.messages||[]).flatMap(m=>m.images||[])];if(!known.some(i=>i.id===message.id))return;
   try{const data=await studyCaptures.get(message.id);if(!data)throw Error('A saved screenshot is unavailable. Remove it and capture it again.');post({type:'study-image-data',id:message.id,data})}
   catch(error){post({type:'study-image-error',id:message.id,message:error.message||'Could not restore this screenshot. Capture it again.'})}return;
  }
  if(message?.type==='live-upload'){
   const id=crypto.randomUUID();pending.add(id);post({type:'study-capture-pending',id});
   try{if(message.file.size>8*1024*1024)throw Error('Choose an image smaller than 8 MB');const bitmap=await createImageBitmap(message.file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('Image dimensions are too large')}
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();post({type:'study-capture-mark',id,kind:'rectangle'});await addCapture(id,canvas.toDataURL('image/png'),'upload',Date.now());
   }catch(error){fail(id,error)}return;
  }
  if(message?.type==='live-submit'){
   if(inflight||pending.size){post({type:'live-submit-result',requestId:message.requestId,error:'Wait for the current capture or submission.'});return}
   inflight=message.requestId;capture.inert=true;projectFrame.inert=true;
   try{
    const draft=structuredClone(message.draft);draft.images=await Promise.all(draft.images.map(async image=>{const data=await studyCaptures.get(image.id);if(!data)throw Error(image.name+' is unavailable. Remove it and capture it again before sending.');return {...image,data}}));
    // Persist an idempotency key with the exact draft, so timeout/reload retries cannot double-send.
    const canonical=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({...draft,id:undefined})))),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(model.pendingSubmission?.canonical!==canonical){model.pendingSubmission={canonical,id:draft.id};save()}
    draft.id=model.pendingSubmission.id;const receipt=await api('submissions',draft);post({type:'live-submit-result',requestId:message.requestId,receipt});refreshStatus();
   }catch(error){post({type:'live-submit-result',requestId:message.requestId,error:error.message})}
   finally{inflight=null;capture.inert=false;projectFrame.inert=false}
  }
 });
 let previousStatus;
 async function refreshStatus(){
  try{const result=await api('status'),failed=result.submissions.findLast(item=>item.status==='failed'),label=document.querySelector('#delivery-status'),retry=document.querySelector('#retry');
   label.textContent=failed?(failed.error||'Delivery failed'):'';
   const submissions=result.submissions.map(({id,status,error})=>({id,status,error})),statusKey=JSON.stringify(submissions);
   if(statusKey!==previousStatus){previousStatus=statusKey;post({type:'live-delivery-status',error:label.textContent,mode:result.mode,submissions})}
   retry.hidden=!failed;retry.onclick=async()=>{try{await api('retry',{id:failed.id});refreshStatus()}catch(error){label.textContent=error.message;post({type:'live-delivery-status',error:error.message,mode:result.mode,submissions})}};
  }catch{const error='Local service disconnected · your draft is preserved';document.querySelector('#delivery-status').textContent=error;previousStatus=null;post({type:'live-delivery-status',error})}
 }
 refreshStatus();setInterval(refreshStatus,1500);
})();
