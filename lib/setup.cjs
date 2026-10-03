const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {projectOptions,projectDirectory}=require('./project.cjs');

const allowed=new Set(['url','project','conversation','port','preview-port','receiver','receiver-token-env','delivery','thread','codex-tools-server','directory','timeout','id','claim','receipt','json']);
function parseOptions(args){
 const result={};
 for(let i=0;i<args.length;i++){
  const key=args[i].startsWith('--')?args[i].slice(2):'';
  if(!allowed.has(key))throw Error('Unknown option: '+args[i]);
  if(key in result)throw Error('Repeated option: --'+key);
  if(key==='json'){result.json=true;continue}
  if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Expected a value for --'+key);
  result[key]=args[++i];
 }
 return result;
}
function sessionIdFor(project,conversationId){return project?.id||(conversationId?crypto.createHash('sha256').update(String(conversationId)).digest('hex').slice(0,24):null)}
function sessionDirectory(base,project,conversationId){return project?projectDirectory(base,project):conversationId?path.join(base,'sessions',sessionIdFor(null,conversationId)):base}
function shellQuote(value){return "'"+String(value).replace(/'/g,"'\"'\"'")+"'"}
function runtimeCommand(argv=process.argv){return '"$CODEX_MCP_NODE_PATH" '+[path.resolve(argv[1]),...argv.slice(2)].map(shellQuote).join(' ')}
function resolveSetup(opts,baseDirectory,env=process.env){
 const delivery=opts.delivery||(opts.receiver?'webhook':env.CODEX_THREAD_ID&&env.CODEX_APP_TOOLS_PIPE_PATH?'codex':null);
 if(!['codex','webhook','queue'].includes(delivery))throw Error('No automatic chat connection found. Launch from the active Codex desktop task, configure --receiver URL for your agent, or explicitly choose --delivery queue for manual receiving.');
 if(opts.receiver&&delivery!=='webhook'||delivery==='webhook'&&!opts.receiver)throw Error('Choose exactly one delivery destination');
 if(delivery!=='codex'&&(opts.thread||opts['codex-tools-server']))throw Error('--thread and --codex-tools-server require Codex delivery');
 if(opts['receiver-token-env']&&!opts.receiver)throw Error('--receiver-token-env requires --receiver');
 if(opts['receiver-token-env']&&!env[opts['receiver-token-env']])throw Error('Receiver token environment variable is empty');
 if(opts.receiver){
  const receiver=new URL(opts.receiver);
  if(!['http:','https:'].includes(receiver.protocol)||receiver.username||receiver.password)throw Error('Receiver must be an HTTP(S) URL without embedded credentials');
  if(receiver.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(receiver.hostname))throw Error('Remote receivers require HTTPS');
 }
 const threadId=delivery==='codex'?(opts.thread||env.CODEX_THREAD_ID):null;
 if(delivery==='codex'&&!threadId)throw Error('A real Codex task ID is required');
 if(delivery==='codex'&&opts.conversation&&opts.conversation!==threadId)throw Error('--conversation must match the Codex delivery task. Use --thread only for an explicitly selected destination.');
 const conversationId=opts.conversation||threadId||env.CODEX_THREAD_ID;
 const project=projectOptions({...opts,conversation:conversationId}),sessionId=sessionIdFor(project,conversationId);
 return {delivery,threadId,project,sessionId,directory:sessionDirectory(baseDirectory,project,conversationId)};
}
function sameExecutable(a,b){try{return fs.realpathSync(a)===fs.realpathSync(b)}catch{return a===b}}
function ensureDesktopRuntime(delivery,argv=process.argv,env=process.env){
 if(delivery!=='codex')return;
 const runtime=env.CODEX_MCP_NODE_PATH;
 if(!runtime||!fs.existsSync(runtime))throw Error('The Codex desktop runtime is unavailable. Start from the current Codex desktop task, or configure a real --receiver.');
 if(sameExecutable(runtime,process.execPath))return;
 // The desktop authenticates the launching process. Spawning its Node as a child
 // leaves an untrusted parent in the chain; replace this process instead.
 if(typeof process.execve==='function'){
  process.execve(runtime,[runtime,...argv.slice(1)],env);
  throw Error('Could not switch to the Codex desktop runtime');
 }
 throw Error('Codex desktop requires its runtime. Run directly from this chat: '+runtimeCommand(argv));
}
function acquireSessionLock(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,'.service-lock'),token=crypto.randomUUID();
 for(let attempt=0;attempt<3;attempt++){
  try{
   const fd=fs.openSync(file,'wx',0o600);
   try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}))}finally{fs.closeSync(fd)}
   return ()=>{try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file)}catch{}};
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner,stat;
   try{stat=fs.statSync(file);owner=JSON.parse(fs.readFileSync(file,'utf8'))}catch{throw Error('This annotation session is already starting. Reuse its workspace or retry after it finishes starting.')}
   if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('The annotation session lock is invalid: '+file);
   try{process.kill(owner.pid,0);throw Error('This annotation session is already running or starting (process '+owner.pid+'). Reuse its workspace or stop its service before restarting.')}catch(error){if(error.code!=='ESRCH')throw error}
   // Recover only a dead owner, and never remove a replacement owner's lock.
   try{if(fs.statSync(file).ino===stat.ino&&JSON.parse(fs.readFileSync(file,'utf8')).token===owner.token)fs.unlinkSync(file)}catch(error){if(error.code!=='ENOENT')throw error}
  }
 }
 throw Error('Another process is starting this annotation session. Retry after it finishes.');
}
async function checkProject(project,{fetchImpl=fetch}={}){
 if(!project)return null;
 let url=project.url;
 for(let i=0;i<6;i++){
  projectOptions({url}); // Never follow a local preview redirect onto a remote site.
  const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(8000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!location)throw Error('Project redirect has no destination');
   url=new URL(location,url).href;continue;
  }
  await response.body?.cancel();
  if(!response.ok)throw Error('Project preview returned HTTP '+response.status+'. Start its dev server and pass the working --url.');
  if(!(response.headers.get('content-type')||'').includes('text/html'))throw Error('Project URL must serve an HTML page, not an API or asset.');
  if(new URL(url).origin!==new URL(project.url).origin)throw Error('Project redirects to a different local origin. Use its final URL: '+url);
  return {url,status:response.status};
 }
 throw Error('Project preview redirects too many times');
}
function voiceCheck(){
 if(process.platform!=='darwin')return {available:false,detail:'Dictation requires macOS; screenshot and text feedback are available.'};
 try{execFileSync('/usr/bin/xcrun',['--find','swiftc'],{stdio:'pipe',timeout:10000});return {available:true,detail:'Swift compiler available; microphone and speech permissions are checked when recording.'}}
 catch{return {available:false,detail:'Install Xcode Command Line Tools for dictation. Screenshot and text feedback are available.'}}
}
async function doctor({setup,desktop,root=path.resolve(__dirname,'..')}){
 const checks=[];
 const add=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'ok',detail})}catch(error){checks.push({name,status:'error',detail:error.message})}};
 await add('Node',()=>{if(Number(process.versions.node.split('.')[0])<20)throw Error('Node.js 20 or newer is required');return process.version});
 await add('Installed assets',()=>{for(const file of ['index.html','host.js','sidebar-assets.json','website-annotations.js','html2canvas.min.js','project-bridge.js'])if(!fs.existsSync(path.join(root,'public',file)))throw Error('Missing packaged asset: '+file);return 'Capture, composer and project bridge assets are present'});
 if(setup.project)await add('Project',async()=>{const result=await checkProject(setup.project);return result.url+' (HTTP '+result.status+')'});
 if(desktop)await add('Chat delivery',async()=>{await desktop.ready();return 'Verified Codex task '+setup.threadId+'; no message sent'});
 else checks.push({name:'Chat delivery',status:'warning',detail:setup.delivery==='queue'?'Manual queue selected; Submit saves locally until a receiver accepts it.':'Receiver configured; delivery is confirmed only by a receipt after Submit.'});
 const voice=voiceCheck();checks.push({name:'Dictation',status:voice.available?'ok':'warning',detail:voice.detail});
 return {ok:checks.every(check=>check.status!=='error'),delivery:setup.delivery,threadId:setup.threadId,project:setup.project,directory:setup.directory,checks};
}
module.exports={parseOptions,resolveSetup,ensureDesktopRuntime,checkProject,voiceCheck,doctor,sessionIdFor,sessionDirectory,shellQuote,runtimeCommand,acquireSessionLock};
