// Shared by the overlay, draft timeline and isolated tests.
(function(root){
 function rectangle(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}}
 function opacity(age){return Math.max(0,Math.min(1,1-(age-650)/900))}
 function timeline(words,marks){
  const events=[...words.map((word,index)=>({...word,at:word.end,index,kind:'word'})),...marks.map((mark,index)=>({...mark,at:mark.time,index,kind:mark.kind==='note'?'note':'image'}))].sort((a,b)=>a.at-b.at||(a.kind==='word'?-1:1));
  return events.map(event=>event.kind==='image'?'[Image '+event.number+']':event.kind==='note'?'[Text '+event.number+': '+event.text+']':event.text).join(' ').replace(/\s+([,.;!?])/g,'$1');
 }
 function nextNumber(text,images=[]){let n=0;for(const match of String(text).matchAll(/\[Image (\d+)\]/g))n=Math.max(n,Number(match[1]));for(const image of images){const match=/^Image (\d+)\.png$/.exec(image.name);if(match)n=Math.max(n,Number(match[1]));}return n+1}
 function draw(ctx,strokes,{now=0,permanent=false,scaleX=1,scaleY=1}={}){
  ctx.save();ctx.scale(scaleX,scaleY);
  for(const stroke of strokes){ctx.globalAlpha=permanent?1:stroke.fadeDuration?Math.max(0,Math.min(1,1-(now-stroke.ended)/stroke.fadeDuration)):opacity(now-stroke.ended);if(ctx.globalAlpha<=0)continue;
   if(stroke.kind==='rectangle'){const r=rectangle(stroke.points[0],stroke.points.at(-1));ctx.save();ctx.fillStyle='rgba(255,133,35,.2)';ctx.strokeStyle='#ff8523';ctx.lineWidth=2;if(stroke.dotted){ctx.setLineDash([1,5]);ctx.lineCap='round'}ctx.fillRect(r.x,r.y,r.width,r.height);ctx.strokeRect(r.x,r.y,r.width,r.height);ctx.restore();continue}
   const line=()=>{ctx.beginPath();const first=stroke.points[0];ctx.moveTo(first.x,first.y);if(stroke.points.length===1)ctx.lineTo(first.x+.1,first.y);else for(const p of stroke.points.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke()};
   ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#ff203c';ctx.shadowColor='#ff1738';ctx.shadowBlur=13;ctx.lineWidth=7;line();ctx.shadowBlur=5;ctx.lineWidth=4;line();ctx.shadowBlur=0;ctx.strokeStyle='#fff7f5';ctx.lineWidth=1.8;line();
  }ctx.restore();
 }
 const api={rectangle,opacity,timeline,nextNumber,draw};if(typeof module==='object')module.exports=api;else root.AnnotationModel=api;
})(globalThis);
