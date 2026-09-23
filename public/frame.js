(()=>{
const model=window.studyModel,$=s=>document.querySelector(s),input=$('#chat-input');
document.body.className='demo-view chat-visible scene-shell';document.body.dataset.layout=model.layout;
$('#chat-panel').hidden=false;$('.navigation').hidden=false;$('#chat-toggle').hidden=false;
$('#chat-project').textContent=model.name||'Live Annotation';$('#chat-project-title').textContent=model.name||'Live Annotation';$('#chat-demo').textContent='';
$('#chat-older').hidden=true;$('#chat-activity').textContent='';$('#chat-connection').textContent='';$('#chat-open-codex').remove();
$('#chat-transcript').replaceChildren();$('#chat-conversation').replaceChildren();
model.messages=Array.isArray(model.messages)?model.messages:[];
model.images=Array.isArray(model.images)?model.images:[];model.notes=Array.isArray(model.notes)?model.notes:[];const pendingCaptures=new Set(),imageData=new Map();let expandedComposer;
// Captures stay out of the draft while recording; Finish inserts the complete indexed transcript.
model.text=String(model.text||'');
const attachments=()=>[...model.images,...model.notes].sort((a,b)=>(a.addedAt||0)-(b.addedAt||0));
const reference=item=>item.kind==='note'?'[Text '+item.number+': '+item.text+']':'[Image '+item.number+']';
function transcriptDraft(text=input.value){
 let result='',last=0;
 for(const item of attachments().filter(item=>!text.includes(reference(item))).sort((a,b)=>(a.offset??text.length)-(b.offset??text.length))){
  const at=Math.max(last,Math.min(text.length,item.offset??text.length));result+=text.slice(last,at);
  result+=(result&&!/\s$/.test(result)?' ':'')+reference(item)+(at<text.length&&!/^\s/.test(text.slice(at))?' ':'');last=at;
 }
 return (result+text.slice(last)).trim();
}
const tooltip=document.createElement('div');tooltip.id='study-attachment-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;document.body.append(tooltip);
function hideTooltip(){tooltip.hidden=true}
function bindTooltip(el,label){
 const show=()=>{tooltip.textContent=label;tooltip.hidden=false;const r=el.getBoundingClientRect(),w=tooltip.offsetWidth;tooltip.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+(r.width-w)/2))+'px';tooltip.style.top=Math.max(8,r.top-tooltip.offsetHeight-8)+'px'};
 el.addEventListener('mouseenter',show);el.addEventListener('mouseleave',hideTooltip);el.addEventListener('focus',show);el.addEventListener('blur',hideTooltip);
}
function noteTile(note){const tile=document.createElement('div');tile.className='study-note-tile';tile.tabIndex=0;tile.setAttribute('role','img');tile.setAttribute('aria-label','Text '+note.number+': '+note.text);
 tile.innerHTML=note.source==='paste'?'<svg viewBox="0 0 24 24"><path d="M8 5H5v16h14V5h-3M9 3h6v4H9zM8 12h8M8 16h6"/></svg>':'<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M8 20h8"/></svg>';
 bindTooltip(tile,'Text '+note.number+(note.source==='paste'?' · Pasted text':' · Typed text'));return tile;
}
if(model.text.trim())model.text=transcriptDraft(model.text);
function imageLink(image,{tooltip=true}={}){const link=document.createElement('a');link.className='study-capture-image';link.download=image.name;if(tooltip)bindTooltip(link,'Image '+image.number);link.dataset.imageId=image.id;link.dataset.kind=image.kind||'';const img=document.createElement('img');img.alt=image.name;const caption=document.createElement('span');caption.textContent='Image '+image.number;link.append(img,caption);if(imageData.has(image.id)){link.href=imageData.get(image.id);img.src=link.href}else parent.postMessage({type:'study-image-get',id:image.id},'*');return link}
const captureShelf=document.createElement('div');captureShelf.className='study-capture-shelf';$('#chat-attachments').before(captureShelf);captureShelf.append($('#chat-attachments'));
const captureMotion={duration:350,easing:'cubic-bezier(0.12, 1, 0.2, 1)'},shrinkMotion={duration:300,easing:'cubic-bezier(0.5, 0, 0, 1)'};let shelfAnimation;
$('#chat-attachments').addEventListener('scroll',hideTooltip);
function renderImages(animateId,shrink=false){const box=$('#chat-attachments'),before=captureShelf.getBoundingClientRect().height;
 const existing=new Map([...box.children].map(el=>[el.dataset.imageId,el]));
 const children=attachments().map(image=>{if(existing.has(image.id))return existing.get(image.id);const wrap=document.createElement('div');wrap.className='study-capture-thumb';wrap.dataset.imageId=image.id;const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove '+image.name);remove.innerHTML='<svg viewBox="0 0 14 14" aria-hidden="true"><path d="m3 3 8 8m0-8-8 8"/></svg>';remove.onclick=()=>{hideTooltip();model.images=model.images.filter(i=>i.id!==image.id);model.notes=model.notes.filter(i=>i.id!==image.id);input.value=input.value.split(reference(image)).join('').replace(/ {2,}/g,' ').trim();model.text=input.value;if(session)session.marks=session.marks.filter(m=>!(m.number===image.number&&(m.kind==='note')===(image.kind==='note')));renderImages(null,true);sizeInput(true);sendState();announce()};wrap.append(image.kind==='note'?noteTile(image):imageLink(image),remove);return wrap});
 for(const child of [...box.children])if(!children.includes(child))child.remove();
 for(const child of children)if(child.parentNode!==box)box.append(child);
 box.hidden=!children.length;
 if((animateId||shrink)&&captureShelf.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
  shelfAnimation?.cancel();const after=captureShelf.getBoundingClientRect().height;
  shelfAnimation=captureShelf.animate([{height:before+'px'},{height:after+'px'}],shrink?shrinkMotion:captureMotion);
  const added=children.find(el=>el.dataset.imageId===animateId);added?.animate([{transform:'scale(0)',opacity:0},{transform:'scale(1)',opacity:1}],captureMotion);
 }
 if(animateId)box.scrollLeft=box.scrollWidth;
}

const history=document.createElement('div');history.className='chat-history';$('#chat-messages').before(history);history.append($('#chat-messages'));
const announce=()=>{expandedComposer?.refresh();parent.postMessage({type:'sidebar-study',id:model.id,state:model.state,text:input.value,messages:model.messages,images:model.images,notes:model.notes,captures:model.images.length},'*')};
const wave=new VoiceWaveform($('#voice-wave'),{quietThreshold:.001,gain:2.2,adaptiveNoiseFloor:true,speed:model.waveSpeed??.4,barWidth:model.waveBarWidth??2.5,gap:model.waveGap??2.5});let available=false,session=null;
$('#voice-status').classList.add('sr-only');
const cancelIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');cancelIcon.setAttribute('viewBox','0 0 20 20');cancelIcon.setAttribute('aria-hidden','true');
const cancelPath=document.createElementNS('http://www.w3.org/2000/svg','path');cancelPath.setAttribute('d','M6 6l8 8M14 6l-8 8');cancelIcon.append(cancelPath);$('#voice-cancel').replaceChildren(cancelIcon);
const transcribing=document.createElement('span');transcribing.id='voice-transcribing';transcribing.textContent='Transcribing';transcribing.setAttribute('aria-hidden','true');transcribing.hidden=true;$('#voice-wave').after(transcribing);
const finishIcon=document.createElement('span');finishIcon.className='voice-finish-icon';finishIcon.textContent='■';finishIcon.setAttribute('aria-hidden','true');
const spinner=document.createElement('span');spinner.className='voice-spinner';spinner.setAttribute('aria-hidden','true');$('#voice-finish').replaceChildren(finishIcon,spinner);
function sizeInput(shrink=false){const before=input.getBoundingClientRect().height;input.style.height='auto';input.style.height=Math.min(model.layout==='expanded'?290:150,Math.max(44,input.scrollHeight))+'px';if(shrink&&input.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)input.animate([{height:before+'px'},{height:input.style.height}],shrinkMotion);expandedComposer?.updateAvailability()}
function status(){if(!session)return;$('#voice-status').textContent=session.state==='recording'?'Listening':session.state==='stopping'?'Transcribing':session.message||'Starting microphone…'}
function sendState(){$('#chat-send').disabled=pendingCaptures.size>0||(session?session.state!=='recording':!input.value.trim()&&!model.images.length&&!model.notes.length)}
function renderMessages(){const transcript=$('#chat-transcript');transcript.replaceChildren();for(const message of model.messages){const node=document.createElement('div');node.className='chat-message user';node.textContent=message.text;if(message.images?.length){const images=document.createElement('div');images.className='study-message-images';images.append(...message.images.map(imageLink));node.append(images)}transcript.append(node)}$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight}
function render(){
 const processing=session?.state==='stopping';$('#chat-form').classList.toggle('voice-transcribing',processing);transcribing.hidden=!processing;$('#voice-recording').setAttribute('aria-busy',String(processing));$('#voice-finish').setAttribute('aria-label',processing?'Transcribing':'Finish dictation');$('#voice-finish').title=processing?'Transcribing':'Finish dictation';if(processing)wave.stop();
 $('#chat-form').classList.toggle('voice-active',!!session);$('#voice-recording').hidden=!session;$('#voice-status').hidden=!session;input.disabled=false;input.value=model.text||'';
 (session?$('#voice-recording'):$('.chat-actions')).append($('#chat-send'));
 renderImages();
 sendState();$('#chat-send').title='Add message to this canvas conversation';$('#chat-attach').disabled=true;$('#chat-attach').title='Image attachments are not connected yet';$('#chat-voice').disabled=!available;$('#chat-voice').title=available?'Start voice mode':'Open the local canvas preview to use dictation';$('#voice-finish').disabled=session?.state==='stopping';
 if(session)status();else wave.stop();sizeInput();expandedComposer?.refresh();
}
// Recognition revisions stay separate from the editable typed draft until recording ends.
function updateWords(words){if(!session||!words?.some(w=>w.text?.trim()))return;session.words=words}
function command(command){parent.postMessage({type:'study-voice-command',command,id:session.id,locale:navigator.language||'en-US'},'*')}
let submitting=false;
async function submitDraft(){
 if(pendingCaptures.size||submitting)return;const text=transcriptDraft();if(!text&&!model.images.length&&!model.notes.length)return;
 const message={id:crypto.randomUUID(),text,images:model.images,notes:model.notes};
 if(window.LiveAnnotationHost){
  submitting=true;$('#chat-form').inert=true;$('#chat-activity').textContent='Sending…';
  try{await window.LiveAnnotationHost.submit(message);$('#chat-activity').textContent='Saved for delivery';}
  catch(error){$('#chat-activity').textContent=error.message||'Could not send. Your draft is still here.';return;}
  finally{submitting=false;$('#chat-form').inert=false;}
 }
 model.messages.push(message);model.images=[];model.notes=[];model.text='';input.value='';renderMessages();render();announce();input.focus();
}
input.oninput=()=>{
 const before=model.text||'',after=input.value;let start=0,end=before.length,nextEnd=after.length;
 while(start<end&&start<nextEnd&&before[start]===after[start])start++;
 while(end>start&&nextEnd>start&&before[end-1]===after[nextEnd-1]){end--;nextEnd--}
 for(const image of attachments())if(Number.isFinite(image.offset)&&image.offset>start)image.offset=image.offset>=end?image.offset+nextEnd-end:nextEnd;
 model.text=input.value;sizeInput();sendState();announce()};
let draftWasPasted=false;
input.addEventListener('paste',()=>{draftWasPasted=true});
input.addEventListener('keydown',e=>{
 if(e.key!=='Enter'||e.shiftKey||e.isComposing||!session||session.state==='stopping')return;
 e.preventDefault();e.stopPropagation();const text=input.value.trim();if(!text)return;
 const number=1+Math.max(0,...model.notes.map(n=>n.number),...model.messages.flatMap(m=>(m.notes||[]).map(n=>n.number)));
 const time=Date.now(),note={id:crypto.randomUUID(),kind:'note',number,name:'Text '+number,text,source:draftWasPasted?'paste':'typed',time,addedAt:time};model.notes.push(note);
 session.marks.push({kind:'note',number,text,time:Math.max(0,(time-session.startedAt)/1000)});
 input.value='';model.text='';draftWasPasted=false;renderImages(note.id);sizeInput();wave.addMarker('note');sendState();announce();
});
$('#chat-voice').onclick=()=>{if(!available||session)return;$('#chat-activity').textContent='';session={id:crypto.randomUUID(),state:'starting',words:[],marks:[],startedAt:Date.now()};command('start');render();wave.start();input.focus()};
$('#voice-finish').onclick=()=>{if(!session||session.state==='stopping')return;session.state='stopping';render();input.focus();command('stop')};
$('#voice-cancel').onclick=()=>{if(!session)return;command('cancel');for(const mark of session.marks){const image=(mark.kind==='note'?model.notes:model.images).find(i=>i.number===mark.number);if(image)image.offset=input.value.length}session=null;model.state='idle';render();announce();input.focus()};
window.addEventListener('message',e=>{
 if(e.source!==parent)return;
 if(e.data?.type==='study-capture-mark'){if(pendingCaptures.has(e.data.id)&&session?.state!=='stopping'&&session)wave.addMarker(e.data.kind);return}
 if(e.data?.type==='study-capture-pending'){pendingCaptures.add(e.data.id);sendState();return}
 if(e.data?.type==='study-capture-cancel'||e.data?.type==='study-capture-error'){pendingCaptures.delete(e.data.id);if(e.data.message)$('#chat-activity').textContent=e.data.message;sendState();completeVoice();return}
 if(e.data?.type==='study-capture'){
  const image=e.data.image;$('#chat-activity').textContent='';pendingCaptures.delete(image.id);imageData.set(image.id,image.data);const {data,...metadata}=image;metadata.addedAt=Date.now();model.images.push(metadata);
  if(session)session.marks.push({number:image.number,time:Math.max(0,(image.time-session.startedAt)/1000)});
  else metadata.offset=input.selectionStart??input.value.length;
  renderImages(image.id);sizeInput();sendState();announce();completeVoice();return;
 }
 if(e.data?.type==='study-image-data'){imageData.set(e.data.id,e.data.data);for(const link of document.querySelectorAll('.study-capture-image'))if(link.dataset.imageId===e.data.id){link.href=e.data.data;link.querySelector('img').src=e.data.data}return}
 if(e.data?.type==='study-rail-settings'){expandedComposer?.setMapSettings(e.data.settings);return}
 if(e.data?.type==='study-wave-settings'){wave.setSpeed(e.data.speed);wave.setGeometry(e.data.barWidth,e.data.gap);return}
 if(e.data?.type==='study-voice-capability'){available=e.data.available===true;render();return}
 if(e.data?.type!=='study-voice-event'||!session||e.data.event?.id!==session.id)return;const event=e.data.event;
 if(event.type==='ready'){if(session.state!=='stopping'){session.state='recording';session.startedAt=event.startedAt||session.startedAt;status();sendState()}}
 else if(event.type==='permission'){session.message=event.message;status()}
 else if(event.type==='level')wave.setLevel(event.value);
 else if(event.type==='words')updateWords(event.words);
 else if(event.type==='stopping'){session.state='stopping';render()}
 else if(event.type==='error'){$('#chat-activity').textContent=event.code==='no_speech'?'':event.message;session.submit=false}
 else if(event.type==='done'){updateWords(event.words);session.finished=true;session.state='stopping';render();completeVoice()}
});
function completeVoice(){
 if(!session?.finished||pendingCaptures.size)return;const submit=session.submit;
 const spoken=AnnotationModel.timeline(session.words,session.marks);
 const prefix=input.value.trim()?input.value+'\n\n':'';model.text=transcriptDraft(prefix+spoken);session=null;model.state='idle';render();announce();if(submit)submitDraft();
}
$('#chat-form').onsubmit=e=>{e.preventDefault();if(pendingCaptures.size)return;if(session){if(session.state!=='recording')return;session.submit=true;session.state='stopping';render();input.focus();command('stop')}else submitDraft()};
$('#chat-folder').onclick=()=>{$('#chat-conversation').hidden=true};
$('#chat-toggle').onclick=()=>{$('#chat-messages').classList.toggle('muted-preview')};
$('#refresh').onclick=()=>render();$('#home').onclick=()=>{};
if(window.ExpandedComposer)expandedComposer=new ExpandedComposer({form:$('#chat-form'),input,hideTooltip,sizeInput,images:()=>model.images,notes:()=>model.notes,recording:()=>!!session,text:()=>session?attachments().map(reference).join(' '):transcriptDraft(),image:image=>imageLink(image,{tooltip:false}),remove:id=>{const item=[...$('#chat-attachments').children].find(el=>el.dataset.imageId===id);item?.querySelector('button').click()},change:text=>{input.value=text;model.text=text;sendState();announce()}});
renderMessages();render();parent.postMessage({type:'study-voice-hello'},'*');
})();

parent.postMessage({type:'study-rail-ready'},'*');
