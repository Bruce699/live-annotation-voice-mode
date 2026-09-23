#!/usr/bin/env node
const fs=require('node:fs/promises'),path=require('node:path');
const {createCodexDesktop}=require('./lib/codex-desktop.cjs');
const {createServer,DEFAULT_DIRECTORY}=require('./server.cjs');
const {projectOptions,projectDirectory}=require('./lib/project.cjs'),{createProjectProxy}=require('./lib/project-proxy.cjs');
function options(args){const result={};for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('Expected --option value');result[args[i].slice(2)]=args[++i]}return result}
async function main(){
 const [command='start',...args]=process.argv.slice(2);
 if(['help','--help','-h'].includes(command)){console.log('Live Annotation\n  start [--url http://localhost:3000 --project NAME --conversation ID] [--port 47832] [--receiver URL | --delivery codex | --delivery queue] [--thread ID]\n  receive --directory PATH [--timeout 60]\n  ack --directory PATH --id UUID --claim TOKEN --receipt ID\n  status --directory PATH\n  retry --directory PATH --id UUID');return}
 const opts=options(args),baseDirectory=path.resolve(opts.directory||DEFAULT_DIRECTORY),project=projectOptions(opts),directory=projectDirectory(baseDirectory,project);
 const file=path.join(directory,'service.json');
 if(command==='start'){
  const port=Number(opts.port||47832);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port from 1024 to 65535');
  const previewPort=Number(opts['preview-port']||0);if(!Number.isInteger(previewPort)||previewPort<0||previewPort>65535)throw Error('Invalid preview port');
  if(opts['receiver-token-env']&&!process.env[opts['receiver-token-env']])throw Error('Receiver token environment variable is empty');
  const delivery=opts.delivery||(opts.receiver?'webhook':process.env.CODEX_THREAD_ID&&process.env.CODEX_APP_TOOLS_PIPE_PATH?'codex':null);
  if(!['codex','webhook','queue'].includes(delivery))throw Error('Connect a --receiver URL, start from Codex desktop, or explicitly choose --delivery queue for manual receiving.');
  if(opts.receiver&&delivery!=='webhook'||delivery==='webhook'&&!opts.receiver)throw Error('Choose exactly one delivery destination');
  const desktop=delivery==='codex'?createCodexDesktop({threadId:opts.thread||process.env.CODEX_THREAD_ID,serverFile:opts['codex-tools-server'],directory}):null;
  let proxy,preview,instance;
  try{
  if(desktop)await desktop.ready();
  if(process.platform==='darwin')require('./scripts/build-voice.cjs').buildVoice();
  if(project){
   if(new URL(project.url).port===String(port))throw Error('Project and annotation service must use different ports');
   proxy=createProjectProxy({project,parentOrigin:'http://localhost:'+port,assetDirectory:path.join(__dirname,'public')});preview=await proxy.start(previewPort);
  }
  try{instance=createServer({directory,project,preview,submit:desktop?.submit,deliveryMode:delivery,webhook:opts.receiver,webhookToken:opts['receiver-token-env']?process.env[opts['receiver-token-env']]:null})}catch(error){proxy?.close();throw error}
  if(opts['receiver-token-env']&&!process.env[opts['receiver-token-env']])throw Error('Receiver token environment variable is empty');
  await new Promise((resolve,reject)=>{instance.server.once('error',error=>{proxy?.close();reject(error)});instance.server.listen(port,'127.0.0.1',resolve)});
  await fs.mkdir(directory,{recursive:true,mode:0o700});const service={url:'http://localhost:'+port,token:instance.token,pid:process.pid,project,preview,delivery,threadId:desktop?.threadId};await fs.writeFile(file,JSON.stringify(service),{mode:0o600});
  console.log('Live Annotation: '+service.url);if(project)console.log('Project: '+project.name+' · '+project.url+'\nData directory: '+directory);console.log(desktop?'Connected to Codex task '+desktop.threadId+'; submissions send immediately.':opts.receiver?'Receiver connected; submissions send immediately.':'Waiting for an agent receiver. Run: node cli.cjs receive --directory '+JSON.stringify(directory));
  instance.ready().catch(console.error);
  const stop=async()=>{desktop?.close();instance.voice.close();instance.server.close();proxy?.close();try{const saved=JSON.parse(await fs.readFile(file));if(saved.token===service.token)await fs.unlink(file)}catch{}setTimeout(()=>process.exit(0),300).unref()};process.on('SIGINT',stop);process.on('SIGTERM',stop);return;
  }catch(error){desktop?.close();proxy?.close();instance?.voice.close();instance?.server.close();throw error}
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
main().catch(error=>{console.error(error.message);process.exitCode=1});
