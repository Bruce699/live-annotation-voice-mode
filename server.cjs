const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Store}=require('./lib/store.cjs'),{VoiceSession}=require('./voice-session.cjs');
const DEFAULT_DIRECTORY=path.join(os.homedir(),'.live-annotation');
function createServer({directory=DEFAULT_DIRECTORY,Voice=VoiceSession,voiceAvailable=process.platform==='darwin',webhook=null,webhookToken=null,project=null,preview=null}={}){
 if(webhook){const url=new URL(webhook);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Receiver must be an HTTP(S) URL without embedded credentials');if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Remote receivers require HTTPS')}
 const token=crypto.randomBytes(32).toString('hex'),store=new Store(directory),sessions=new Map();let active=null,delivering=false,claiming=false;
 const voice=new Voice(event=>{const s=sessions.get(event.id);if(!s)return;s.events.push({...event,seq:++s.seq});if(s.events.length>2048)s.events.shift();if(event.type==='done'){s.done=true;s.endedAt=Date.now();if(active===s.id)active=null}},directory);
 async function deliver(){
  if(!webhook||delivering)return;delivering=true;
  try{while(true){
   const state=(await store.list()).find(s=>s.status==='queued');if(!state)break;
   await store.update(state.id,{status:'delivering',attempts:state.attempts+1});
   try{
    const response=await fetch(webhook,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Idempotency-Key':state.id,...(webhookToken?{Authorization:'Bearer '+webhookToken}:{})},body:JSON.stringify(await store.bundle(state.id,{inline:true})),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Receiver returned HTTP '+response.status);
    const receipt=await response.json();if(receipt.submissionId!==state.id||typeof receipt.receiptId!=='string'||!receipt.receiptId)throw Error('Receiver did not acknowledge this submission');
    await store.update(state.id,{status:'delivered',deliveredAt:new Date().toISOString(),receiptId:receipt.receiptId,error:null});
   }catch(error){await store.update(state.id,{status:'failed',error:error.message})}
  }}finally{delivering=false}
 }
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');
  const port=server.address()?.port,hosts=new Set(['localhost:'+port,'127.0.0.1:'+port]);
  if(!hosts.has(req.headers.host))return json(res,403,{error:'Invalid local host'});
  const url=new URL(req.url,'http://'+req.headers.host);
  try{
   if(req.method==='GET'&&!url.pathname.startsWith('/api/')){
    if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Open the local link directly'});
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(name))return json(res,404,{error:'Not found'});
    const file=path.join(__dirname,'public',name);if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
    let data=await fsp.readFile(file);if(name==='index.html')data=data.toString().replace('<!--CONFIG-->',`<meta name="study-voice-token" content="${token}"><script>window.serviceConfig=${JSON.stringify({voiceAvailable,mode:webhook?'webhook':'queue',project,preview}).replace(/</g,'\\u003c')}</script>`);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(name)]||'application/octet-stream'});return res.end(data);
   }
   if(req.headers['x-study-token']!==token||(req.headers.origin&&!hosts.has(req.headers.origin.replace(/^http:\/\//,''))))return json(res,403,{error:'Invalid local session'});
   if(req.method==='GET'&&url.pathname==='/api/status')return json(res,200,{mode:webhook?'webhook':'queue',voiceAvailable,project,submissions:(await store.list()).map(({requestHash,...state})=>state)});
   if(req.method==='GET'&&url.pathname==='/api/voice/events'){
    const s=sessions.get(url.searchParams.get('id'));if(!s)return json(res,404,{error:'Dictation session ended'});s.lastPoll=Date.now();return json(res,200,{events:s.events.filter(e=>e.seq>(Number(url.searchParams.get('after'))||0)),done:s.done});
   }
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>48*1024*1024)return json(res,413,{error:'Submission exceeds 48 MB'});chunks.push(chunk)}
   const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
   if(url.pathname==='/api/submissions'){const state=await store.save({...body,project});json(res,202,{id:state.id,status:state.status});deliver().catch(console.error);return}
   if(url.pathname==='/api/retry'){
    const state=await store.read(body.id);if(state.status!=='failed')return json(res,409,{error:'Only failed deliveries can be retried'});
    await store.update(body.id,{status:'queued',error:null});json(res,202,{ok:true});deliver().catch(console.error);return;
   }
   if(url.pathname==='/api/claim'){
    if(webhook||claiming)return json(res,409,{error:'Receiver is busy or webhook delivery is configured'});claiming=true;
    try{const state=(await store.list()).find(s=>s.status==='queued'||s.status==='claimed'&&s.leaseUntil<Date.now());if(!state)return json(res,200,{submission:null});
     const claimToken=crypto.randomBytes(24).toString('hex');await store.update(state.id,{status:'claimed',claimToken,leaseUntil:Date.now()+300000});return json(res,200,{submission:await store.bundle(state.id),claimToken});
    }finally{claiming=false}
   }
   if(url.pathname==='/api/ack'){
    const state=await store.read(body.id);if(state.status!=='claimed'||state.claimToken!==body.claimToken)return json(res,409,{error:'Invalid delivery claim'});
    if(typeof body.receiptId!=='string'||!body.receiptId.trim())throw Error('A receiver receipt is required');
    await store.update(body.id,{status:'delivered',deliveredAt:new Date().toISOString(),receiptId:body.receiptId,claimToken:null});return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/voice/start'){
    if(!voiceAvailable)return json(res,501,{error:'Local dictation currently requires macOS'});
    if(active||voice.child)return json(res,409,{error:'Finish the current dictation first'});
    if(!/^[0-9a-f-]{36}$/.test(body.id||'')||sessions.has(body.id))throw Error('Invalid dictation session');
    const s={id:body.id,events:[],seq:0,done:false,lastPoll:Date.now()};sessions.set(s.id,s);active=s.id;
    try{voice.start(body)}catch(e){sessions.delete(s.id);active=null;throw e}return json(res,200,{id:s.id});
   }
   if(url.pathname==='/api/voice/stop'){voice.stop(body.id,body.cancel===true);return json(res,200,{ok:true})}
   return json(res,404,{error:'Not found'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message})}
 });
 const watchdog=setInterval(()=>{const now=Date.now();for(const [id,s]of sessions){if(!s.done&&now-s.lastPoll>6000){voice.stop(id,true);s.events.push({id,type:'done',seq:++s.seq});s.done=true;s.endedAt=now;if(active===id)active=null}if(s.done&&now-s.endedAt>600000)sessions.delete(id)}},1000);watchdog.unref();
 server.on('close',()=>{clearInterval(watchdog);voice.close()});
 return {server,store,voice,token,async ready(){for(const state of await store.list())if(state.status==='delivering')await store.update(state.id,{status:'failed',error:'Service restarted during delivery; check receiver before retrying'});await deliver()}};
}
module.exports={createServer,DEFAULT_DIRECTORY};
