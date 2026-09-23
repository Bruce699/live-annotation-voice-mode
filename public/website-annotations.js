(()=>{
const tools=document.createElement('div');tools.id='study-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','Canvas annotations');tools.dataset.html2canvasIgnore='true';tools.hidden=true;
tools.innerHTML='<button type="button" data-mode="rectangle" aria-label="Drag and select" title="Drag and select" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/></svg></button><button type="button" data-mode="laser" aria-label="Laser pen" title="Laser pen" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 19 3-7 7-7 4 4-7 7-7 3Z"/><path d="m8 12 4 4M17 3l1-2m3 6 2-1"/></svg></button>';
const canvas=document.createElement('canvas');canvas.id='study-ink';canvas.setAttribute('aria-label','Annotation canvas');canvas.dataset.html2canvasIgnore='true';document.body.append(canvas,tools);const ctx=canvas.getContext('2d');
const LASER_LIFETIME=1500,LASER_MIN_DISTANCE=12;
let mode=null,current=null,strokes=[],fading=[],background=null,timer,raf,active=false,group=null;
const fade=stroke=>stroke.kind==='laser'?Math.max(0,1-(performance.now()-stroke.ended)/LASER_LIFETIME):AnnotationModel.opacity(performance.now()-stroke.ended);
const post=data=>parent.postMessage({...data,...(window.liveAnnotationContext?{context:window.liveAnnotationContext()}:{})},window.liveAnnotationProject?.parentOrigin||'*');
function syncBitmap(){
 // CSS excludes the scrollbar, and display density can change without iframe resize.
 const bounds=canvas.getBoundingClientRect(),width=bounds.width||innerWidth,height=bounds.height||innerHeight,ratio=devicePixelRatio||1;
 const bitmapWidth=Math.round(width*ratio),bitmapHeight=Math.round(height*ratio);
 if(canvas.width!==bitmapWidth||canvas.height!==bitmapHeight){canvas.width=bitmapWidth;canvas.height=bitmapHeight}
 return {scaleX:canvas.width/width,scaleY:canvas.height/height};
}
function size(){syncBitmap();paint()}
function paint(){cancelAnimationFrame(raf);const bitmapScale=syncBitmap();ctx.clearRect(0,0,canvas.width,canvas.height);const now=performance.now();const visible=[...fading,...strokes.map(stroke=>current&&stroke.kind==='laser'?{...stroke,ended:now}:stroke),...(current?[{...current,ended:now}]:[])].map(stroke=>({...stroke,fadeDuration:stroke.kind==='laser'?LASER_LIFETIME:undefined}));AnnotationModel.draw(ctx,visible,{now,...bitmapScale});if(current||[...strokes,...fading].some(stroke=>fade(stroke)>0))raf=requestAnimationFrame(paint)}
function setMode(value){mode=value;canvas.dataset.mode=mode||'';canvas.style.pointerEvents=mode?'auto':'none';for(const b of tools.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode))}
function reset(){clearTimeout(timer);current=null;strokes=[];fading=[];background=null;if(group)post({type:'study-capture-cancel',id:group});group=null;paint()}
for(const button of tools.querySelectorAll('button'))button.onclick=async()=>{flush();setMode(mode===button.dataset.mode?null:button.dataset.mode)};
const point=e=>({x:Math.max(0,Math.min(innerWidth,e.clientX)),y:Math.max(0,Math.min(innerHeight,e.clientY))});
function beginCapture(){if(group)return;group=crypto.randomUUID();post({type:'study-capture-pending',id:group});background=window.captureAnnotationBackground?window.captureAnnotationBackground():html2canvas(document.body,{x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,windowWidth:innerWidth,windowHeight:innerHeight,scale:Math.min(2,devicePixelRatio),logging:false,onclone:doc=>{for(const img of doc.images){const style=doc.defaultView.getComputedStyle(img);if(style.objectFit!=='cover')continue;const rect=img.getBoundingClientRect();Object.assign(img.style,{width:rect.width+'px',height:rect.height+'px',backgroundImage:'url("'+img.src+'")',backgroundSize:'cover',backgroundPosition:style.objectPosition,objectFit:'fill'});img.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}},backgroundColor:getComputedStyle(document.body).backgroundColor});background.catch(()=>{})}
const qualifies=stroke=>stroke.points.some(p=>Math.hypot(p.x-stroke.points[0].x,p.y-stroke.points[0].y)>=LASER_MIN_DISTANCE);
canvas.onpointerdown=e=>{if(!active||!mode||current||e.button!==0)return;e.preventDefault();clearTimeout(timer);canvas.setPointerCapture(e.pointerId);fading=fading.filter(stroke=>fade(stroke)>0);
 if(mode==='laser'&&strokes.length){
  // Expired ink belongs to its previous capture, even if a throttled timer is late.
  if(fade(strokes[0])<=0)flush();
  else for(const stroke of strokes)stroke.ended=performance.now();
 }
 if(mode==='rectangle')beginCapture();
 current={kind:mode,dotted:mode==='rectangle',points:[point(e)],ended:performance.now(),time:Date.now()};paint();
};
canvas.onpointermove=e=>{if(!current)return;const coalesced=e.getCoalescedEvents?.();for(const p of coalesced?.length?coalesced:[e]){if(current.points.length>12000)break;if(mode==='rectangle')current.points[1]=point(p);else current.points.push(point(p))}if(mode==='laser'&&qualifies(current))beginCapture();paint()};
canvas.onpointerup=e=>{if(!current)return;current.points.push(point(e));current.ended=performance.now();current.time=Date.now();if(current.kind==='laser'){
 if(!qualifies(current)){current=null;if(strokes.length){for(const stroke of strokes)stroke.ended=performance.now();paint();timer=setTimeout(flush,LASER_LIFETIME)}else reset();return}
 beginCapture();
 }if(current.kind==='rectangle'){const r=AnnotationModel.rectangle(current.points[0],current.points.at(-1));if(r.width<4||r.height<4){reset();return}}strokes.push(current);current=null;if(mode==='laser')for(const stroke of strokes)stroke.ended=performance.now();paint();if(mode==='rectangle')flush();else timer=setTimeout(flush,LASER_LIFETIME)};
