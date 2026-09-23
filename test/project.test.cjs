const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),path=require('node:path');
const {createProjectProxy}=require('../lib/project-proxy.cjs'),{projectOptions,projectDirectory}=require('../lib/project.cjs'),{buildSubmission}=require('../lib/submission.cjs');
async function setup(t){
 const requests=[];const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body,headers:req.headers});
  if(req.url==='/api/echo'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({body,origin:req.headers.origin}))}
  if(req.url==='/next'){res.writeHead(302,{Location:'/page?value=2'});return res.end()}
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.appLoaded=true')}
  res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'",'X-Frame-Options':'DENY'});res.end('<html><body><a href="/next">Next</a><script src="/app.js"></script></body></html>')});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const project=projectOptions({url:'http://127.0.0.1:'+upstream.address().port+'/page?one=1',project:'Test project',conversation:'task-a'});
 const proxy=createProjectProxy({project,parentOrigin:'http://localhost:47832',assetDirectory:path.join(__dirname,'../public')}),preview=await proxy.start();
 t.after(()=>{proxy.close();upstream.close()});return {upstream,project,preview,requests};
}
test('accepts only explicit local projects and isolates each project conversation',()=>{
 assert.throws(()=>projectOptions({url:'https://example.com'}),/local/);assert.throws(()=>projectOptions({url:'http://user:secret@localhost:3000'}),/local/);
 const a=projectOptions({url:'http://localhost:3000/home',project:'A',conversation:'1'}),b=projectOptions({url:'http://localhost:3000/other',project:'A',conversation:'1'}),c=projectOptions({url:'http://localhost:3000',project:'A',conversation:'2'});
 assert.equal(a.id,b.id);assert.notEqual(a.id,c.id);assert.notEqual(projectDirectory('/tmp/data',a),projectDirectory('/tmp/data',c));
});
test('injects isolated annotation runtime while keeping page assets, routes, and forms operational',async t=>{
 const {preview,project,requests}=await setup(t),response=await fetch(preview.url),html=await response.text();
 assert.equal(response.status,200);assert.match(html,/href="\/next"/);assert.match(html,/src="\/app.js"/);assert.match(html,/project-bridge.js/);assert.match(html,/http:\/\/localhost:47832/);assert.equal(response.headers.get('x-frame-options'),null);
 const asset=await fetch(preview.origin+'/app.js');assert.equal(await asset.text(),'window.appLoaded=true');assert.equal(requests[0].url,'/page?one=1');
 const post=await fetch(preview.origin+'/api/echo',{method:'POST',headers:{Origin:preview.origin,'Content-Type':'application/json'},body:'{"hello":"world"}'});assert.deepEqual(await post.json(),{body:'{"hello":"world"}',origin:new URL(project.url).origin});
 const redirect=await fetch(preview.origin+'/next',{redirect:'manual'});assert.equal(redirect.headers.get('location'),preview.origin+'/page?value=2');
 assert.equal((await fetch(preview.origin+'/__live_annotation__/html2canvas.min.js')).status,200);assert.equal((await fetch(preview.origin+'/__live_annotation__/../server.cjs')).headers.get('content-type'),'text/html');
});
test('project context is preserved with image identity and original capture URL',()=>{
 const project=projectOptions({url:'http://localhost:3000',project:'Website',conversation:'task-123'}),id=crypto.randomUUID();const {prompt}=buildSubmission({id,text:'Here [Image 4]',project,images:[{id:crypto.randomUUID(),number:4,kind:'rectangle',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNwaPhAEmIY1TCqYfhqAAD5vLAQg01R4wAAAABJRU5ErkJggg==',context:{url:'http://localhost:3000/settings',title:'Settings',viewport:{width:900,height:700},scroll:{x:0,y:140}}}]});assert.equal(prompt.project.conversationId,'task-123');assert.equal(prompt.annotations[0].context.url,'http://localhost:3000/settings');assert.equal(prompt.annotations[0].context.scroll.y,140);
});
test('forwards development websocket upgrades',async t=>{
 const {upstream,preview}=await setup(t);upstream.on('upgrade',(req,socket)=>{const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.write(Buffer.from([0x81,2,79,75]));socket.on('data',()=>socket.end())});
 const socket=new WebSocket(preview.origin.replace('http:','ws:')+'/hmr');const message=await new Promise((resolve,reject)=>{socket.addEventListener('message',e=>resolve(e.data));socket.addEventListener('error',reject)});assert.equal(message,'OK');socket.close();
});
