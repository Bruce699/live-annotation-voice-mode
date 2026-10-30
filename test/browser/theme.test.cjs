const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../../server.cjs');

let browser,app,directory,url;
before(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-browser-theme-'));
 class Voice{close(){}}
 app=createServer({directory,Voice,voiceAvailable:false});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 await app.ready();url='http://localhost:'+app.server.address().port;
 browser=await chromium.launch({headless:true});
});
after(async()=>{
 await browser?.close();
 if(app)await new Promise(resolve=>app.server.close(resolve));
 if(directory)await fs.rm(directory,{recursive:true,force:true});
});
async function fixture(t,{colorScheme='light',reducedMotion='reduce',viewport={width:1300,height:900}}={}){
 const context=await browser.newContext({colorScheme,reducedMotion,viewport});t.after(()=>context.close());
 const page=await context.newPage();await page.goto(url);
 const iframe=page.locator('iframe[title="Voice and annotation composer"]');
 const composer=page.frameLocator('iframe[title="Voice and annotation composer"]');
 await composer.locator('#chat-input').waitFor();
 return {page,iframe,composer};
}
const channels=color=>{const values=color.match(/[\d.]+/g)?.map(Number);assert.ok(values?.length>=3,'Expected an RGB color, got '+color);return values.slice(0,3)};
const luminance=color=>channels(color).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
const contrast=(one,two)=>{const a=luminance(one),b=luminance(two);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
async function appearance(locator){return locator.evaluate(node=>{const surface=node.id==='chat-form'?node.querySelector(':scope>.composer-material')||node:node,style=getComputedStyle(surface);return {background:style.backgroundColor,color:style.color,fill:style.fill}})}
async function assertTheme(page,composer,theme){
 const surfaces=await Promise.all([appearance(page.locator('body')),appearance(page.locator('.frame')),appearance(composer.locator('#chat-form'))]);
 for(const surface of surfaces)assert.ok(theme==='dark'?luminance(surface.background)<.1:luminance(surface.background)>.7,theme+' surface: '+JSON.stringify(surface));
 const input=await appearance(composer.locator('#chat-input'));
 assert.ok(contrast(input.color,surfaces[2].background)>=4.5,'Draft text must remain readable in '+theme);
 return surfaces;
}
async function assertReady(composer,theme){
 const send=composer.locator('#chat-send');assert.equal(await send.isDisabled(),false);
 const style=await appearance(send);
 assert.ok(theme==='dark'?luminance(style.background)>.8:luminance(style.background)<.02,theme+' ready Send fill: '+JSON.stringify(style));
 assert.ok(contrast(style.color,style.background)>=4.5,'Ready Send icon contrast: '+JSON.stringify(style));
 return style;
}
async function settleComposer(composer){
 // A viewport update can resolve before the iframe's resize event starts its
 // spring. Let that rendering step run before waiting for the final geometry.
 await composer.locator('#chat-form').evaluate(()=>new Promise(requestAnimationFrame));
 await composer.locator('#chat-form:not(.composer-morphing)').waitFor();
 await composer.locator('#chat-form').evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))});
}
async function assertHandleGap(iframe,composer){
 const [sidebar,handle,panel,formBounds]=await Promise.all([iframe.boundingBox(),composer.locator('#composer-expand').boundingBox(),composer.locator('#chat-panel').boundingBox(),composer.locator('#chat-form').boundingBox()]);
 assert.ok(sidebar&&handle&&panel&&formBounds,'Sidebar, panel, input and collapse handle must be visible');
 assert.ok(Math.abs(handle.y-sidebar.y-24)<1,'Collapse handle must sit 24px from sidebar top: '+JSON.stringify({sidebar,handle,gap:handle.y-sidebar.y}));
 assert.ok(Math.abs(formBounds.y+formBounds.height-sidebar.y-sidebar.height)<1,'Expanded input must reach the sidebar bottom: '+JSON.stringify({sidebar,formBounds}));
 assert.ok(Math.abs(formBounds.x-panel.x)<1&&Math.abs(formBounds.width-panel.width)<1,'Expanded input must retain the panel width and alignment');
 const material=composer.locator('#chat-form>.composer-material');assert.equal(await material.count(),1,'The tab and input share one glass material');
 const [materialBounds,materialState]=await Promise.all([material.boundingBox(),material.evaluate(node=>({opacity:getComputedStyle(node).opacity,outline:node.querySelectorAll('.composer-material-outline path').length}))]);
 assert.equal(materialState.opacity,'1','The joined glass material cannot fade independently');assert.equal(materialState.outline,1,'One outline follows the joined material');
 assert.ok(Math.abs(materialBounds.y-handle.y)<1&&Math.abs(materialBounds.y+materialBounds.height-formBounds.y-formBounds.height)<1,'The continuous material spans from tab top to input bottom');
}

