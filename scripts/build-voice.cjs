const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
function buildVoice(){
 const root=path.resolve(__dirname,'..'),native=path.join(root,'native'),bundle=path.join(native,'Live Annotation Dictation.app/Contents'),binary=path.join(bundle,'MacOS/live-annotation-dictation'),source=path.join(native,'voice-helper.swift'),plist=path.join(native,'voice-info.plist');
 if(fs.existsSync(binary)&&fs.statSync(binary).mtimeMs>Math.max(fs.statSync(source).mtimeMs,fs.statSync(plist).mtimeMs))return binary;
 fs.mkdirSync(path.dirname(binary),{recursive:true});fs.copyFileSync(plist,path.join(bundle,'Info.plist'));
 const env={...process.env};if(fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/swiftc'))env.DEVELOPER_DIR='/Library/Developer/CommandLineTools';
 execFileSync('/usr/bin/xcrun',['swiftc','-swift-version','5',source,'-o',binary,'-framework','Speech','-framework','AVFoundation','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',plist],{env,stdio:'inherit'});return binary;
}
module.exports={buildVoice};if(require.main===module)buildVoice();
