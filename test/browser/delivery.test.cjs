const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const {createServer}=require('../../server.cjs'),{createProjectProxy}=require('../../lib/project-proxy.cjs'),{projectOptions}=require('../../lib/project.cjs');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://localhost:'+server.address().port)));
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-browser-delivery-')),received=[];let fail=false;
 const receiver=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));received.push(body);res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(fail?{error:'Destination temporarily unavailable'}:{submissionId:body.prompt.id,receiptId:'test-receipt:'+body.prompt.id}))});
 const receiverURL=await listen(receiver);
 const upstream=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><style>body{margin:0;background:white;font:20px sans-serif}#target{position:absolute;left:80px;top:100px;width:240px;height:160px;background:oklch(65% 0.2 30)}h1{margin:20px}</style></head><body><h1>Delivery test project</h1><div id="target"></div></body></html>')});
 const source=await listen(upstream),project=projectOptions({url:source,project:'Browser delivery fixture',conversation:'isolated-test-task'}),preview={};
 class Voice{close(){}}
 const app=createServer({directory,project,preview,Voice,voiceAvailable:false,webhook:receiverURL+'/prompt'}),url=await listen(app.server);
 const proxy=createProjectProxy({project,parentOrigin:url,assetDirectory:path.resolve(__dirname,'../../public')});Object.assign(preview,await proxy.start());await app.ready();
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1300,height:900}});
 t.after(async()=>{await browser.close();proxy.close();app.server.close();upstream.close();receiver.close();await fs.rm(directory,{recursive:true,force:true})});
 // Observe the real parent status messages. An initially empty success label
 // is not evidence that the receiver has accepted a submission.
 await page.addInitScript(()=>window.addEventListener('message',event=>{
  if(parent!==window&&event.data?.type==='live-delivery-status'&&event.source===parent&&event.origin===parent.location.origin)window.testDeliveryStatus=event.data;
 }));
 await page.goto(url);const composer=page.frameLocator('iframe[title="Voice and annotation composer"]'),projectFrame=page.frameLocator('#project-preview');
 await composer.locator('#chat-input').waitFor();await projectFrame.getByRole('button',{name:'Drag and select',exact:true}).waitFor();
 return {page,composer,projectFrame,received,app,setFailure:value=>{fail=value}};
}
async function draw(page,projectFrame){
 await projectFrame.getByRole('button',{name:'Drag and select',exact:true}).click();
 const box=await projectFrame.locator('#target').boundingBox();
 await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+160,box.y+100,{steps:6});await page.mouse.up();
}
async function waitForDelivered(page,composer,count){
 await page.waitForFunction(count=>{
  const frame=document.querySelector('iframe[title="Voice and annotation composer"]'),status=frame.contentWindow.testDeliveryStatus;
  return !status?.error&&status?.submissions?.length===count&&status.submissions.every(item=>item.status==='delivered')&&frame.contentDocument.querySelector('#chat-input').value==='';
 },count);
 const appearance=await composer.locator('#live-delivery-status').evaluate(node=>({text:node.textContent,height:node.getBoundingClientRect().height,display:getComputedStyle(node).display}));
 assert.deepEqual(appearance,{text:'',height:0,display:'none'},'Successful delivery must leave no label or layout gap');
 assert.equal(await composer.locator('#live-delivery-retry').isVisible(),false);
}
test('browser capture is visible, reloadable, and submitted as ordered JSON with actual PNG bytes',async t=>{
 const {page,composer,projectFrame,received,app}=await fixture(t);
 await draw(page,projectFrame);
 await composer.locator('#chat-attachments img').waitFor();
 const original=await composer.locator('#chat-attachments img').getAttribute('src');assert.match(original,/^data:image\/png;base64,/);
 await page.reload();await composer.locator('#chat-attachments img[src^="data:image/png"]').waitFor();assert.equal(await composer.locator('#chat-attachments img').getAttribute('src'),original);
 await composer.locator('#chat-input').fill('Please adjust [Image 1] and preserve this order.');await composer.locator('#chat-send').click();
 await waitForDelivered(page,composer,1);
 assert.equal(received.length,1);const bundle=received[0];assert.equal(bundle.prompt.schemaVersion,'live-annotation/v1');assert.equal(bundle.prompt.project.conversationId,'isolated-test-task');
 assert.deepEqual(bundle.prompt.content.map(part=>part.type),['text','image','text']);assert.equal(bundle.attachments[0].label,'Image 1');assert.equal(bundle.attachments[0].dataBase64,original.slice(22));
 const bytes=Buffer.from(bundle.attachments[0].dataBase64,'base64');assert.equal(bytes.readUInt32BE(16),140);assert.equal(bytes.readUInt32BE(20),80);
 const saved=await app.store.bundle(bundle.prompt.id);assert.equal(saved.prompt.id,bundle.prompt.id);const delivery=await app.store.read(bundle.prompt.id);assert.equal(delivery.status,'delivered');assert.equal(delivery.receiptId,'test-receipt:'+bundle.prompt.id);
});
test('receiver failure stays visible after later success and retry preserves its submission ID',async t=>{
 const {page,composer,received,app,setFailure}=await fixture(t);setFailure(true);
 await composer.locator('#chat-input').fill('First feedback must survive receiver failure');await composer.locator('#chat-send').click();
 await composer.locator('#live-delivery-status').getByText('Receiver returned HTTP 503',{exact:true}).waitFor();
 const failedId=received[0].prompt.id;assert.equal((await app.store.read(failedId)).status,'failed');setFailure(false);
 await page.reload();await composer.locator('#live-delivery-status').getByText('Receiver returned HTTP 503',{exact:true}).waitFor();
 await composer.locator('#chat-input').fill('Second feedback');await composer.locator('#chat-send').click();
 await page.waitForFunction(()=>document.querySelector('iframe[title="Voice and annotation composer"]').contentDocument.querySelector('#chat-input').value==='');
 await composer.locator('#live-delivery-status').getByText('Receiver returned HTTP 503',{exact:true}).waitFor();
 await composer.locator('#live-delivery-retry').waitFor({state:'visible'});await composer.locator('#live-delivery-retry').click();
 await waitForDelivered(page,composer,2);
 const retried=await app.store.read(failedId);assert.equal(retried.status,'delivered');assert.equal(retried.receiptId,'test-receipt:'+failedId);assert.equal(received.filter(bundle=>bundle.prompt.id===failedId).length,2);assert.equal(new Set(received.map(bundle=>bundle.prompt.id)).size,2);
});
test('missing persisted images and a missing chat bridge show recoverable errors instead of false success',async t=>{
 const {page,composer,projectFrame,received}=await fixture(t);await draw(page,projectFrame);await composer.locator('#chat-attachments img').waitFor();
 await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('live-annotation-captures');open.onsuccess=()=>{const db=open.result,tx=db.transaction('images','readwrite');tx.objectStore('images').clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}}));
 await page.reload();await composer.locator('#chat-activity').getByText(/unavailable/).waitFor();
 await composer.locator('#chat-input').fill('Keep this draft');await composer.locator('#chat-send').click();await composer.locator('#chat-activity').getByText(/Remove it and capture it again/).waitFor();
 assert.equal(await composer.locator('#chat-input').inputValue(),'Keep this draft');assert.equal(received.length,0);
 await composer.getByRole('button',{name:'Remove Image 1.png',exact:true}).click();
 await page.locator('iframe[title="Voice and annotation composer"]').evaluate(frame=>{delete frame.contentWindow.LiveAnnotationHost});
 await composer.locator('#chat-send').click();await composer.locator('#chat-activity').getByText(/chat connection did not load/).waitFor();assert.equal(await composer.locator('#chat-input').inputValue(),'Keep this draft');assert.equal(received.length,0);
});
test('navigation during screenshot persistence cannot resurrect a cancelled image',async t=>{
 const {page,composer,projectFrame}=await fixture(t);await composer.locator('#chat-input').fill('Preserve text across navigation');
 await page.evaluate(()=>{window.navigationMessages=[];addEventListener('message',event=>navigationMessages.push({type:event.data?.type,context:!!event.data?.context,source:event.source===document.querySelector('#project-preview').contentWindow}))});
 await page.evaluate(()=>{const original=studyCaptures.put.bind(studyCaptures),gate=new Promise(resolve=>window.releaseCaptureStorage=resolve);studyCaptures.put=async(...args)=>{window.captureStorageWaiting=true;await gate;await original(...args);window.captureStorageDone=true}});
 await draw(page,projectFrame);await page.waitForFunction(()=>window.captureStorageWaiting===true);
 await projectFrame.locator('body').evaluate(()=>location.assign('/next'));await projectFrame.locator('#target').waitFor();
 await composer.locator('#chat-send:not([disabled])').waitFor({timeout:5000}).catch(async error=>{t.diagnostic(JSON.stringify(await page.evaluate(()=>({messages:navigationMessages,url:document.querySelector('#project-preview').src}))));throw error});await page.evaluate(()=>window.releaseCaptureStorage());await page.waitForFunction(()=>window.captureStorageDone===true);
 assert.equal(await composer.locator('#chat-attachments img').count(),0);assert.equal(await composer.locator('#chat-input').inputValue(),'Preserve text across navigation');
});
