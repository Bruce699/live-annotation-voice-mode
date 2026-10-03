const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const {createProjectProxy}=require('../../lib/project-proxy.cjs');
const {projectOptions}=require('../../lib/project.cjs');

let browser,upstream,host,proxy,url;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixture='<!doctype html><html><head><meta charset="utf-8"><title>Capture regression</title><style>html{background:oklch(98% .01 240)}body{margin:13px;min-height:1800px}#target{position:absolute;top:160px;left:20vw;width:160px;height:120px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}#target i:nth-child(1){background:oklch(60% .2 40)}#target i:nth-child(2){background:rgb(20,180,70)}#target i:nth-child(3){background:rgb(30,70,220)}#target i:nth-child(4){background:rgb(240,210,20)}@media(max-width:800px){#target{left:70px;width:200px}}</style></head><body><div id="target"><i></i><i></i><i></i><i></i></div></body></html>';
before(async()=>{
 browser=await chromium.launch();
 upstream=http.createServer((req,res)=>{
  if(req.url==='/fixture.svg'){res.setHeader('Content-Type','image/svg+xml');res.setHeader('Access-Control-Allow-Origin','*');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><path fill="red" d="M0 0h80v120H0z"/><path fill="lime" d="M80 0h80v120H80z"/><path fill="blue" d="M160 0h80v120H160z"/><path fill="yellow" d="M240 0h80v120H240z"/></svg>')}
  res.setHeader('Content-Type','text/html');res.end(fixture)
 });await listen(upstream);
 let preview;
 host=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="'+preview.url+'"></iframe><script>window.events=[];addEventListener("message",event=>{events.push(event.data);if(event.data.type==="project-ready")event.source.postMessage({type:"project-activate",active:true},event.origin)})</script>')});await listen(host);
 url='http://localhost:'+host.address().port;
 const project=projectOptions({url:'http://localhost:'+upstream.address().port,project:'Capture regression',conversation:'capture-test'});
 proxy=createProjectProxy({project,parentOrigin:url,assetDirectory:path.resolve(__dirname,'../../public')});preview=await proxy.start();
});
after(async()=>{await browser?.close();proxy?.close();await Promise.all([host,upstream].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))))});
async function pageFor(t,ratio=1){const context=await browser.newContext({viewport:{width:1000,height:720},deviceScaleFactor:ratio});t.after(()=>context.close());const page=await context.newPage();await page.goto(url);const frame=page.frames().find(frame=>frame!==page.mainFrame());await frame.locator('#study-tools:not([hidden])').waitFor();await frame.getByRole('button',{name:'Drag and select'}).click();return {page,frame}}
async function draw(page,frame){const rect=await frame.locator('#target').boundingBox();await page.mouse.move(rect.x,rect.y);await page.mouse.down();await page.mouse.move(rect.x+rect.width,rect.y+rect.height,{steps:3});await page.mouse.up();return rect}
async function nextCapture(page,frame){const start=await page.evaluate(()=>events.length),rect=await draw(page,frame);await page.waitForFunction(start=>events.slice(start).some(event=>['study-capture','study-capture-error','study-capture-cancel'].includes(event.type)),start);const event=await page.evaluate(start=>events.slice(start).find(event=>['study-capture','study-capture-error','study-capture-cancel'].includes(event.type)),start);assert.equal(event.type,'study-capture',JSON.stringify(event));return {rect,event}}
async function pixels(page,data){return page.evaluate(async data=>{const image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {width:canvas.width,height:canvas.height,colors:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>[...ctx.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data])}},data)}
async function expectedColors(frame){return frame.evaluate(()=>[...document.querySelectorAll('#target i')].map(node=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(node).backgroundColor;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]}))}
async function assertTarget(page,frame){const {rect,event}=await nextCapture(page,frame),actual=await pixels(page,event.data),expected=await expectedColors(frame),ratio=await frame.evaluate(()=>Math.min(2,devicePixelRatio));assert.ok(Math.abs(actual.width-rect.width*ratio)<=1,JSON.stringify({rect,actual}));assert.ok(Math.abs(actual.height-rect.height*ratio)<=1);actual.colors.forEach((color,i)=>color.forEach((value,j)=>assert.ok(Math.abs(value-expected[i][j])<=3,'pixel '+i+': '+color+' expected '+expected[i])));return actual}

