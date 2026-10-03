(()=>{
const tools=document.createElement('div');tools.id='study-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Canvas annotations');tools.dataset.html2canvasIgnore='true';tools.hidden=true;
tools.innerHTML='<button type="button" data-mode="rectangle" aria-label="Drag and select" title="Drag and select" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/></svg></button><button type="button" data-mode="laser" aria-label="Laser pen" title="Laser pen" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 19 3-7 7-7 4 4-7 7-7 3Z"/><path d="m8 12 4 4M17 3l1-2m3 6 2-1"/></svg></button>';
const canvas=document.createElement('canvas');canvas.id='study-ink';canvas.setAttribute('aria-label','Annotation canvas');canvas.dataset.html2canvasIgnore='true';document.body.append(canvas,tools);const ctx=canvas.getContext('2d');
const LASER_LIFETIME=1500,LASER_MIN_DISTANCE=12,CAPTURE_TIMEOUT=20000;
let mode=null,current=null,strokes=[],fading=[],timer,raf,active=false,group=null,revision=0;
const captures=new Map();
const fade=stroke=>stroke.kind==='laser'?Math.max(0,1-(performance.now()-stroke.ended)/LASER_LIFETIME):AnnotationModel.opacity(performance.now()-stroke.ended);
const context=()=>window.liveAnnotationContext?.();
const post=data=>parent.postMessage({...((context())?{context:context()}:{}),...data},window.liveAnnotationProject?.parentOrigin||'*');
function geometry(){const bounds=canvas.getBoundingClientRect();return {revision,width:innerWidth,height:innerHeight,scrollX,scrollY,ratio:devicePixelRatio||1,scale:window.visualViewport?.scale||1,offsetX:window.visualViewport?.offsetLeft||0,offsetY:window.visualViewport?.offsetTop||0,left:bounds.left,top:bounds.top,overlayWidth:bounds.width,overlayHeight:bounds.height}}
function sameGeometry(before){const after=geometry();return Object.keys(before).every(key=>Math.abs(before[key]-after[key])<.01)}
function syncBitmap(){
 const bounds=canvas.getBoundingClientRect(),width=bounds.width||innerWidth,height=bounds.height||innerHeight,ratio=devicePixelRatio||1;
 const bitmapWidth=Math.round(width*ratio),bitmapHeight=Math.round(height*ratio);
 if(canvas.width!==bitmapWidth||canvas.height!==bitmapHeight){canvas.width=bitmapWidth;canvas.height=bitmapHeight}
 return {scaleX:canvas.width/width,scaleY:canvas.height/height,left:bounds.left,top:bounds.top};
}
function size(){syncBitmap();paint()}
function paint(){
 cancelAnimationFrame(raf);const bitmap=syncBitmap();ctx.clearRect(0,0,canvas.width,canvas.height);const now=performance.now();
 const visible=[...fading,...strokes.map(stroke=>current&&stroke.kind==='laser'?{...stroke,ended:now}:stroke),...(current?[{...current,ended:now}]:[])].map(stroke=>({...stroke,fadeDuration:stroke.kind==='laser'?LASER_LIFETIME:undefined}));
 // A page may apply CSS zoom/transform to the overlay's containing block.
 // Keep ink in the same viewport coordinates as pointer events and the capture.
 ctx.save();ctx.translate(-bitmap.left*bitmap.scaleX,-bitmap.top*bitmap.scaleY);AnnotationModel.draw(ctx,visible,{now,...bitmap});ctx.restore();
 if(current||[...strokes,...fading].some(stroke=>fade(stroke)>0))raf=requestAnimationFrame(paint);
}
function setMode(value){mode=value;canvas.dataset.mode=mode||'';canvas.style.pointerEvents=mode?'auto':'none';for(const b of tools.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode))}
function finish(job,type,message){
 if(!captures.delete(job.id))return;
 clearTimeout(job.timeout);if(type!=='study-capture')job.controller.abort();
 if(type!=='study-capture')post({type,id:job.id,...(message?{message}:{}),context:job.context});
}
function reset(message){clearTimeout(timer);current=null;strokes=[];fading=[];if(group)finish(group,'study-capture-cancel',message);group=null;paint()}
function invalidate(){
 const changed=[...captures.values()].filter(job=>!sameGeometry(job.geometry));
 if(changed.length){reset('The page moved or changed size. Draw the selection again.');for(const job of changed)finish(job,'study-capture-cancel','The page moved or changed size. Draw the selection again.')}
 size();
}
for(const button of tools.querySelectorAll('button'))button.onclick=()=>{flush();setMode(mode===button.dataset.mode?null:button.dataset.mode)};
const point=e=>({x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))});
function beginCapture(){
 if(group)return;
 const job={id:crypto.randomUUID(),geometry:geometry(),context:context(),controller:new AbortController()};group=job;captures.set(job.id,job);post({type:'study-capture-pending',id:job.id,context:job.context});
 let timeoutReject;const deadline=new Promise((_,reject)=>{timeoutReject=reject});
 job.timeout=setTimeout(()=>{job.controller.abort();timeoutReject(Error('Screenshot capture timed out. Try again, or use Share a window.'))},CAPTURE_TIMEOUT);
 // Convert synchronous renderer errors into the same terminal path as async failures.
 const render=Promise.resolve().then(()=>{
  if(job.controller.signal.aborted)throw Error('Capture cancelled');
  if(window.captureAnnotationBackground)return window.captureAnnotationBackground();
  if(typeof html2canvas!=='function')throw Error('The screenshot renderer did not load. Reload the project.');
  if([...document.querySelectorAll('*')].some(node=>{if(node.closest('[data-html2canvas-ignore]'))return false;const zoom=parseFloat(getComputedStyle(node).zoom);return Number.isFinite(zoom)&&zoom!==1}))throw Error('This page uses CSS zoom. Choose Share a window for an accurate screenshot.');
  const g=job.geometry;
  return html2canvas(document.documentElement,{x:g.scrollX,y:g.scrollY,scrollX:g.scrollX,scrollY:g.scrollY,width:g.width,height:g.height,windowWidth:g.width,windowHeight:g.height,scale:Math.min(2,g.ratio),logging:false,useCORS:true,imageTimeout:12000,signal:job.controller.signal});
 });
 job.source=Promise.race([render,deadline]).finally(()=>clearTimeout(job.timeout));
 job.source.catch(error=>{
  if(!captures.has(job.id))return;
  console.error('Annotation capture failed',error);
  finish(job,'study-capture-error',error.message?.includes('timed out')||error.message?.includes('did not load')||error.message?.startsWith('This page uses CSS zoom.')?error.message:'Could not capture this page. Use Share a window for this content.');
  if(group===job){group=null;reset()}
 });
}
const qualifies=stroke=>stroke.points.some(p=>Math.hypot(p.x-stroke.points[0].x,p.y-stroke.points[0].y)>=LASER_MIN_DISTANCE);
canvas.onpointerdown=e=>{if(!active||!mode||current||e.button!==0)return;e.preventDefault();invalidate();clearTimeout(timer);canvas.setPointerCapture(e.pointerId);fading=fading.filter(stroke=>fade(stroke)>0);
 if(mode==='laser'&&strokes.length){if(fade(strokes[0])<=0)flush();else for(const stroke of strokes)stroke.ended=performance.now()}
 if(mode==='rectangle')beginCapture();
 current={kind:mode,dotted:mode==='rectangle',points:[point(e)],ended:performance.now(),time:Date.now()};paint();
};
canvas.onpointermove=e=>{if(!current)return;invalidate();if(!current)return;const coalesced=e.getCoalescedEvents?.();for(const p of coalesced?.length?coalesced:[e]){if(current.points.length>12000)break;if(mode==='rectangle')current.points[1]=point(p);else current.points.push(point(p))}if(mode==='laser'&&qualifies(current))beginCapture();paint()};
canvas.onpointerup=e=>{if(!current)return;invalidate();if(!current)return;current.points.push(point(e));current.ended=performance.now();current.time=Date.now();if(current.kind==='laser'){
 if(!qualifies(current)){current=null;if(strokes.length){for(const stroke of strokes)stroke.ended=performance.now();paint();timer=setTimeout(flush,LASER_LIFETIME)}else reset();return}
 beginCapture();
 }if(current.kind==='rectangle'){const r=AnnotationModel.rectangle(current.points[0],current.points.at(-1));if(r.width<4||r.height<4){reset();return}}strokes.push(current);current=null;if(mode==='laser')for(const stroke of strokes)stroke.ended=performance.now();paint();if(mode==='rectangle')flush();else timer=setTimeout(flush,LASER_LIFETIME)};
