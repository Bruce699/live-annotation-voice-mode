const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCodexDesktop,McpClient}=require('../lib/codex-desktop.cjs');
async function setup(t,{fail=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-codex-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const calls=[],client={connect:async()=>{},request:async()=>({tools:[{name:'read_thread'},{name:'send_message_to_thread'}]}),call:async(name,args,caller)=>{calls.push({name,args,caller});if(name==='send_message_to_thread'&&fail)throw Error('Lost acknowledgment');return {content:[{type:'text',text:JSON.stringify(name==='read_thread'?{schemaVersion:'1',thread:{id:args.threadId,kind:'codex',hostId:'local'}}:{threadId:args.threadId,status:'queued'})}]}},close(){}};
 return {directory,calls,client,adapter:createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client})};
}
const bundle=()=>({prompt:{id:crypto.randomUUID(),schemaVersion:'live-annotation/v1',transcript:'Change this [Image 3]',project:{conversationId:'untrusted-target'},content:[{type:'image',label:'Image 3'}]},attachments:[{id:'screenshot',label:'Image 3',absolutePath:'/tmp/annotation test/Image 3.png'}]});
test('desktop preflight validates destination and sends structured prompt plus labeled image paths to that exact task',async t=>{
 const {adapter,calls}=await setup(t);await adapter.ready();assert.equal(calls[0].name,'read_thread');const input=bundle(),receipt=await adapter.submit(input);
 const send=calls[1];assert.equal(send.name,'send_message_to_thread');assert.equal(send.args.threadId,'destination-task');assert.equal(send.caller,'launching-task');assert.deepEqual(Object.keys(send.args).sort(),['prompt','threadId']);
 const received=JSON.parse(send.args.prompt.slice(send.args.prompt.indexOf('\n\n')+2));assert.deepEqual(received.prompt,input.prompt);assert.deepEqual(received.attachments,input.attachments);assert.equal(receipt.submissionId,input.prompt.id);
});
test('persisted desktop receipts prevent repeat sends across adapter restarts',async t=>{
 const {adapter,client,directory,calls}=await setup(t),input=bundle();const first=await adapter.submit(input);
 const restarted=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client});const second=await restarted.submit(input);assert.equal(second.receiptId,first.receiptId);assert.equal(calls.filter(c=>c.name==='send_message_to_thread').length,1);
});
test('uncertain desktop acceptance stays saved and is never blindly sent twice',async t=>{
 const {adapter,calls,directory}=await setup(t,{fail:true}),input=bundle();await assert.rejects(()=>adapter.submit(input),/Lost acknowledgment/);await assert.rejects(()=>adapter.submit(input),/uncertain/);assert.equal(calls.filter(c=>c.name==='send_message_to_thread').length,1);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'codex-receipts',input.prompt.id,'intent.json'))).threadId,'destination-task');
});
test('desktop setup requires destination and verifies host tool availability',async t=>{
 assert.throws(()=>createCodexDesktop({threadId:'',callerThreadId:'task'}),/required/);const {client,directory}=await setup(t);client.request=async()=>({tools:[]});const adapter=createCodexDesktop({threadId:'task',callerThreadId:'task',directory,client});await assert.rejects(()=>adapter.ready(),/does not expose/);
});
test('MCP client initializes, correlates responses and reports rejected calls',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-mcp-')),file=path.join(directory,'fake.cjs');
 await fs.writeFile(file,`require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:'2024-11-05'}:m.method==='tools/list'?{tools:[]}:{isError:true,content:[{type:'text',text:'Destination unavailable'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}))})`);
 const client=new McpClient(file,{env:{...process.env,CODEX_MCP_NODE_PATH:process.execPath}});t.after(async()=>{client.close();await fs.rm(directory,{recursive:true,force:true})});await client.connect();assert.deepEqual(await client.request('tools/list',{}),{tools:[]});await assert.rejects(()=>client.call('send_message_to_thread',{threadId:'task'},'task'),/Destination unavailable/);
});
test('a success-shaped host response for another task is not treated as delivery',async t=>{
 const {client,directory}=await setup(t);client.call=async name=>({content:[{type:'text',text:JSON.stringify({threadId:name==='read_thread'?'destination-task':'wrong-task'})}]});const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client});await assert.rejects(()=>adapter.submit(bundle()),/did not acknowledge/);
});

test('failed preflight cannot accidentally enable sending and can be retried after reconnecting',async t=>{
 const {client,directory,calls}=await setup(t),original=client.call;let available=false;
 client.call=async(name,...args)=>{if(name==='read_thread'&&!available)throw Error('Task unavailable');return original(name,...args)};
 const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client}),input=bundle();
 await assert.rejects(()=>adapter.ready(),/Task unavailable/);await assert.rejects(()=>adapter.submit(input),/Task unavailable/);assert.equal(calls.length,0);
 available=true;await adapter.submit(input);assert.deepEqual(calls.map(call=>call.name),['read_thread','send_message_to_thread']);
});
test('preflight rejects a successful response for a different destination',async t=>{
 const {client,directory}=await setup(t);client.call=async()=>({structuredContent:{thread:{id:'wrong-task'}}});
 const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client});
 await assert.rejects(()=>adapter.ready(),/could not verify/);
});
test('a proven pre-send connection failure allows a safe retry using the same submission',async t=>{
 const {client,directory,calls}=await setup(t),original=client.call;let connected=false;
 client.call=async(name,...args)=>{if(name==='send_message_to_thread'&&!connected){const error=Error('Connection failed before send');error.notSent=true;throw error}return original(name,...args)};
 const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client}),input=bundle();
 await assert.rejects(()=>adapter.submit(input),/before send/);connected=true;await adapter.submit(input);
 assert.equal(calls.filter(call=>call.name==='send_message_to_thread').length,1);
});
test('structured host receipts are accepted, while explicit failed acknowledgments are rejected',async t=>{
 const {client,directory}=await setup(t);let failed=true;
 client.call=async(name,args)=>({structuredContent:name==='read_thread'?{thread:{id:args.threadId}}:{threadId:args.threadId,status:failed?'failed':'queued',messageId:'host-message-123'}});
 const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client});
 await assert.rejects(()=>adapter.submit(bundle()),/did not acknowledge/);failed=false;
 assert.equal((await adapter.submit(bundle())).receiptId,'host-message-123');
});
test('desktop message preserves the protocol prompt and separates attachment locations from metadata',async t=>{
 const {Store}=require('../lib/store.cjs'),{directory,adapter,calls}=await setup(t),store=new Store(directory);
 const input={id:crypto.randomUUID(),text:'Fix this [Image 3]',images:[{id:crypto.randomUUID(),number:3,kind:'rectangle',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNwaPhAEmIY1TCqYfhqAAD5vLAQg01R4wAAAABJRU5ErkJggg=='}]};
 await store.save(input);const saved=await store.bundle(input.id);await adapter.submit(saved);
 const message=calls.find(call=>call.name==='send_message_to_thread').args.prompt,received=JSON.parse(message.slice(message.indexOf('\n\n')+2));
 assert.deepEqual(received.prompt,saved.prompt);assert.equal(received.prompt.attachments[0].absolutePath,undefined);assert.equal(received.attachments[0].absolutePath,saved.attachments[0].absolutePath);
 assert.equal(await fs.readFile(received.attachments[0].absolutePath,'base64'),input.images[0].data.slice(22));assert.equal(received.prompt.content[1].label,'Image 3');
});
