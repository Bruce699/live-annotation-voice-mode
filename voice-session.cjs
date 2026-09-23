const {SpeechTranscript}=require('./speech-transcript.cjs');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
class VoiceSession{
 constructor(emit,directory){this.emit=emit;this.directory=path.join(directory,'voice-sessions');this.child=null;this.session=null}
 start({id,locale}){
  if(this.child)throw Error('Finish the current dictation first.');if(typeof id!=='string'||! /^[0-9a-f-]{36}$/.test(id))throw Error('Invalid dictation session.');
  if(locale!==undefined&&(typeof locale!=='string'||! /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(locale)))throw Error('Invalid dictation language.');
  const bundle=path.join(__dirname,'native/Open Layer Dictation.app');if(!fs.existsSync(bundle))throw Error('Build the dictation helper with npm run build:voice, then reopen Open Layer.');
  const dir=path.join(this.directory,id);fs.mkdirSync(dir,{recursive:true,mode:0o700});const events=path.join(dir,'events.jsonl'),control=path.join(dir,'control');fs.writeFileSync(events,'',{mode:0o600});fs.writeFileSync(control,'',{mode:0o600});
  const child=spawn('/usr/bin/open',['-n','-W',bundle,'--args',locale||'en-US','--events',events,'--control',control,'--parent',String(process.pid)],{stdio:'ignore'});
  this.session=id;this.child=child;this.control=control;let done=false,offset=0,pending='';const transcript=new SpeechTranscript();const send=event=>{if(event.type==='recognition'){const words=transcript.accept(event);this.emit({id,type:'words',words});return}if(event.type==='done')event={...event,words:transcript.words};this.emit({id,...event})};
  const poll=()=>{try{const size=fs.statSync(events).size;if(size<=offset)return;const buffer=Buffer.alloc(size-offset),fd=fs.openSync(events,'r');const read=fs.readSync(fd,buffer,0,buffer.length,offset);fs.closeSync(fd);offset+=read;pending+=buffer.subarray(0,read).toString('utf8');const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(event.type==='done')done=true;send(event)}catch{}}}catch{}};
  this.timer=setInterval(poll,80);this.timer.unref();
  child.on('error',e=>send({type:'error',message:e.message}));
  child.on('exit',(code)=>{poll();clearInterval(this.timer);if(this.child===child){this.child=null;this.session=null}if(!done){if(code)send({type:'error',message:'Dictation could not start. Check Microphone and Speech Recognition access in macOS Privacy & Security.'});send({type:'done'})}});return {id};
 }
 stop(id,cancel=false){if(id!==this.session||!this.child)return;fs.writeFileSync(this.control,cancel?'cancel':'stop',{mode:0o600});}
 close(){if(this.child){try{fs.writeFileSync(this.control,'cancel',{mode:0o600})}catch{}}clearInterval(this.timer)}
}
module.exports={VoiceSession};
