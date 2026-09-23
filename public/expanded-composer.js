(function(root){
 const motion={duration:250,easing:'cubic-bezier(0.5, 0, 0, 1)'};
 function draftBlocks(text,images,notes){
  const refs=new Map([...images.map(image=>['[Image '+image.number+']',{type:'image',item:image}]),...notes.map(note=>['[Text '+note.number+': '+note.text+']',{type:'quote',item:note}])]);
  const escaped=[...refs.keys()].sort((a,b)=>b.length-a.length).map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const blocks=[];let at=0;
  const paragraphs=value=>{for(const paragraph of value.split(/\n\s*\n/))if(paragraph.trim())blocks.push({type:'text',text:paragraph.trim()})};
  if(escaped.length)for(const match of text.matchAll(new RegExp(escaped.join('|'),'g'))){paragraphs(text.slice(at,match.index));blocks.push({...refs.get(match[0]),token:match[0]});at=match.index+match[0].length}
  paragraphs(text.slice(at));return blocks;
 }
 class ExpandedComposer{
  constructor(options){
   this.options=options;this.form=options.form;this.expanded=false;this.signature='';
   this.button=document.createElement('button');this.button.type='button';this.button.id='composer-expand';this.button.setAttribute('aria-expanded','false');this.button.setAttribute('aria-controls','composer-document');this.button.setAttribute('aria-label','Expand input');
   this.button.innerHTML='<svg class="composer-tab-shape" viewBox="0 0 96 28" aria-hidden="true"><path d="M0 28C9 28 13 23 13 16C13 7 20 0 29 0H67C76 0 83 7 83 16C83 23 87 28 96 28Z"/></svg><svg class="composer-tab-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12.5 5-5 5 5"/></svg>';
   this.button.onclick=()=>this.toggle();this.form.prepend(this.button);
   this.document=document.createElement('div');this.document.id='composer-document';this.document.setAttribute('role','region');this.document.setAttribute('aria-label','Expanded draft');this.document.hidden=true;options.input.before(this.document);
   this.reader=document.createElement('div');this.reader.id='composer-reader';this.reader.hidden=true;this.document.before(this.reader);
   this.rail=document.createElement('nav');this.rail.id='composer-map';this.rail.setAttribute('aria-label','Draft sections');this.reader.append(this.rail,this.document);
   this.document.addEventListener('scroll',()=>this.updateCurrentSection(),{passive:true});
   if(window.ResizeObserver){this.readerObserver=new ResizeObserver(()=>{if(this.expanded)this.buildMap()});this.readerObserver.observe(this.document)}
   this.document.addEventListener('input',()=>this.commit());
   document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.expanded){event.preventDefault();event.stopImmediatePropagation();this.toggle(false)}},true);
   window.addEventListener('resize',()=>{this.animation?.cancel();if(this.expanded)this.place(this.targetRect());else this.clearPosition();this.options.sizeInput();this.updateAvailability()});
   this.updateAvailability();
  }
  updateAvailability(){
   const input=this.options.input;
   const available=this.expanded||!!input.value.trim()&&input.scrollHeight>input.clientHeight+2;
   this.button.classList.toggle('is-available',available);this.button.disabled=!available;this.button.setAttribute('aria-hidden',String(!available));
  }
  setMapSettings(settings){
   const ranges={density:[.5,2,1],textWidth:[4,24,12],markerWidth:[8,36,19],thickness:[.5,3,1],x:[-16,24,0],y:[0,240,0]},values={};
   for(const [key,[min,max,fallback]] of Object.entries(ranges)){const value=Number(settings?.[key]);values[key]=Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback}
   const style=this.reader.style;style.setProperty('--map-row-height',11/values.density+'px');style.setProperty('--map-text-width',values.textWidth+'px');style.setProperty('--map-marker-width',values.markerWidth+'px');style.setProperty('--map-thickness',values.thickness+'px');style.setProperty('--map-x',values.x+'px');style.setProperty('--map-y',values.y+'px');style.setProperty('--map-slot',Math.max(values.textWidth,values.markerWidth)+8+Math.max(0,values.x)+'px');this.updateCurrentSection();
  }
  targetRect(){
   const panel=this.form.closest('#chat-panel').getBoundingClientRect(),toolbar=document.querySelector('.toolbar')?.getBoundingClientRect();
   const top=toolbar?.bottom||panel.top;
   return {left:panel.left,top,width:panel.width,height:Math.max(180,window.innerHeight-top)};
  }
  place(rect){
   const panel=this.form.closest('#chat-panel').getBoundingClientRect();
   this.form.classList.add('composer-floating');Object.assign(this.form.style,{left:rect.left-panel.left+'px',top:rect.top-panel.top+'px',width:rect.width+'px',height:rect.height+'px'});
  }
  clearPosition(){this.form.classList.remove('composer-floating');for(const key of ['left','top','width','height'])this.form.style[key]=''}
  toggle(value=!this.expanded){
   if(value===this.expanded)return;
   this.options.hideTooltip();const before=this.form.getBoundingClientRect(),beforeStyle=getComputedStyle(this.form),beforeRadius=beforeStyle.borderRadius,beforePadding=beforeStyle.padding;this.animation?.cancel();this.contentAnimation?.cancel();
   this.expanded=value;this.form.classList.toggle('composer-expanded',value);this.button.setAttribute('aria-expanded',String(value));this.button.setAttribute('aria-label',value?'Collapse input':'Expand input');this.document.hidden=!value;this.reader.hidden=!value;
   this.clearPosition();this.options.sizeInput();if(value)this.refresh(true);
   const after=value?this.targetRect():this.form.getBoundingClientRect(),afterStyle=getComputedStyle(this.form),afterRadius=afterStyle.borderRadius,afterPadding=afterStyle.padding;
   this.place(after);this.updateAvailability();
   const panel=this.form.closest('#chat-panel').getBoundingClientRect();
   const keyframe=(rect,borderRadius,padding)=>({left:rect.left-panel.left+'px',top:rect.top-panel.top+'px',width:rect.width+'px',height:rect.height+'px',borderRadius,padding});
   if(this.form.animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
    const animation=this.form.animate([keyframe(before,beforeRadius,beforePadding),keyframe(after,afterRadius,afterPadding)],motion);this.animation=animation;
    animation.onfinish=()=>{if(this.animation!==animation)return;this.animation=null;if(!this.expanded)this.clearPosition()};
    this.contentAnimation=(value?this.document:this.options.input).animate([{opacity:0},{opacity:1}],motion);
   }else if(!value)this.clearPosition();
  }
  refresh(force=false){
   this.updateAvailability();
   if(!this.expanded||this.committing)return;
   const images=this.options.images(),notes=this.options.notes(),recording=this.options.recording(),text=this.options.text();
   const signature=JSON.stringify([text,images.map(i=>[i.id,i.kind]),notes,recording]);if(!force&&signature===this.signature)return;this.signature=signature;
   const scroll=this.document.scrollTop;this.document.replaceChildren();let group=null;
   const editable=text=>{const p=document.createElement('div');p.className='composer-paragraph';p.dataset.part='text';p.contentEditable=recording?'false':'plaintext-only';p.setAttribute('role','textbox');p.setAttribute('aria-label','Draft paragraph');p.setAttribute('aria-multiline','true');p.textContent=text;return p};
   const remove=(item,label)=>{const button=document.createElement('button');button.type='button';button.className='composer-inline-remove';button.setAttribute('aria-label','Remove '+label);button.innerHTML='<svg viewBox="0 0 14 14" aria-hidden="true"><path d="m3 3 8 8m0-8-8 8"/></svg>';button.onclick=()=>this.options.remove(item.id);return button};
   for(const block of draftBlocks(text,images,notes)){
    if(block.type==='image'){
     if(!group){group=document.createElement('div');group.className='composer-image-group';this.document.append(group)}
     const figure=document.createElement('figure');figure.dataset.part='reference';figure.dataset.token=block.token;figure.dataset.mapKind=block.item.kind==='laser'?'laser':'rectangle';figure.dataset.mapLabel='Image '+block.item.number;figure.append(this.options.image(block.item));group.append(figure);
    }else{
     group=null;
     if(block.type==='text')this.document.append(editable(block.text));
     else{const quote=document.createElement('blockquote');quote.dataset.part='reference';quote.dataset.token=block.token;quote.dataset.mapKind='note';quote.dataset.mapLabel='Quote '+block.item.number;const body=document.createElement('div');this.linkText(body,block.item.text);quote.append(body,remove(block.item,'Text '+block.item.number));this.document.append(quote)}
    }
   }
   if(!recording){const end=editable('');end.classList.add('composer-paragraph-empty');end.setAttribute('data-placeholder',this.document.children.length?'Continue writing…':'Do anything');this.document.append(end)}
   this.document.scrollTop=scroll;this.buildMap();
  }
  buildMap(){
   if(!this.expanded)return;
   const previousScroll=this.rail.scrollTop;this.rail.replaceChildren();this.mapEntries=[];let paragraph=0;
   for(const target of this.document.querySelectorAll('[data-part]')){
    if(target.dataset.part==='text'&&!target.textContent.trim())continue;
    const kind=target.dataset.mapKind||'text',lineHeight=parseFloat(getComputedStyle(target).lineHeight)||23;
    const count=kind==='text'?Math.max(1,Math.ceil(target.getBoundingClientRect().height/lineHeight)):1;
    if(kind==='text')paragraph++;
    for(let line=0;line<count;line++){
     const button=document.createElement('button');button.type='button';button.className='composer-map-mark';button.dataset.kind=kind;
     button.setAttribute('aria-label',kind==='text'?'Jump to paragraph '+paragraph+', line '+(line+1):'Jump to '+target.dataset.mapLabel);
     button.setAttribute('aria-controls','composer-document');button.append(document.createElement('span'));
     const entry={button,target,offset:line*lineHeight};this.mapEntries.push(entry);this.rail.append(button);
     button.onclick=()=>this.jumpToSection(entry);
     if(kind!=='text'){
      const hover=()=>this.waveMap(button);button.addEventListener('pointerenter',hover);button.addEventListener('focus',hover);
      button.addEventListener('pointerleave',()=>this.waveMap(null));button.addEventListener('blur',()=>this.waveMap(null));
     }
    }
   }
   this.rail.scrollTop=previousScroll;this.updateCurrentSection();
  }
  waveMap(button){
   const entries=this.mapEntries||[],at=entries.findIndex(entry=>entry.button===button);
   entries.forEach((entry,index)=>{const distance=at<0?Infinity:Math.abs(index-at);entry.button.style.setProperty('--map-stretch',distance===0?'8px':distance===1?'5px':distance===2?'2px':'0px')});
  }
  sectionTop(entry){return entry.target.getBoundingClientRect().top-this.document.getBoundingClientRect().top+this.document.scrollTop+entry.offset}
  jumpToSection(entry){
   this.document.scrollTo({top:Math.max(0,this.sectionTop(entry)-8),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  updateCurrentSection(){
   const entries=this.mapEntries||[];if(!entries.length)return;
   const at=this.document.scrollTop+12;let active=entries[0];
   for(const entry of entries){if(this.sectionTop(entry)<=at)active=entry;entry.button.removeAttribute('aria-current')}
   active.button.setAttribute('aria-current','location');
   const b=active.button,r=this.rail;if(b.offsetTop<r.scrollTop+16)r.scrollTop=Math.max(0,b.offsetTop-16);else if(b.offsetTop+b.offsetHeight>r.scrollTop+r.clientHeight-16)r.scrollTop=b.offsetTop+b.offsetHeight-r.clientHeight+16;
  }
  linkText(container,text){
   let at=0;
   for(const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"']+/gi)){
    let url=match[0].replace(/[.,!?;:]+$/,'');
    // Keep balanced URL parentheses, but leave surrounding prose punctuation outside the link.
    while(url.endsWith(')')&&(url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)url=url.slice(0,-1);
    container.append(document.createTextNode(text.slice(at,match.index)));
    const link=document.createElement('a');link.textContent=url;link.href=/^www\./i.test(url)?'https://'+url:url;link.target='_blank';link.rel='noopener noreferrer';container.append(link);at=match.index+url.length;
   }
   container.append(document.createTextNode(text.slice(at)));
  }
  commit(){
   if(this.options.recording())return;
   const text=[...this.document.querySelectorAll('[data-part]')].map(el=>el.dataset.part==='reference'?el.dataset.token:(el.innerText??el.textContent).trim()).filter(Boolean).join('\n\n');
   this.committing=true;this.options.change(text);this.committing=false;
   this.signature=JSON.stringify([this.options.text(),this.options.images().map(i=>[i.id,i.kind]),this.options.notes(),this.options.recording()]);
   this.buildMap();
  }
 }
 if(typeof module==='object')module.exports={draftBlocks};else root.ExpandedComposer=ExpandedComposer;
})(globalThis);
