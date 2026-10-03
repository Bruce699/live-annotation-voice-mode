#!/usr/bin/env node
const fs=require('node:fs/promises'),path=require('node:path');
const {createCodexDesktop}=require('./lib/codex-desktop.cjs');
const {createServer,DEFAULT_DIRECTORY}=require('./server.cjs');
const {projectOptions}=require('./lib/project.cjs'),{createProjectProxy}=require('./lib/project-proxy.cjs');
const {parseOptions,resolveSetup,ensureDesktopRuntime,checkProject,doctor,sessionDirectory,shellQuote,runtimeCommand,acquireSessionLock}=require('./lib/setup.cjs');
async function main(){
 const [command='start',...args]=process.argv.slice(2);
 if(['help','--help','-h'].includes(command)){console.log('Live Annotation\n  start [--url http://localhost:3000 --project NAME --conversation ID] [--port 47832] [--receiver URL | --delivery codex | --delivery queue] [--thread ID]\n  doctor [same connection/project options as start] [--json]\n  receive --directory PATH [--timeout 60]\n  ack --directory PATH --id UUID --claim TOKEN --receipt ID\n  status --directory PATH\n  retry --directory PATH --id UUID\n\nCodex desktop uses the current task automatically. Doctor checks readiness without sending a message.');return}
 if(!['start','doctor','receive','ack','status','retry'].includes(command))throw Error('Commands: start, doctor, receive, ack, status, retry');
 const opts=parseOptions(args),baseDirectory=path.resolve(opts.directory||DEFAULT_DIRECTORY);
 const setup=['start','doctor'].includes(command)?resolveSetup(opts,baseDirectory):null;
 const conversationId=opts.conversation||opts.thread||process.env.CODEX_THREAD_ID;
 const project=setup?.project||projectOptions({...opts,conversation:conversationId}),directory=setup?.directory||(opts.directory&&!project?baseDirectory:sessionDirectory(baseDirectory,project,conversationId));
 const file=path.join(directory,'service.json');
 if(setup){
  ensureDesktopRuntime(setup.delivery);
  const desktop=setup.delivery==='codex'?createCodexDesktop({threadId:setup.threadId,serverFile:opts['codex-tools-server'],directory}):null;
  if(command==='doctor'){
   try{const report=await doctor({setup,desktop});if(!report.ok&&process.env.npm_execpath&&report.checks.some(check=>check.name==='Chat delivery'&&check.status==='error'))report.checks.push({name:'Direct launch',status:'warning',detail:'npm/npx may leave a runtime the desktop cannot authenticate. Run directly from the current chat: '+runtimeCommand()});console.log(opts.json?JSON.stringify(report,null,2):report.checks.map(check=>check.status.toUpperCase()+' '+check.name+': '+check.detail).join('\n')+'\nData directory: '+directory);if(!report.ok)process.exitCode=1}finally{desktop?.close()}return;
  }
  const port=Number(opts.port||47832);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port from 1024 to 65535');
  const previewPort=Number(opts['preview-port']||0);if(!Number.isInteger(previewPort)||previewPort<0||previewPort>65535)throw Error('Invalid preview port');
  const {delivery}=setup;
  let proxy,preview,instance,releaseSession;
  try{
  releaseSession=acquireSessionLock(directory);
  // Do not overwrite an existing service's identity/token for the same draft store.
  let activeService;
  try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(saved.url)){const response=await fetch(saved.url+'/api/status',{headers:{'X-Study-Token':saved.token},signal:AbortSignal.timeout(1500)});if(response.ok)activeService=saved.url}}catch{}
  if(activeService)throw Error('This annotation session is already running at '+activeService+'. Reuse that workspace or stop its service before restarting.');
  if(desktop)await desktop.ready();
  await checkProject(project);
  let voiceAvailable=false;
  if(process.platform==='darwin'){try{require('./scripts/build-voice.cjs').buildVoice();voiceAvailable=true}catch{console.error('Dictation is unavailable: install Xcode Command Line Tools and restart to enable it. Screenshots, text, and chat delivery remain available.')}}
  if(project){
   if(new URL(project.url).port===String(port))throw Error('Project and annotation service must use different ports');
   proxy=createProjectProxy({project,parentOrigin:'http://localhost:'+port,assetDirectory:path.join(__dirname,'public')});preview=await proxy.start(previewPort);
  }
  try{instance=createServer({directory,project,preview,sessionId:setup.sessionId,voiceAvailable,submit:desktop?.submit,deliveryMode:delivery,webhook:opts.receiver,webhookToken:opts['receiver-token-env']?process.env[opts['receiver-token-env']]:null})}catch(error){proxy?.close();throw error}
  await instance.ready();
  await new Promise((resolve,reject)=>{instance.server.once('error',error=>{proxy?.close();reject(error.code==='EADDRINUSE'?Error('Annotation port '+port+' is in use. Reuse its workspace or choose another --port.'):error)});instance.server.listen(port,'127.0.0.1',resolve)});
  await fs.mkdir(directory,{recursive:true,mode:0o700});const service={url:'http://localhost:'+port,token:instance.token,pid:process.pid,project,preview,sessionId:setup.sessionId,delivery,threadId:desktop?.threadId};await fs.writeFile(file+'.tmp',JSON.stringify(service),{mode:0o600});await fs.rename(file+'.tmp',file);
  console.log('Live Annotation: '+service.url);if(project)console.log('Project: '+project.name+' · '+project.url+'\nConversation: '+project.conversationId);console.log('Data directory: '+directory);console.log(desktop?'Connected to Codex task '+desktop.threadId+'; Submit sends to this task.':opts.receiver?'Receiver configured; Submit sends immediately and delivery requires its receipt.':'Manual queue: Submit saves locally. Receive with: node '+shellQuote(__filename)+' receive --directory '+shellQuote(directory));
  const stop=async()=>{desktop?.close();instance.voice.close();instance.server.close();proxy?.close();try{const saved=JSON.parse(await fs.readFile(file));if(saved.token===service.token)await fs.unlink(file)}catch{}releaseSession?.();setTimeout(()=>process.exit(0),300).unref()};process.on('SIGINT',stop);process.on('SIGTERM',stop);return;
  }catch(error){desktop?.close();proxy?.close();instance?.voice.close();instance?.server.close();releaseSession?.();if(process.env.npm_execpath&&/Codex desktop connection closed/.test(error.message))error.message+=' Run directly from the current chat: '+runtimeCommand();throw error}
 }
 const service=JSON.parse(await fs.readFile(file,'utf8'));
 const api=async(route,data)=>{const response=await fetch(service.url+'/api/'+route,{method:data?'POST':'GET',headers:{'X-Study-Token':service.token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(10000)});const value=await response.json();if(!response.ok)throw Error(value.error);return value};
 if(command==='status'){console.log(JSON.stringify(await api('status'),null,2));return}
 if(command==='receive'){
  const timeout=Number(opts.timeout||60);if(!Number.isFinite(timeout)||timeout<0||timeout>300)throw Error('Timeout must be 0–300 seconds');const until=Date.now()+timeout*1000;
  do{const result=await api('claim',{});if(result.submission){console.log(JSON.stringify(result,null,2));return}if(Date.now()>=until)break;await new Promise(resolve=>setTimeout(resolve,500))}while(true);
  console.log(JSON.stringify({submission:null}));return;
 }
 if(command==='ack'){console.log(JSON.stringify(await api('ack',{id:opts.id,claimToken:opts.claim,receiptId:opts.receipt})));return}
 if(command==='retry'){console.log(JSON.stringify(await api('retry',{id:opts.id})));return}
 throw Error('Commands: start, receive, ack, status, retry');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});
module.exports={main};
