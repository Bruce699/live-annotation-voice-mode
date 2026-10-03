const {test}=require('node:test'),assert=require('node:assert/strict');
const {cropRectangle}=require('../public/annotation-model.js');
test('bundled capture renderer matches its pinned vendor manifest',()=>{
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');const manifest=require('../public/vendor-manifest.json');
 for(const [name,entry]of Object.entries(manifest)){const asset=fs.readFileSync(path.join(__dirname,'../public',name));assert.equal(crypto.createHash('sha256').update(asset).digest('hex'),entry.sha256);assert.ok(asset.toString('utf8',0,250).includes(entry.package+' '+entry.version));assert.ok(fs.existsSync(path.join(__dirname,'..',entry.license)));assert.ok(fs.existsSync(path.join(__dirname,'..',entry.upstreamLicense)))}
});
test('crop rounds edges in bitmap pixels and clamps selections to the captured viewport',()=>{
 assert.deepEqual(cropRectangle({x:10.3,y:20.2,width:30.3,height:40.3},{width:100,height:100},{width:125,height:125}),{x:13,y:25,width:38,height:51});
 assert.deepEqual(cropRectangle({x:-20,y:10,width:40,height:120},{width:100,height:100},{width:200,height:200}),{x:0,y:20,width:40,height:180});
 assert.deepEqual(cropRectangle({x:120,y:110,width:20,height:10},{width:100,height:100},{width:200,height:200}),{x:200,y:200,width:0,height:0});
});
