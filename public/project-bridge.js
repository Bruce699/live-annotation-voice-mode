(()=>{
 const config=window.liveAnnotationProject;if(!config||parent===window)return;
 const post=data=>parent.postMessage({...data,projectId:config.projectId},config.parentOrigin);
 const context=()=>({url:config.sourceOrigin+location.pathname+location.search+location.hash,title:document.title,viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY}});
 window.liveAnnotationContext=context;
 post({type:'project-ready',context:context()});
 // Capture tools are installed before this script; capture metadata belongs to gesture completion.
 window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==config.parentOrigin)return;if(event.data?.type==='project-activate')dispatchEvent(new MessageEvent('message',{source:parent,data:{type:'study-focus',active:event.data.active}}))});
 const report=()=>post({type:'project-location',context:context()});
 for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);report();return result}}
 addEventListener('popstate',report);addEventListener('hashchange',report);
 addEventListener('pagehide',()=>post({type:'project-leaving'}));
 // A clone cannot reliably reproduce WebGL, nested external frames, or every CSS effect.
 // Its own renderer failures surface in the sidebar and screen sharing remains the fallback.
})();