canvas.onpointercancel=()=>reset();
async function flush(){
 clearTimeout(timer);if(!strokes.length||!group)return;
 const batch=strokes,job=group;
 post({type:'study-capture-mark',id:job.id,kind:batch[0].kind,context:job.context});
 strokes=[];group=null;fading=batch.filter(stroke=>stroke.kind==='laser'&&fade(stroke)>0);paint();
 try{
  const image=await job.source;
  if(!captures.has(job.id))return;
  if(!sameGeometry(job.geometry)){finish(job,'study-capture-cancel','The page moved or changed size. Draw the selection again.');return}
  if(!image?.width||!image?.height)throw Error('The screenshot was empty');
  let output=image;
  if(batch[0].kind==='rectangle'){
   const rect=AnnotationModel.rectangle(batch[0].points[0],batch[0].points.at(-1)),crop=AnnotationModel.cropRectangle(rect,job.geometry,image);
   if(!crop.width||!crop.height)throw Error('The selection is outside the screenshot');
   output=document.createElement('canvas');output.width=crop.width;output.height=crop.height;
   output.getContext('2d').drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
  }else{
   const target=image.getContext('2d');target.setTransform(1,0,0,1,0,0);AnnotationModel.draw(target,batch,{permanent:true,scaleX:image.width/job.geometry.width,scaleY:image.height/job.geometry.height});
  }
  const data=output.toDataURL('image/png');if(!data.startsWith('data:image/png;base64,'))throw Error('The screenshot could not be encoded');
  finish(job,'study-capture');post({type:'study-capture',id:job.id,kind:batch[0].kind,data,time:batch.at(-1).time,context:job.context});
 }catch(error){if(captures.has(job.id)){console.error('Annotation capture failed',error);finish(job,'study-capture-error','Could not capture this page. Use Share a window for this content.')}}
}

window.addEventListener('message',async e=>{if(e.source!==parent||e.data?.type!=='study-focus')return;active=e.data.active===true;tools.hidden=!active;if(!active){if(current)reset();await flush();setMode(null)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode){e.preventDefault();e.stopImmediatePropagation();if(current)reset();else flush();setMode(null)}},true);
window.addEventListener('resize',invalidate);
function contentMoved(){revision++;invalidate()}
document.addEventListener('scroll',contentMoved,true);window.addEventListener('study-project-location',contentMoved);
window.visualViewport?.addEventListener('resize',invalidate);window.visualViewport?.addEventListener('scroll',invalidate);
new ResizeObserver(invalidate).observe(canvas);
// Browser zoom and moving between displays can change DPR without resizing the iframe.
let densityQuery;function watchDensity(){densityQuery?.removeEventListener('change',densityChanged);densityQuery=matchMedia('(resolution: '+devicePixelRatio+'dppx)');densityQuery.addEventListener('change',densityChanged)}
function densityChanged(){invalidate();watchDensity()}watchDensity();
window.addEventListener('pagehide',()=>{reset();for(const job of captures.values())finish(job,'study-capture-cancel')});
size();post({type:'study-website-ready'});
})();
