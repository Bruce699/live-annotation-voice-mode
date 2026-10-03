const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),os=require('node:os'),path=require('node:path'),fs=require('node:fs/promises');
const {spawnSync}=require('node:child_process');
const {parseOptions,resolveSetup,checkProject,doctor}=require('../lib/setup.cjs');
const root=path.resolve(__dirname,'..');

test('setup defaults project identity to the verified delivery task and rejects mismatches',()=>{
 const env={CODEX_THREAD_ID:'task-a',CODEX_APP_TOOLS_PIPE_PATH:'/host/pipe'};
 const a=resolveSetup({url:'http://localhost:3000',project:'Website'},'/tmp/data',env);
 const b=resolveSetup({url:'http://localhost:3000',project:'Website'},'/tmp/data',{...env,CODEX_THREAD_ID:'task-b'});
 assert.equal(a.delivery,'codex');assert.equal(a.project.conversationId,'task-a');assert.notEqual(a.directory,b.directory);
 const explicit=resolveSetup({url:'http://localhost:3000',thread:'task-c'},'/tmp/data',env);assert.equal(explicit.project.conversationId,'task-c');
 assert.throws(()=>resolveSetup({conversation:'wrong',url:'http://localhost:3000'},'/tmp/data',env),/must match/);
 assert.throws(()=>resolveSetup({delivery:'queue',thread:'task-c'},'/tmp/data',env),/require Codex/);
});
test('setup never silently falls back to a queue and validates receiver configuration',()=>{
 assert.throws(()=>resolveSetup({},'/tmp/data',{}),/No automatic chat connection/);
 assert.equal(resolveSetup({delivery:'queue'},'/tmp/data',{}).delivery,'queue');
 assert.throws(()=>resolveSetup({receiver:'http://example.com/submit'},'/tmp/data',{}),/HTTPS/);
 assert.throws(()=>resolveSetup({receiver:'https://example.com/submit','receiver-token-env':'MISSING'},'/tmp/data',{}),/empty/);
 assert.throws(()=>resolveSetup({receiver:'https://example.com/submit',delivery:'queue'},'/tmp/data',{}),/exactly one/);
});
test('mistyped options fail before launching a disconnected service',()=>{
 assert.throws(()=>parseOptions(['--reciever','http://localhost:1234']),/Unknown option/);
 assert.throws(()=>parseOptions(['--delivery']),/Expected a value/);
 assert.throws(()=>parseOptions(['--delivery','queue','--delivery','codex']),/Repeated option/);
 assert.deepEqual(parseOptions(['--delivery','queue','--json']),{delivery:'queue',json:true});
});
test('project preflight checks HTML and bounded local redirects without sending submissions',async t=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{location:'/page'});return res.end()}
  if(req.url==='/remote'){res.writeHead(302,{location:'https://example.com/'});return res.end()}
  if(req.url==='/api'){res.writeHead(200,{'content-type':'application/json'});return res.end('{}')}
  if(req.url==='/broken'){res.writeHead(503);return res.end()}
  res.writeHead(200,{'content-type':'text/html'});res.end('<p>Project</p>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const url='http://127.0.0.1:'+server.address().port;
 assert.equal((await checkProject({url:url+'/redirect'})).url,url+'/page');
 await assert.rejects(()=>checkProject({url:url+'/remote'}),/local HTTP/);
 await assert.rejects(()=>checkProject({url:url+'/api'}),/HTML page/);
 await assert.rejects(()=>checkProject({url:url+'/broken'}),/HTTP 503/);
});
test('doctor is read-only and reports a failed destination preflight',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-doctor-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const setup={delivery:'codex',threadId:'test-task',directory,project:null};let probes=0;
 const report=await doctor({setup,desktop:{async ready(){probes++;throw Error('Destination unavailable')}}});
 assert.equal(probes,1);assert.equal(report.ok,false);assert.equal(report.checks.find(c=>c.name==='Chat delivery').status,'error');
 assert.deepEqual(await fs.readdir(directory),[]);
});
test('the installed-style CLI doctor runs without voice compilation or message delivery',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'cli.cjs'),'doctor','--delivery','queue','--json'],{encoding:'utf8',timeout:15000,env:{...process.env,CODEX_THREAD_ID:'',CODEX_APP_TOOLS_PIPE_PATH:''}});
 assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.delivery,'queue');
 assert.match(report.checks.find(c=>c.name==='Chat delivery').detail,/Manual queue/);
});
test('standalone sessions isolate destinations and explicit queue conversations',()=>{
 const env={CODEX_THREAD_ID:'task-a',CODEX_APP_TOOLS_PIPE_PATH:'/host/pipe'};
 const a=resolveSetup({},'/tmp/data',env),b=resolveSetup({},'/tmp/data',{...env,CODEX_THREAD_ID:'task-b'});
 assert.notEqual(a.directory,b.directory);assert.notEqual(a.sessionId,b.sessionId);assert.equal(a.project,null);
 assert.equal(resolveSetup({delivery:'queue'},'/tmp/data',env).directory,a.directory);
 const queue=resolveSetup({delivery:'queue',conversation:'independent'},'/tmp/data',{});assert.notEqual(queue.directory,'/tmp/data');
 assert.equal(resolveSetup({delivery:'queue'},'/tmp/data',{}).directory,'/tmp/data');
});
test('a session lock excludes concurrent starts and recovers a dead owner',async t=>{
 const {acquireSessionLock}=require('../lib/setup.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-lock-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const release=acquireSessionLock(directory);assert.throws(()=>acquireSessionLock(directory),/already running or starting/);release();
 const child=spawnSync(process.execPath,['-e',''],{encoding:'utf8'});assert.equal(child.status,0);
 await fs.writeFile(path.join(directory,'.service-lock'),JSON.stringify({pid:child.pid,token:'dead-owner'}));
 const releaseRecovered=acquireSessionLock(directory);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'.service-lock'),'utf8')).pid,process.pid);releaseRecovered();
 assert.deepEqual(await fs.readdir(directory),[]);
});
test('the direct-launch command preserves literal shell characters in project arguments',async t=>{
 const {runtimeCommand}=require('../lib/setup.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'annotation-shell-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const script=path.join(directory,"cli 'quoted'.cjs"),sentinel=path.join(directory,'unexpected');
 await fs.writeFile(script,'console.log(JSON.stringify(process.argv.slice(2)))');
 const argument="Project 'name' $(touch "+sentinel+") `touch "+sentinel+'`';
 const result=spawnSync('/bin/sh',['-c',runtimeCommand([process.execPath,script,'--project',argument])],{encoding:'utf8',env:{...process.env,CODEX_MCP_NODE_PATH:process.execPath}});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['--project',argument]);await assert.rejects(()=>fs.stat(sentinel),{code:'ENOENT'});
});
