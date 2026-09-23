const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {buildSubmission,UUID}=require('./submission.cjs');
class Store{
 constructor(directory){this.directory=path.join(directory,'submissions');this.pending=new Map()}
 dir(id){if(!UUID.test(id))throw Error('Invalid submission ID');return path.join(this.directory,id)}
 async json(file,value){await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});await fs.rename(file+'.tmp',file)}
 async save(draft){
  if(this.pending.has(draft.id)){await this.pending.get(draft.id);return this.save(draft)}
  const operation=this.saveOnce(draft);this.pending.set(draft.id,operation);
  try{return await operation}finally{this.pending.delete(draft.id)}
 }
 async saveOnce(draft){
  const {prompt,files}=buildSubmission(draft),dir=this.dir(prompt.id);
  const hash=crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  try{const existing=await this.read(prompt.id);if(existing.requestHash!==hash)throw Error('Submission ID already belongs to a different draft');return existing}catch(e){if(e.code!=='ENOENT')throw e}
  await fs.mkdir(this.directory,{recursive:true,mode:0o700});const staging=await fs.mkdtemp(path.join(this.directory,'.pending-'));
  try{
   await fs.mkdir(path.join(staging,'attachments'),{mode:0o700});
   for(const file of files)await fs.writeFile(path.join(staging,'attachments',file.filename),file.bytes,{mode:0o600});
   await this.json(path.join(staging,'prompt.json'),prompt);
   const state={id:prompt.id,createdAt:prompt.createdAt,status:'queued',attempts:0,requestHash:hash};
   await this.json(path.join(staging,'delivery.json'),state);await fs.rename(staging,dir);return state;
  }catch(e){await fs.rm(staging,{recursive:true,force:true});throw e}
 }
 async read(id){return JSON.parse(await fs.readFile(path.join(this.dir(id),'delivery.json'),'utf8'))}
 async update(id,patch){const state={...await this.read(id),...patch};await this.json(path.join(this.dir(id),'delivery.json'),state);return state}
 async list(){await fs.mkdir(this.directory,{recursive:true,mode:0o700});const entries=await fs.readdir(this.directory);return (await Promise.all(entries.filter(id=>UUID.test(id)).map(id=>this.read(id)))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))}
 async bundle(id,{inline=false}={}){
  const dir=this.dir(id),prompt=JSON.parse(await fs.readFile(path.join(dir,'prompt.json'),'utf8'));
  const attachments=await Promise.all(prompt.attachments.map(async attachment=>({...attachment,...(inline?{dataBase64:(await fs.readFile(path.join(dir,attachment.path))).toString('base64')}:{absolutePath:path.join(dir,attachment.path)})})));
  return {prompt,attachments};
 }
}
module.exports={Store};
