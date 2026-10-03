const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
test('screenshot store recovers from open failures and aborted writes without wedging capture',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.route('http://capture-store.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><p>Screenshot storage fixture</p>'}));await page.goto('http://capture-store.test/');
 await page.evaluate(()=>{
  const original=indexedDB.open.bind(indexedDB);let fail=true;
  indexedDB.open=(...args)=>{if(!fail)return original(...args);fail=false;const request={error:Error('Transient open failure')};queueMicrotask(()=>request.onerror());return request};
 });
 await page.addScriptTag({content:await fs.readFile(path.resolve(__dirname,'../../public/capture-store.js'),'utf8')});
 const result=await page.evaluate(async()=>{
  let openError,abortError;try{await studyCaptures.put('one','first')}catch(error){openError=error.message}
  await studyCaptures.put('one','recovered');
  const original=IDBDatabase.prototype.transaction;let abort=true;
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(abort&&args[1]==='readwrite'){abort=false;tx.addEventListener('error',event=>event.stopImmediatePropagation(),{capture:true});queueMicrotask(()=>tx.abort())}return tx};
  try{await studyCaptures.put('two','interrupted')}catch(error){abortError=error.message}
  await studyCaptures.put('two','retry');
  return {openError,abortError,one:await studyCaptures.get('one'),two:await studyCaptures.get('two')};
 });
 assert.match(result.openError,/Transient open failure/);assert.match(result.abortError,/interrupted|abort/i);assert.equal(result.one,'recovered');assert.equal(result.two,'retry');
});
