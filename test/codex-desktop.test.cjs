const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCodexDesktop,McpClient}=require('../lib/codex-desktop.cjs');
async function setup(t,{fail=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-codex-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const calls=[],client={connect:async()=>{},request:async()=>({tools:[{name:'read_thread'},{name:'send_message_to_thread'}]}),call:async(name,args,caller)=>{calls.push({name,args,caller});if(name==='send_message_to_thread'&&fail)throw Error('Lost acknowledgment');return {content:[{type:'text',text:JSON.stringify({threadId:args.threadId,status:'queued'})}]}},close(){}};
 return {directory,calls,client,adapter:createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client})};
}
const bundle=()=>({prompt:{id:crypto.randomUUID(),schemaVersion:'live-annotation/v1',transcript:'Change this [Image 3]',project:{conversationId:'untrusted-target'},content:[{type:'image',label:'Image 3'}]},attachments:[{id:'screenshot',label:'Image 3',absolutePath:'/tmp/annotation test/Image 3.png'}]});
test('desktop preflight validates destination and sends structured prompt plus labeled image paths to that exact task',async t=>{
 const {adapter,calls}=await setup(t);await adapter.ready();assert.equal(calls[0].name,'read_thread');const input=bundle(),receipt=await adapter.submit(input);
 const send=calls[1];assert.equal(send.name,'send_message_to_thread');assert.equal(send.args.threadId,'destination-task');assert.equal(send.caller,'launching-task');assert.deepEqual(Object.keys(send.args).sort(),['prompt','threadId']);
 const received=JSON.parse(send.args.prompt.slice(send.args.prompt.indexOf('\n\n')+2));assert.equal(received.transcript,input.prompt.transcript);assert.deepEqual(received.attachments,input.attachments);assert.equal(receipt.submissionId,input.prompt.id);
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
 const {client,directory}=await setup(t);client.call=async()=>({content:[{type:'text',text:JSON.stringify({threadId:'wrong-task'})}]});const adapter=createCodexDesktop({threadId:'destination-task',callerThreadId:'launching-task',directory,client});await assert.rejects(()=>adapter.submit(bundle()),/did not acknowledge/);
});
