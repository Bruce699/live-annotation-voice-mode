(function(root){
 const STEP=80,PITCH=6;
 function wavePoints(samples,now,width,pitch=PITCH){const phase=(now/STEP*PITCH)%pitch;return Array.from({length:Math.ceil(width/pitch)+1},(_,i)=>{const x=width-i*pitch-phase;const sample=samples.at(-1-i);return {x,level:sample?.level||0,...(sample?.marker?{marker:sample.marker}:{})}})}
 function waveStyle(level,index,height,{quietThreshold=.008,gain=2.6}={}){
  const signal=Math.max(0,level-quietThreshold),amplitude=Math.pow(1-Math.exp(-signal*gain),.75);
  const quietAlpha=.42+.10*(.5+.5*Math.sin(index*1.7));
  return {height:3+amplitude*(height-7),alpha:signal>0?.55+.35*amplitude:quietAlpha};
 }
 class MicrophoneEnvelope{
  constructor(){this.levels=[]}
  reset(){this.levels=[]}
  sample(value){
   this.levels.push(value);if(this.levels.length>50)this.levels.shift();
   const sorted=[...this.levels].sort((a,b)=>a-b),floor=Math.min(.04,sorted[Math.floor((sorted.length-1)*.2)]);
   return Math.max(0,value-floor*1.2);
  }
 }
 class WaveMotion{
  constructor(now=0,speed=1){this.time=0;this.last=now;this.speed=this.clamp(speed)}
  clamp(speed){const value=Number(speed);return Number.isFinite(value)?Math.max(.25,Math.min(2,value)):1}
  advance(now){this.time+=Math.max(0,now-this.last)*this.speed;this.last=now;return this.time}
  setSpeed(now,speed){this.advance(now);this.speed=this.clamp(speed)}
 }
 class VoiceWaveform{
  constructor(host,{clock=()=>performance.now(),quietThreshold=.008,gain=2.6,adaptiveNoiseFloor=false,speed=1,barWidth=3,gap=3}={}){this.host=host;this.motion=new WaveMotion(clock(),speed);this.setGeometry(barWidth,gap);this.envelope=adaptiveNoiseFloor?new MicrophoneEnvelope():null;this.style={quietThreshold,gain};this.clock=clock;this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('aria-hidden','true');this.svg.setAttribute('shape-rendering','geometricPrecision');host.replaceChildren(this.svg);this.bars=[];this.samples=[];this.level=0;this.lastLevelAt=0;this.running=false;this.frame=null}
  setGeometry(barWidth,gap){this.barWidth=Math.max(1,Math.min(8,Number(barWidth)||3));this.gap=Math.max(1,Math.min(12,Number(gap)||3));if(this.running){const step=STEP*(this.barWidth+this.gap)/PITCH;this.lastSample=Math.floor(this.motion.time/step)*step}}
  setSpeed(speed){this.motion.setSpeed(this.clock(),speed)}
  setLevel(value){this.level=Math.max(0,Math.min(1,Number(value)||0));if(this.envelope)this.level=this.envelope.sample(this.level);this.lastLevelAt=this.clock()}
  addMarker(kind){
   if(!this.running)return;
   cancelAnimationFrame(this.frame);this.paint();
   // A capture belongs to the newest sample, never to an older bar in the middle.
   const marker={level:1,marker:kind==='note'?'note':kind==='laser'?'laser':'rectangle'};
   if(!this.samples.length||this.samples.at(-1).marker)this.samples.push(marker);
   else this.samples[this.samples.length-1]=marker;
   cancelAnimationFrame(this.frame);this.paint();
  }
  start(){if(this.running)return;this.running=true;this.envelope?.reset();this.level=0;this.samples=[];this.motion=new WaveMotion(this.clock(),this.motion.speed);this.lastSample=-STEP*(this.barWidth+this.gap)/PITCH;this.paint()}
  stop(){this.running=false;cancelAnimationFrame(this.frame);this.samples=[];this.paint()}
  paint(){
   const bounds=this.host.getBoundingClientRect(),now=this.clock(),motion=this.running?this.motion.advance(now):0,width=bounds.width||160,height=bounds.height||28,pitch=this.barWidth+this.gap,step=STEP*pitch/PITCH;
   this.svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
   if(this.running){this.lastSample=Math.max(this.lastSample,Math.floor(motion/step)*step-(Math.ceil(width/pitch)+2)*step);while(this.lastSample+step<=motion){this.lastSample+=step;this.samples.push({level:now-this.lastLevelAt<300?this.level:0})}this.samples=this.samples.slice(-Math.ceil(width/pitch)-2)}
   const points=wavePoints(this.samples,motion,width+this.barWidth/2,pitch);
   while(this.bars.length>points.length)this.bars.pop().remove();
   for(let i=0;i<points.length;i++){
    const p=points[i],style=waveStyle(p.level,Math.round((p.x+motion/STEP*PITCH)/pitch),height,this.style),h=p.marker?height-2:this.barWidth+(style.height-3)*(height-this.barWidth-4)/(height-7);
    let bar=this.bars[i];if(!bar){bar=document.createElementNS('http://www.w3.org/2000/svg','rect');bar.setAttribute('fill','#64646c');this.svg.append(bar);this.bars.push(bar)}
    bar.setAttribute('x',p.x-this.barWidth/2);bar.setAttribute('y',(height-h)/2);bar.setAttribute('width',this.barWidth);bar.setAttribute('height',h);bar.setAttribute('rx',this.barWidth/2);const fadeWidth=width*.18,leftFade=Math.max(0,Math.min(1,p.x/fadeWidth)),rightFade=Math.max(0,Math.min(1,(width-p.x)/fadeWidth));
    bar.setAttribute('opacity',(p.marker?1:style.alpha)*leftFade*rightFade);bar.setAttribute('fill',p.marker==='note'?'#3478f6':p.marker==='laser'?'#ff203c':p.marker==='rectangle'?'#ff8523':'#64646c');
   }
   if(this.running)this.frame=requestAnimationFrame(()=>this.paint());
  }
 }
 if(typeof module==='object')module.exports={wavePoints,waveStyle,MicrophoneEnvelope,WaveMotion,STEP,PITCH};else root.VoiceWaveform=VoiceWaveform;
})(globalThis);
