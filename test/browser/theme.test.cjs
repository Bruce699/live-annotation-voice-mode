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
async function appearance(locator){return locator.evaluate(node=>{const style=getComputedStyle(node);return {background:style.backgroundColor,color:style.color,fill:style.fill}})}
async function assertTheme(page,composer,theme){
 const surfaces=await Promise.all([appearance(page.locator('body')),appearance(composer.locator('body')),appearance(composer.locator('#chat-form'))]);
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
 await composer.locator('#chat-form').evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))});
}
async function assertHandleGap(iframe,composer){
 const [sidebar,handle]=await Promise.all([iframe.boundingBox(),composer.locator('#composer-expand').boundingBox()]);
 assert.ok(sidebar&&handle,'Sidebar and collapse handle must be visible');
 assert.ok(Math.abs(handle.y-sidebar.y-24)<1,'Collapse handle must sit 24px from sidebar top: '+JSON.stringify({sidebar,handle,gap:handle.y-sidebar.y}));
 const [tab,form]=await Promise.all([appearance(composer.locator('.composer-tab-shape')),appearance(composer.locator('#chat-form'))]);
 assert.equal(tab.fill,form.background,'The collapse tab must match the composer surface');
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