test('modern CSS colors produce a clean crop with exact target pixels at DPR 1 and 2',async t=>{
 for(const ratio of [1,2]){const {page,frame}=await pageFor(t,ratio);await assertTarget(page,frame)}
});
test('cross-origin images with CORS preserve object-fit cover without the old image workaround',async t=>{
 const {page,frame}=await pageFor(t);await frame.evaluate(async src=>{const target=document.querySelector('#target');target.style.display='block';const image=new Image();image.src=src;image.style='width:100%;height:100%;object-fit:cover';await image.decode();target.replaceChildren(image)},'http://localhost:'+upstream.address().port+'/fixture.svg');
 const {event}=await nextCapture(page,frame),actual=await pixels(page,event.data);assert.deepEqual(actual.colors,[[0,255,0,255],[0,0,255,255],[0,255,0,255],[0,0,255,255]]);
});
test('captures follow responsive reflow, scroll, density changes, and browser scale up/down',async t=>{
 const {page,frame}=await pageFor(t);await assertTarget(page,frame);
 await page.setViewportSize({width:700,height:650});await assertTarget(page,frame);
 await page.setViewportSize({width:1000,height:720});await assertTarget(page,frame);
 await frame.evaluate(()=>scrollTo(0,100));await assertTarget(page,frame);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1000,height:720,deviceScaleFactor:2,mobile:false});await assertTarget(page,frame);
 await cdp.send('Emulation.clearDeviceMetricsOverride');await assertTarget(page,frame);
 for(const scale of [1.5,1]){await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:scale});await assertTarget(page,frame)}
});
test('CSS zoom gives a visible screen-share remedy instead of a misaligned screenshot',async t=>{
 const {page,frame}=await pageFor(t);await frame.evaluate(()=>document.documentElement.style.zoom=1.5);await draw(page,frame);
 await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-error'));const errors=await page.evaluate(()=>events.filter(event=>event.type==='study-capture-error'));assert.match(errors[0].message,/CSS zoom.*Share a window/);
 assert.equal(await page.evaluate(()=>events.filter(event=>event.type==='study-capture').length),0);await frame.evaluate(()=>document.documentElement.style.zoom=1);await assertTarget(page,frame);
});
test('a zoom/reflow cancels a pending render and its late image never reaches the composer',async t=>{
 const {page,frame}=await pageFor(t);
 await frame.evaluate(()=>{window.actualRenderer=html2canvas;window.html2canvas=(...args)=>new Promise((resolve,reject)=>{window.releaseCapture=()=>actualRenderer(...args).then(resolve,reject)})});
 await draw(page,frame);await frame.waitForFunction(()=>!!window.releaseCapture);
 await page.setViewportSize({width:700,height:650});await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-cancel'));
 await frame.evaluate(()=>{releaseCapture();window.html2canvas=actualRenderer});await assertTarget(page,frame);
 const terminal=await page.evaluate(()=>events.filter(event=>['study-capture','study-capture-cancel','study-capture-error'].includes(event.type)));
 assert.deepEqual(terminal.map(event=>event.type),['study-capture-cancel','study-capture']);assert.notEqual(terminal[0].id,terminal[1].id);
});
test('synchronous renderer failures are terminal and the next selection still works',async t=>{
 const {page,frame}=await pageFor(t);await frame.evaluate(()=>{window.actualRenderer=html2canvas;window.html2canvas=()=>{throw Error('Unsupported CSS')}});await draw(page,frame);
 await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-error'));
 const statuses=await page.evaluate(()=>events.filter(event=>event.type.startsWith('study-capture')).map(event=>event.type));assert.ok(statuses.includes('study-capture-pending'));assert.equal(statuses.filter(type=>type==='study-capture-error').length,1);
 await frame.evaluate(()=>window.html2canvas=actualRenderer);await assertTarget(page,frame);
});
test('nested scrolling and SPA navigation cancel in-flight captures even without viewport changes',async t=>{
 for(const change of ['nested-scroll','route']){
  const {page,frame}=await pageFor(t);await frame.evaluate(()=>{const box=document.createElement('div');box.id='scroll-box';box.style='position:absolute;left:600px;top:400px;width:100px;height:100px;overflow:auto';box.innerHTML='<div style="height:500px"></div>';document.body.append(box);window.html2canvas=()=>new Promise(()=>{})});
  await draw(page,frame);await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-mark'));
  await frame.evaluate(change=>change==='route'?history.pushState({},'', '/settings'):document.querySelector('#scroll-box').scrollTop=50,change);
  await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-cancel'));assert.equal(await page.evaluate(()=>events.some(event=>event.type==='study-capture')),false);
 }
});
test('a stalled renderer times out once and releases its pending capture',async t=>{
 const {page,frame}=await pageFor(t);await page.clock.install();await frame.evaluate(()=>window.html2canvas=()=>new Promise(()=>{}));await draw(page,frame);await page.clock.fastForward(21000);
 await page.waitForFunction(()=>events.some(event=>event.type==='study-capture-error'));const terminal=await page.evaluate(()=>events.filter(event=>['study-capture-error','study-capture-cancel'].includes(event.type)));assert.equal(terminal.length,1);assert.match(terminal[0].message,/timed out/);
});
