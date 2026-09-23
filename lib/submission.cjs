const crypto=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assert(ok,message){if(!ok)throw Error(message)}
function png(data){
 assert(typeof data==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data),'Images must be PNG data URLs');
 const bytes=Buffer.from(data.slice(22),'base64');
 assert(bytes.length<=8*1024*1024&&bytes.length>=33,'Image must be between 33 bytes and 8 MB');
 assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR','Invalid PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 assert(width>0&&height>0&&width*height<=40000000,'Invalid image dimensions');return {bytes,width,height};
}
function buildSubmission(draft){
 assert(draft&&UUID.test(draft.id||''),'Invalid submission ID');
 assert(typeof draft.text==='string'&&draft.text.length<=40000,'Transcript exceeds 40,000 characters');
 const images=draft.images||[],notes=draft.notes||[];
 assert(Array.isArray(images)&&images.length<=32&&Array.isArray(notes)&&notes.length<=128,'Too many annotations');
 assert(draft.text.trim()||images.length||notes.length,'Empty submission');
 const refs=new Map(),ids=new Set(),annotations=[],files=[];
 function identity(item,prefix){
  assert(item&&UUID.test(item.id||'')&&!ids.has(item.id),'Invalid or duplicate annotation ID');ids.add(item.id);
  assert(Number.isSafeInteger(item.number)&&item.number>0,'Invalid annotation number');
  const label=prefix+' '+item.number;assert(!annotations.some(a=>a.label===label),'Duplicate annotation label');return label;
 }
 function timestamp(item){return Number.isFinite(item.time)?new Date(item.time).toISOString():null}
 for(const item of images){
  const label=identity(item,'Image');assert(['rectangle','laser','upload'].includes(item.kind),'Invalid image kind');
  const {bytes,width,height}=png(item.data),filename=label+'.png';
  const annotation={id:item.id,type:'image',label,kind:item.kind,capturedAt:timestamp(item),attachmentId:item.id};
  if(item.context){const c=item.context;assert(typeof c.url==='string'&&c.url.length<=4096&&/^https?:\/\//.test(c.url),'Invalid capture URL');annotation.context={url:c.url,title:String(c.title||'').slice(0,500),viewport:{width:Math.max(0,Number(c.viewport?.width)||0),height:Math.max(0,Number(c.viewport?.height)||0)},scroll:{x:Number(c.scroll?.x)||0,y:Number(c.scroll?.y)||0}}}
  annotations.push(annotation);refs.set('['+label+']',{type:'image',annotationId:item.id,attachmentId:item.id,label});
  files.push({id:item.id,label,filename,mediaType:'image/png',width,height,byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes});
 }
 for(const item of notes){
  const label=identity(item,'Text');assert(typeof item.text==='string'&&item.text.length<=40000,'Invalid text annotation');
  const annotation={id:item.id,type:'quote',label,text:item.text,source:item.source==='paste'?'paste':'typed',capturedAt:timestamp(item)};
  annotations.push(annotation);refs.set('['+label+': '+item.text+']',{type:'quote',annotationId:item.id,label,text:item.text});
 }
 const content=[],used=new Set();let at=0;
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(refs.size)for(const match of draft.text.matchAll(new RegExp([...refs.keys()].sort((a,b)=>b.length-a.length).map(escape).join('|'),'g'))){
  if(match.index>at)content.push({type:'text',text:draft.text.slice(at,match.index)});
  const part=refs.get(match[0]);content.push({...part});used.add(part.annotationId);at=match.index+match[0].length;
 }
 if(at<draft.text.length)content.push({type:'text',text:draft.text.slice(at)});
 // Preserve attachments even if the user deleted their inline marker while editing.
 for(const part of refs.values())if(!used.has(part.annotationId))content.push({...part});
 const prompt={schemaVersion:'live-annotation/v1',id:draft.id,createdAt:new Date().toISOString(),intent:'user_prompt',transcript:draft.text,content,annotations,attachments:files.map(({bytes,...file})=>({...file,path:'attachments/'+file.filename}))};
 if(draft.project){const p=draft.project;assert(typeof p.id==='string'&&typeof p.name==='string'&&typeof p.url==='string'&&typeof p.conversationId==='string','Invalid project context');prompt.project={id:p.id,name:p.name,url:p.url,conversationId:p.conversationId}}
 return {prompt,files};
}
module.exports={buildSubmission,UUID};
