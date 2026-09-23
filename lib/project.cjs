const crypto=require('node:crypto'),path=require('node:path');
function projectOptions({url,project,conversation}={}){
 if(!url)return null;
 const target=new URL(url);
 if(!['http:','https:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||target.username||target.password)throw Error('Project URL must be a local HTTP(S) preview without embedded credentials');
 const name=String(project||'Local project').slice(0,200),conversationId=String(conversation||'default').slice(0,200);
 const id=crypto.createHash('sha256').update(name+'\n'+target.origin+'\n'+conversationId).digest('hex').slice(0,24);
 return {id,name,url:target.href,conversationId};
}
function projectDirectory(base,project){return project?path.join(base,'projects',project.id):base}
module.exports={projectOptions,projectDirectory};
