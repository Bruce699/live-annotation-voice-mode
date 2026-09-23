// Use this adapter factory inside your agent host. submit() must call that host's real chat API.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {UUID}=require('../lib/submission.cjs');
function createReceiver({submit,directory,token}){
 if(typeof submit!=='function'||!directory)throw Error('Provide a real submit function and an attachment directory');
 return http.createServer(async(req,res)=>{
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
  if(req.method!=='POST'||req.url!=='/prompt')return reply(404,{error:'Not found'});
  if(token&&req.headers.authorization!=='Bearer '+token)return reply(403,{error:'Invalid token'});
  let dir;
  try{
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>48*1024*1024)return reply(413,{error:'Too large'});chunks.push(chunk)}
   const bundle=JSON.parse(Buffer.concat(chunks)),id=bundle.prompt?.id;
   if(!UUID.test(id||'')||req.headers['idempotency-key']!==id||bundle.prompt.schemaVersion!=='live-annotation/v1')return reply(400,{error:'Invalid submission'});
   dir=path.join(directory,id);await fs.mkdir(directory,{recursive:true,mode:0o700});
   try{await fs.mkdir(dir,{mode:0o700})}catch(error){if(error.code!=='EEXIST')throw error;try{return reply(200,JSON.parse(await fs.readFile(path.join(dir,'receipt.json'),'utf8')))}catch{return reply(409,{error:'Delivery in progress or uncertain; inspect the agent before retrying'})}}
   const images=[];
   for(const [index,image]of bundle.attachments.entries()){
    const filename=path.join(dir,String(index)+'.png');await fs.writeFile(filename,Buffer.from(image.dataBase64,'base64'),{mode:0o600});images.push({path:filename,label:image.label,id:image.id});
   }
   const receiptId=await submit({id,prompt:bundle.prompt,images});
   if(typeof receiptId!=='string'||!receiptId)throw Error('The real chat API must return a receipt ID');
   const receipt={submissionId:id,receiptId};await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt),{mode:0o600});reply(200,receipt);
  }catch(error){reply(500,{error:error.message})}
 });
}
module.exports={createReceiver};