test('initial system light and dark themes provide readable surfaces and filled Send only for ready drafts',async t=>{
 for(const theme of ['light','dark']){
  const {page,composer}=await fixture(t,{colorScheme:theme});await assertTheme(page,composer,theme);
  const input=composer.locator('#chat-input'),send=composer.locator('#chat-send');
  assert.equal(await send.isDisabled(),true);const empty=await appearance(send);
  await input.fill('  \n  ');assert.equal(await send.isDisabled(),true);assert.equal((await appearance(send)).background,empty.background);
  await input.fill('Make this draft readable.');const ready=await assertReady(composer,theme);
  assert.notEqual(ready.background,empty.background,'Ready Send must have a distinct filled state');
  await send.hover();await assertReady(composer,theme);
  await input.fill('');assert.equal(await send.isDisabled(),true);assert.equal((await appearance(send)).background,empty.background);
 }
});

test('a running sidebar follows system theme changes without reloading or losing the draft',async t=>{
 const {page,composer}=await fixture(t,{colorScheme:'light'}),draft='Keep this draft while the system appearance changes.';
 await composer.locator('#chat-input').fill(draft);
 for(const theme of ['dark','light','dark']){
  await page.emulateMedia({colorScheme:theme});
  await assertTheme(page,composer,theme);await assertReady(composer,theme);
  assert.equal(await composer.locator('#chat-input').inputValue(),draft);
 }
});

test('expanded collapse handle keeps a 24px sidebar inset through resize, collapse and reopen',async t=>{
 for(const reducedMotion of ['reduce','no-preference']){
  const {page,iframe,composer}=await fixture(t,{colorScheme:'dark',reducedMotion});
  const draft=Array.from({length:60},(_,index)=>'Paragraph '+(index+1)+' keeps this expanded draft scrollable.').join('\n\n');
  await composer.locator('#chat-input').fill(draft);
  const compactInset=await composer.locator('#chat-form').evaluate(node=>window.innerHeight-node.getBoundingClientRect().bottom);
  await composer.getByRole('button',{name:'Expand input',exact:true}).click();await settleComposer(composer);
  await assertHandleGap(iframe,composer);
  const documentStyle=await appearance(composer.locator('#composer-document')),formStyle=await appearance(composer.locator('#chat-form'));
  assert.ok(contrast(documentStyle.color,formStyle.background)>=4.5,'Expanded draft contrast');
  for(const viewport of [{width:980,height:740},{width:420,height:640},{width:1300,height:900}]){
   await page.setViewportSize(viewport);await settleComposer(composer);await assertHandleGap(iframe,composer);
  }
  await page.emulateMedia({colorScheme:'light'});await assertHandleGap(iframe,composer);
  await composer.getByRole('button',{name:'Collapse input',exact:true}).click();await settleComposer(composer);
  assert.equal(await composer.locator('#chat-input').isVisible(),true);
  assert.equal(await composer.locator('#chat-form').evaluate(node=>node.classList.contains('composer-floating')),false);
  assert.ok(Math.abs(await composer.locator('#chat-form').evaluate(node=>window.innerHeight-node.getBoundingClientRect().bottom)-compactInset)<1,'Collapsing restores the compact bottom inset');
  assert.equal(await composer.locator('#chat-input').inputValue(),draft);
  await composer.getByRole('button',{name:'Expand input',exact:true}).click();await settleComposer(composer);await assertHandleGap(iframe,composer);
  await composer.locator('#composer-document').click();await page.keyboard.press('Escape');await settleComposer(composer);
  assert.equal(await composer.locator('#chat-input').isVisible(),true);
 }
});

