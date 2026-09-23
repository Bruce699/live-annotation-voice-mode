// Speech may emit a new utterance after a pause without ending the request.
// Keep settled utterances separate from the revisable current hypothesis.
class SpeechTranscript {
 constructor(){this.committed=[];this.partial=[];this.settled=false;this.task=null;this.lastAt=0}
 get words(){return [...this.committed,...this.partial]}
 accept({words=[],task=1,at=0,settled,hasTiming}){
  const incoming=words.filter(w=>typeof w.text==='string'&&w.text.trim()).map(w=>({...w,text:w.text.trim()}));
  if(!incoming.length)return this.words;
  const timed=hasTiming??incoming.some(w=>Number.isFinite(w.end)&&w.end>w.start);
  const changedTask=this.task!==null&&task!==this.task;
  const beginsLater=timed&&this.partial.length&&incoming[0].start>=this.partial.at(-1).end+.02;
  if(changedTask||(this.settled&&(!timed||beginsLater))){this.committed.push(...this.partial);this.partial=[];this.settled=false}
  this.task=task;
  if(timed){
   // Some OS versions return the whole request; reconcile overlapping time spans.
   const start=incoming[0].start;
   this.committed=this.committed.filter(w=>w.end<=start+.01);
   this.partial=incoming.flatMap(w=>{const tokens=w.text.split(/\s+/);return tokens.map((text,i)=>({text,start:w.start+(w.end-w.start)*i/tokens.length,end:w.start+(w.end-w.start)*(i+1)/tokens.length}))});
   this.settled=settled??timed;
  }else{
   const tokens=incoming.flatMap(w=>w.text.split(/\s+/)),previous=this.partial;
   let common=0;while(common<tokens.length&&common<previous.length&&tokens[common]===previous[common].text)common++;
   const base=common?previous[common-1].end:this.committed.at(-1)?.end||0;
   const end=Math.max(base,Number.isFinite(at)?at:this.lastAt),count=tokens.length-common;
   this.partial=tokens.map((text,i)=>i<common?previous[i]:{text,start:base+(end-base)*(i-common)/Math.max(1,count),end:base+(end-base)*(i-common+1)/Math.max(1,count)});
   this.settled=settled;
  }
  this.lastAt=at;return this.words;
 }
}
module.exports={SpeechTranscript};
