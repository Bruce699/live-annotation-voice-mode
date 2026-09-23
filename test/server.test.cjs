const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../server.cjs'),{createReceiver}=require('../examples/receiver.cjs');
class Voice{constructor(emit){this.emit=emit}start({id}){this.id=id;this.emit({id,type:'ready'})}stop(id){this.emit({id,type:'done'})}close(){}}
const draft=()=>({id:crypto.randomUUID(),text:'Make this smaller',images:[],notes:[]});
async function setup(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-service-'));const instance=createServer({directory,Voice,voiceAvailable:true,...options});
 await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+instance.server.address().port;
 t.after(async()=>{await new Promise(resolve=>instance.server.close(resolve));await fs.rm(directory,{recursive:true,force:true})});
 return {...instance,url,api:async(route,data,headers={})=>{const response=await fetch(url+'/api/'+route,{method:data?'POST':'GET',headers:{'X-Study-Token':instance.token,'Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});return {...await response.json(),httpStatus:response.status}}};
}
async function until(read,accept){for(let i=0;i<100;i++){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out')}
test('local page and API reject cross-origin access and no token',async t=>{
 const app=await setup(t);assert.equal((await fetch(app.url)).status,200);assert.equal((await fetch(app.url+'/api/status')).status,403);assert.equal((await app.api('submissions',draft(),{Origin:'https://evil.test'})).httpStatus,403);assert.equal((await fetch(app.url,{headers:{Host:'evil.test','Sec-Fetch-Site':'cross-site'}})).status,403);
});
test('claim is exclusive, receipt is required, retry after acknowledgment stays delivered',async t=>{
 const app=await setup(t),input=draft();assert.equal((await app.api('submissions',input)).httpStatus,202);
 const result=await Promise.all([app.api('claim',{}),app.api('claim',{})]);const claim=result.find(r=>r.submission);assert.ok(claim);assert.equal(result.filter(r=>r.submission).length,1);
 assert.equal((await app.api('ack',{id:input.id,claimToken:'wrong',receiptId:'test'})).httpStatus,409);
 assert.equal((await app.api('ack',{id:input.id,claimToken:claim.claimToken,receiptId:'turn-123'})).httpStatus,200);
 assert.equal((await app.api('submissions',input)).httpStatus,202);assert.equal((await app.store.read(input.id)).status,'delivered');assert.equal((await app.api('claim',{})).submission,null);
});
test('push sends actual labeled image bytes and accepts only the destination receipt, without duplicates',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-receiver-'));let calls=0,received;
 const receiver=createReceiver({directory,token:'test-token',submit:async bundle=>{calls++;received=bundle;return 'real-test-turn'}});
 await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(r=>receiver.close(r));await fs.rm(directory,{recursive:true,force:true})});
 const app=await setup(t,{webhook:'http://127.0.0.1:'+receiver.address().port+'/prompt',webhookToken:'test-token'});
 const bytes='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNwaPhAEmIY1TCqYfhqAAD5vLAQg01R4wAAAABJRU5ErkJggg==';
 const input={...draft(),text:'Here [Image 7]',images:[{id:crypto.randomUUID(),number:7,kind:'laser',data:'data:image/png;base64,'+bytes}]};
 await app.api('submissions',input);await until(()=>app.store.read(input.id),s=>s.status==='delivered');assert.equal(calls,1);assert.equal(received.images[0].label,'Image 7');assert.equal(await fs.readFile(received.images[0].path,'base64'),bytes);assert.equal(received.prompt.content[1].label,'Image 7');
 await app.api('submissions',input);assert.equal(calls,1);assert.equal((await app.store.read(input.id)).receiptId,'real-test-turn');
});
test('failed push retains the bundle and successful explicit retry uses the same id',async t=>{
 let ready=false,ids=[];const http=require('node:http');const receiver=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const id=JSON.parse(raw).prompt.id;ids.push(id);res.writeHead(ready?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({submissionId:id,receiptId:'accepted'}))});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>receiver.close(r)));
 const app=await setup(t,{webhook:'http://127.0.0.1:'+receiver.address().port}),input=draft();await app.api('submissions',input);await until(()=>app.store.read(input.id),s=>s.status==='failed');assert.equal((await app.store.bundle(input.id)).prompt.transcript,input.text);
 ready=true;await app.api('retry',{id:input.id});await until(()=>app.store.read(input.id),s=>s.status==='delivered');assert.deepEqual(ids,[input.id,input.id]);
});
test('voice lifecycle remains available independently from delivery',async t=>{
 const app=await setup(t),id=crypto.randomUUID();assert.equal((await app.api('voice/start',{id,locale:'en-US'})).httpStatus,200);assert.equal((await app.api('voice/events?id='+id)).events[0].type,'ready');await app.api('voice/stop',{id});assert.equal((await app.api('voice/events?id='+id)).done,true);
});
test('submissions arriving during an active push are delivered without requiring a third submission',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),ids=[];const http=require('node:http');const receiver=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const id=JSON.parse(raw).prompt.id;ids.push(id);if(ids.length===1)await gate;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({submissionId:id,receiptId:'turn-'+ids.length}))});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>receiver.close(r)));
 const app=await setup(t,{webhook:'http://127.0.0.1:'+receiver.address().port}),a=draft(),b=draft();await app.api('submissions',a);await until(async()=>ids.length,n=>n===1);await app.api('submissions',b);release();await until(()=>app.store.read(b.id),s=>s.status==='delivered');assert.deepEqual(ids,[a.id,b.id]);
});
test('server owns project routing and ignores browser-supplied conversation overrides',async t=>{
 const project={id:'project-a',name:'Project A',url:'http://localhost:3000/',conversationId:'task-a'},app=await setup(t,{project}),input={...draft(),project:{id:'evil',conversationId:'task-b'}};await app.api('submissions',input);const bundle=await app.store.bundle(input.id);assert.deepEqual(bundle.prompt.project,project);assert.equal((await app.api('status')).project.conversationId,'task-a');
});
test('connected desktop delivery sends on Submit without a polling agent, preserving local screenshots',async t=>{
 let received;const app=await setup(t,{deliveryMode:'codex',submit:async bundle=>{received=bundle;return {submissionId:bundle.prompt.id,receiptId:'desktop-accepted'}}});
 const bytes='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNwaPhAEmIY1TCqYfhqAAD5vLAQg01R4wAAAABJRU5ErkJggg==';
 const input={...draft(),text:'Here [Image 3]',images:[{id:crypto.randomUUID(),number:3,kind:'rectangle',data:'data:image/png;base64,'+bytes}]};
 await app.api('submissions',input);await until(()=>app.store.read(input.id),s=>s.status==='delivered');assert.equal(received.prompt.transcript,input.text);assert.equal(received.attachments[0].label,'Image 3');assert.equal(await fs.readFile(received.attachments[0].absolutePath,'base64'),bytes);assert.equal((await app.api('status')).mode,'codex');assert.equal((await app.api('claim',{})).httpStatus,409);
});