test('a pending screenshot disables the filled Send state and cancellation restores the existing draft',async t=>{
 const {iframe,composer}=await fixture(t,{colorScheme:'dark'}),send=composer.locator('#chat-send');
 await composer.locator('#chat-input').fill('Wait until my screenshot is complete.');
 const ready=await assertReady(composer,'dark');
 await iframe.evaluate(frame=>frame.contentWindow.postMessage({type:'study-capture-pending',id:'theme-pending'},location.origin));
 await composer.locator('#chat-send[disabled]').waitFor();
 assert.notEqual((await appearance(send)).background,ready.background,'Pending capture must visibly disable Send');
 await iframe.evaluate(frame=>frame.contentWindow.postMessage({type:'study-capture-cancel',id:'theme-pending'},location.origin));
 await composer.locator('#chat-send:not([disabled])').waitFor();await assertReady(composer,'dark');
 assert.equal(await composer.locator('#chat-input').inputValue(),'Wait until my screenshot is complete.');
 assert.equal((await app.store.list()).length,0,'Appearance checks must never send a real message');
});

test('expanding and reversing the composer keeps its surface continuous and preserves the draft',async t=>{
 const {composer}=await fixture(t,{reducedMotion:'no-preference'});
 const draft=Array.from({length:40},(_,i)=>'Keep paragraph '+i+' while the input changes shape.').join('\n\n');
 await composer.locator('#chat-input').fill(draft);
 await composer.locator('#chat-input').evaluate(async input=>{
  while(Math.abs(input.getBoundingClientRect().height-Number(input.dataset.targetHeight))>.2)await new Promise(requestAnimationFrame);
 });
 const measurements=await composer.locator('#chat-form').evaluate(async form=>{
  // A delayed headless frame can arrive after the physical turnaround. Control
  // frame time here to observe velocity immediately after retargeting, while
  // still measuring the actual browser layout and preserving the draft checks.
  const raf=window.requestAnimationFrame,cancel=window.cancelAnimationFrame,clock=performance.now;
  let now=performance.now(),id=0;const pending=new Map();
  window.requestAnimationFrame=callback=>{pending.set(++id,callback);return id};
  window.cancelAnimationFrame=key=>pending.delete(key);performance.now=()=>now;
  const next=()=>{now+=16;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now)};
  const height=()=>form.getBoundingClientRect().height,button=document.querySelector('#composer-expand');
  try{
   const compact=height();button.click();const started=height();next();next();const growing=height();
   button.click();const reversed=height();next();const following=height();
   for(let frame=0;frame<120&&form.classList.contains('composer-morphing');frame++)next();
   return {compact,started,growing,reversed,following};
  }finally{window.requestAnimationFrame=raf;window.cancelAnimationFrame=cancel;performance.now=clock}
 });
 assert.ok(Math.abs(measurements.started-measurements.compact)<1,'Expansion begins at the visible geometry');
 assert.ok(measurements.growing>measurements.compact,'The surface expands over browser frames');
 assert.ok(Math.abs(measurements.reversed-measurements.growing)<1,'Reversing cannot jump to an endpoint');
 assert.ok(measurements.following>measurements.reversed,'Existing outward velocity survives a reversal');
 await settleComposer(composer);
 assert.equal(await composer.locator('#chat-form').evaluate(node=>node.classList.contains('composer-floating')),false);
 assert.equal(await composer.locator('#chat-input').inputValue(),draft);
 assert.equal((await app.store.list()).length,0,'Motion checks must never deliver a message');
});