canvas.onpointercancel=reset;
async function flush(){
 clearTimeout(timer);if(!strokes.length)return;
 // Detach the group before awaiting its background so a new stroke never waits on capture.
 const batch=strokes,source=background,id=group,w=innerWidth,h=innerHeight;
 post({type:'study-capture-mark',id,kind:batch[0].kind});
 strokes=[];background=null;group=null;fading=batch.filter(stroke=>stroke.kind==='laser'&&fade(stroke)>0);paint();
 try{
  const image=await source;let output=image;
  if(batch[0].kind==='rectangle'){
   // Crop the clean background, in bitmap pixels, without painting selection ink.
   const r=AnnotationModel.rectangle(batch[0].points[0],batch[0].points.at(-1)),sx=image.width/w,sy=image.height/h;
   const x=Math.max(0,Math.round(r.x*sx)),y=Math.max(0,Math.round(r.y*sy));
   output=document.createElement('canvas');output.width=Math.max(1,Math.min(image.width-x,Math.round(r.width*sx)));output.height=Math.max(1,Math.min(image.height-y,Math.round(r.height*sy)));
   output.getContext('2d').drawImage(image,x,y,output.width,output.height,0,0,output.width,output.height);
  }else{
   const target=image.getContext('2d');target.setTransform(1,0,0,1,0,0);AnnotationModel.draw(target,batch,{permanent:true,scaleX:image.width/w,scaleY:image.height/h});
  }
  post({type:'study-capture',id,kind:batch[0].kind,data:output.toDataURL('image/png'),time:batch.at(-1).time});
 }
 catch(error){console.error('Annotation capture failed',error);post({type:'study-capture-error',id,message:window.liveAnnotationProject?'Could not capture this page. Try Share a window for this content.':'Could not capture this annotation. Please try again.'})}
}

window.addEventListener('message',async e=>{if(e.source!==parent||e.data?.type!=='study-focus')return;active=e.data.active===true;tools.hidden=!active;if(!active){if(current)reset();await flush();setMode(null)}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode){e.preventDefault();e.stopImmediatePropagation();if(current)reset();else flush();setMode(null)}},true);
window.addEventListener('resize',()=>{reset();size()});size();post({type:'study-website-ready'});
})();
