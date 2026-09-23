(()=>{
 const video=document.querySelector('video');let stream;
 window.startSharing=async()=>{
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing is unavailable here. Open this link in Chrome, or use + to add screenshots.');
  const next=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:false});
  for(const track of stream?.getTracks()||[])track.stop();stream=next;video.srcObject=next;await video.play();
  const size=()=>parent.postMessage({type:'capture-size',width:video.videoWidth,height:video.videoHeight},location.origin);video.onresize=size;size();
  next.getVideoTracks()[0].onended=()=>{parent.postMessage({type:'capture-ended'},location.origin);dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'study-focus',active:false}}))};
  dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'study-focus',active:true}}));
 };
 window.captureAnnotationBackground=async()=>{
  if(!stream?.active||!video.videoWidth)throw Error('Share a window before capturing');
  const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);return canvas;
 };
 window.stopSharing=()=>{for(const track of stream?.getTracks()||[])track.stop();dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'study-focus',active:false}}))};
 addEventListener('pagehide',window.stopSharing);
})();