test('clearing the draft during collapse retargets the surface without a jump at landing',async t=>{
 const {composer}=await fixture(t,{reducedMotion:'no-preference'});
 const compact=await composer.locator('#chat-form').evaluate(node=>node.getBoundingClientRect().height);
 await composer.locator('#chat-input').fill(Array.from({length:40},()=> 'A draft that needs the expanded reader.').join('\n\n'));
 await composer.getByRole('button',{name:'Expand input',exact:true}).click();await settleComposer(composer);
 const landing=await composer.locator('#chat-form').evaluate(async form=>{
  const next=()=>new Promise(requestAnimationFrame),height=()=>form.getBoundingClientRect().height;
  document.querySelector('#composer-expand').click();await next();await next();
  const before=height(),input=document.querySelector('#chat-input');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));const after=height();
  let previous=after;
  while(form.classList.contains('composer-morphing')){previous=height();await next();}
  return {before,after,previous,final:height()};
 });
 assert.ok(Math.abs(landing.before-landing.after)<1,'Editing must retain the current surface geometry');
 assert.ok(Math.abs(landing.final-landing.previous)<1,'Removing floating geometry must not jump at landing');
 assert.ok(Math.abs(landing.final-compact)<1,'The collapsed surface must fit the empty draft');
 assert.equal(await composer.locator('#chat-input').inputValue(),'');
 assert.equal((await app.store.list()).length,0);
});

test('full-height history keeps the final message above a growing composer and leaves the input clickable',async t=>{
 const {page,iframe,composer}=await fixture(t);
 await iframe.evaluate(frame=>{
  const model=frame.contentWindow.studyModel;
  model.messages=Array.from({length:40},(_,index)=>({id:'layout-'+index,text:'Saved message '+index+' remains readable while the input changes height.',images:[]}));
  localStorage.setItem('live-annotation-draft-v1',JSON.stringify(model));
 });
 await page.reload();await composer.locator('.chat-message').last().waitFor();
 const input=composer.locator('#chat-input'),form=composer.locator('#chat-form');
 const scroller=composer.locator('#chat-messages');await scroller.evaluate(node=>node.scrollTop=node.scrollHeight);
 async function assertHistory(){
  await page.waitForFunction(()=>{
   const doc=document.querySelector('iframe[title="Voice and annotation composer"]').contentDocument;
   const last=doc.querySelector('#chat-transcript').lastElementChild,form=doc.querySelector('#chat-form'),scroll=doc.querySelector('#chat-messages');
   return last&&last.getBoundingClientRect().bottom<=form.getBoundingClientRect().top-8&&scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<2;
  });
  const [frame,bounds]=await Promise.all([iframe.boundingBox(),composer.locator('.chat-history').boundingBox()]);
  assert.ok(Math.abs(bounds.y-frame.y)<1,'History starts at the sidebar outer top');
  assert.ok(Math.abs(bounds.y+bounds.height-frame.y-frame.height)<1,'History ends at the sidebar outer bottom');
  const exposed=await composer.locator('#chat-transcript').evaluate(node=>{
   const last=node.lastElementChild,rect=last.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.bottom-6);
   return hit===last||last.contains(hit);
  });
  assert.equal(exposed,true,'The final message is exposed above the input');
 }
 await assertHistory();const compact=(await form.boundingBox()).height;
 await input.fill(Array.from({length:12},()=> 'A multiline draft expands the input.').join('\n'));
 assert.ok((await form.boundingBox()).height>compact+60);await assertHistory();
 await input.fill('Short draft');await assertHistory();assert.ok(Math.abs((await form.boundingBox()).height-compact)<1);
 await input.click();assert.equal(await input.evaluate(node=>node===document.activeElement),true);
 assert.equal(await input.inputValue(),'Short draft');assert.equal((await composer.locator('.chat-message').allTextContents()).length,40);
 assert.equal((await app.store.list()).length,0,'Layout verification sends no messages');
});
