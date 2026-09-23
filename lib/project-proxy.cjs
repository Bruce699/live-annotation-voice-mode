// A separate origin keeps project scripts away from the sidebar's service credential and draft store.
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const PREFIX='/__live_annotation__/';
const assets=new Set(['html2canvas.min.js','annotation-model.js','website-annotations.js','website-annotations.css','project-bridge.js']);
function inject(html,config){
 const encoded=JSON.stringify(config).replace(/</g,'\\u003c');
 const scripts=['html2canvas.min.js','annotation-model.js','website-annotations.js','project-bridge.js'].map(file=>`<script src="${PREFIX+file}"></script>`).join('');
 const markup=`<link rel="stylesheet" href="${PREFIX}website-annotations.css"><script>window.liveAnnotationProject=${encoded}</script>${scripts}`;
 // This preview is an explicitly selected local development site, on an isolated loopback origin.
 // Remove document CSP too: the injected overlay needs its own styles/scripts. The original server is unchanged.
 html=html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy[\s\S]*?>/gi,'');
 return /<\/body\s*>/i.test(html)?html.replace(/<\/body\s*>/i,markup+'</body>'):html+markup;
}
function createProjectProxy({project,parentOrigin,assetDirectory}){
 const target=new URL(project.url);if(!['http:','https:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.username||target.password)throw Error('Only local project URLs can be wrapped');
 const transport=target.protocol==='https:'?https:http,sockets=new Set();
 let origin;
 const server=http.createServer((req,res)=>{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Invalid preview host');return}
  const requested=new URL(req.url,origin);
  if(requested.pathname.startsWith(PREFIX)){
   const name=requested.pathname.slice(PREFIX.length);if(!assets.has(name)){res.writeHead(404);res.end();return}
   res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(path.join(assetDirectory,name)).pipe(res);return;
  }
  const headers={...req.headers,host:target.host,'accept-encoding':'identity'};delete headers['x-study-token'];delete headers['content-length'];
  if(headers.origin===origin)headers.origin=target.origin;
  if(headers.referer?.startsWith(origin+'/'))headers.referer=target.origin+headers.referer.slice(origin.length);
  const upstream=transport.request({hostname:target.hostname.replace(/^\[|\]$/g,''),port:target.port||undefined,path:requested.pathname+requested.search,method:req.method,headers},response=>{
   const outgoing={...response.headers};delete outgoing['x-frame-options'];delete outgoing['content-security-policy'];delete outgoing['content-security-policy-report-only'];
   if(outgoing.location){const redirect=new URL(outgoing.location,target.origin);if(redirect.origin===target.origin)outgoing.location=origin+redirect.pathname+redirect.search+redirect.hash}
   // Do not let a preview register a service worker that hides the overlay on subsequent visits.
   if(req.headers['sec-fetch-dest']==='serviceworker'){response.resume();res.writeHead(403);res.end('Service workers are disabled in the annotation preview');return}
   if((response.headers['content-type']||'').includes('text/html')&&req.method!=='HEAD'){
    const chunks=[];let length=0;response.on('data',chunk=>{length+=chunk.length;if(length>16*1024*1024){upstream.destroy(Error('Preview HTML exceeds 16 MB'));return}chunks.push(chunk)});
    response.on('end',()=>{try{
     let body=Buffer.concat(chunks);const encoding=response.headers['content-encoding'];if(encoding==='gzip')body=zlib.gunzipSync(body);else if(encoding==='br')body=zlib.brotliDecompressSync(body);else if(encoding==='deflate')body=zlib.inflateSync(body);
     const html=inject(body.toString('utf8'),{parentOrigin,sourceOrigin:target.origin,projectId:project.id});
     for(const key of ['content-length','content-encoding','etag','last-modified'])delete outgoing[key];outgoing['cache-control']='no-store';res.writeHead(response.statusCode,outgoing);res.end(html);
    }catch(error){res.writeHead(502);res.end('Could not prepare the project preview')}});
   }else{res.writeHead(response.statusCode,outgoing);response.pipe(res)}
  });
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'text/plain'});res.end('Local project is unavailable. Restart its dev server, then reload the preview.')});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))});
 server.on('upgrade',(req,socket,head)=>{
  if(req.headers.host!==new URL(origin).host){socket.destroy();return}
  const headers={...req.headers,host:target.host};if(headers.origin===origin)headers.origin=target.origin;
  const upstream=transport.request({hostname:target.hostname.replace(/^\[|\]$/g,''),port:target.port||undefined,path:req.url,headers});
  upstream.on('upgrade',(response,remote,remoteHead)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n');if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);remote.pipe(socket).pipe(remote);socket.on('close',()=>remote.destroy());remote.on('error',()=>socket.destroy())});
  upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());upstream.end();
 });
 return {server,async start(port=0){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});origin='http://localhost:'+server.address().port;return {origin,url:origin+target.pathname+target.search+target.hash}},close(){for(const socket of sockets)socket.destroy();server.close()}};
}
module.exports={createProjectProxy,inject};
