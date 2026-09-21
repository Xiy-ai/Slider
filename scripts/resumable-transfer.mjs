import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
const defaults=['.git','node_modules','.venv','venv','bin','obj','.DS_Store'];
const chunkSize=1024*1024;
const active=new Map();
const directory=()=>process.env.SLIDER_TRANSFER_STATE_DIR??path.join(homedir(),'Library','Application Support','Slider','Transfers');
const digest=async file=>{const h=createHash('sha256');for await(const part of createReadStream(file))h.update(part);return h.digest('hex');};
function checkName(name){if(!name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)||name==='.'||name==='..')throw Error('Unsupported transfer name');}
async function noLinks(file){for(let p=file;;p=path.dirname(p)){if((await fs.lstat(p)).isSymbolicLink())throw Error('Transfer paths cannot contain symbolic links');if(path.dirname(p)===p)break;}}
function idPath(id){if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid transfer ID');return path.join(directory(),id+'.json');}
async function save(s){await fs.mkdir(directory(),{recursive:true,mode:0o700});await noLinks(directory());const file=idPath(s.transfer_id),tmp=file+'.'+randomUUID();await fs.writeFile(tmp,JSON.stringify(s),{mode:0o600,flag:'wx'});await fs.rename(tmp,file);}
async function load(id){await noLinks(idPath(id));const s=JSON.parse(await fs.readFile(idPath(id),'utf8'));if(s.transfer_id!==id||!['import','export'].includes(s.direction)||!path.isAbsolute(s.local)||!/^C:\\SliderWorkspaces\\/i.test(s.guest)||s.entries.length>100000)throw Error('Invalid transfer journal');s.guest.slice(20).split('\\').forEach(checkName);for(const e of s.entries){e.relative.split('\\').forEach(checkName);if(!Number.isSafeInteger(e.size)||e.size<0)throw Error('Invalid journal size');}if(s.stage!==(s.direction==='import'?'C:\\SliderWorkspaces\\.slider-transfer-'+id:s.local))throw Error('Invalid staging path');return s;}
async function otherActive(id){try{const pid=Number(await fs.readFile(idPath(id)+'.lock','utf8'));if(!Number.isInteger(pid)||pid<1)return false;process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
function report(s,other=false){return {transfer_id:s.transfer_id,state:s.state==='completed'?'completed':(active.has(s.transfer_id)||other)?'running':s.state==='running'?'interrupted':s.state,bytes_completed:s.bytes_completed,total_bytes:s.total_bytes,entries_completed:s.index,entries:s.entries.length,source:s.direction==='import'?s.local:s.guest,destination:s.direction==='import'?s.guest:s.local,direction:s.direction,excluded:s.exclude,error:s.error??null,verified:s.state==='completed',partial_path:s.stage};}
async function plan(args,call){
 if(!['import','export'].includes(args.direction))throw Error('direction must be import or export');
 const local=path.resolve(args.mac_path??'');if(!path.isAbsolute(args.mac_path??''))throw Error('mac_path must be absolute');
 const guest=args.windows_path;if(typeof guest!=='string'||!/^C:\\SliderWorkspaces\\/i.test(guest))throw Error('Windows path must be below C:\\SliderWorkspaces');guest.slice(20).split('\\').forEach(checkName);
 const exclude=args.exclude??defaults;if(!Array.isArray(exclude)||exclude.length>100)throw Error('Invalid exclusions');exclude.forEach(checkName);
 const s={transfer_id:randomUUID(),direction:args.direction,local,guest,exclude,entries:[],total_bytes:0,bytes_completed:0,index:0,offset:0,state:'planning'};
 const add=e=>{s.total_bytes+=e.size;if(s.total_bytes>64*1024**3||s.entries.length>=100000)throw Error('Transfer exceeds 64 GiB or 100000 entries');s.entries.push(e);};
 if(s.direction==='import'){
  await noLinks(local);if(!(await fs.stat(local)).isDirectory())throw Error('Import source must be a directory');
  if((await call('windows_file_stat',{path:guest})).exists)throw Error('Destination exists; transfers never merge');
  async function walk(dir,rel=''){const names=new Set();for(const item of await fs.readdir(dir,{withFileTypes:true})){if(exclude.includes(item.name))continue;checkName(item.name);if(names.has(item.name.toLowerCase()))throw Error('Case-colliding names');names.add(item.name.toLowerCase());const p=path.join(dir,item.name),r=rel?rel+'\\'+item.name:item.name;const st=await fs.lstat(p);if(!st.isDirectory()&&!st.isFile())throw Error('Unsupported source file type');add({relative:r,directory:st.isDirectory(),size:st.isFile()?st.size:0,sha256:st.isFile()?await digest(p):null});if(st.isDirectory())await walk(p,r);}}
  await walk(local);s.stage='C:\\SliderWorkspaces\\.slider-transfer-'+s.transfer_id;
 }else{
  await noLinks(path.dirname(local));try{await fs.lstat(local);throw Error('Destination exists; transfers never merge');}catch(e){if(e.code!=='ENOENT')throw e;}
  async function walk(dir,rel=''){let offset=0;do{const page=await call('windows_file_list',{path:dir,offset,limit:500});for(const item of page.items){if(exclude.includes(item.name))continue;checkName(item.name);if(item.reparse_point)throw Error('Guest links cannot be transferred');const r=rel?rel+'\\'+item.name:item.name;add({relative:r,directory:item.kind==='directory',size:item.size??0,sha256:item.kind==='file'?(await call('windows_file_hash',{path:dir+'\\'+item.name})).sha256:null});if(item.kind==='directory')await walk(dir+'\\'+item.name,r);}offset=page.next_offset;}while(offset!==null);}
  await walk(guest);s.stage=local;
 }
 return s;
}
async function acquire(id){
 const file=idPath(id)+'.lock';
 try{const h=await fs.open(file,'wx',0o600);await h.writeFile(String(process.pid));await h.close();return file;}
 catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await fs.readFile(file,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('Invalid transfer lock; inspect before recovery');try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){await fs.unlink(file);return acquire(id);}throw e;}throw Error('Transfer is active in another plugin process');}
}
async function begin(s,call){const lock=await acquire(s.transfer_id),control={};active.set(s.transfer_id,control);run(s,call,control).catch(e=>{console.error('Transfer journal error: '+e.message);}).finally(async()=>{await fs.unlink(lock).catch(()=>{});active.delete(s.transfer_id);});}
async function run(s,call,control){
 s.state='running';delete s.error;await save(s);
 try{
  if(!s.initialized){if(s.direction==='import')await call('windows_file_mkdir',{path:s.stage});else await fs.mkdir(s.stage);s.initialized=true;await save(s);}
  for(;s.index<s.entries.length;s.index++,s.offset=0){
   if(control.cancelled || await fs.stat(idPath(s.transfer_id)+'.cancel').then(()=>true,()=>false)){s.state='cancelled';await save(s);return;}
   const e=s.entries[s.index],local=path.join(s.local,...e.relative.split('\\')),remote=(s.direction==='import'?s.stage:s.guest)+'\\'+e.relative;
   if(e.directory){if(s.direction==='import')await call('windows_file_mkdir',{path:remote});else {await fs.mkdir(local,{recursive:true});await noLinks(local);}await save(s);continue;}
   if(s.direction==='import'){
    await noLinks(local);if(await digest(local)!==e.sha256)throw Error('Source changed; start a new transfer after reviewing changes');
    const h=await fs.open(local,'r');try{do{
     if(control.cancelled || await fs.stat(idPath(s.transfer_id)+'.cancel').then(()=>true,()=>false)){s.state='cancelled';await save(s);return;}
     const buffer=Buffer.alloc(Math.min(chunkSize,e.size-s.offset));let got=0;while(got<buffer.length){const r=await h.read(buffer,got,buffer.length-got,s.offset+got);if(!r.bytesRead)throw Error('Source shortened');got+=r.bytesRead;}
     await call('windows_file_chunk_write',{path:remote,offset:s.offset,contentBase64:buffer.toString('base64')});s.offset+=buffer.length;s.bytes_completed+=buffer.length;await save(s);
    }while(s.offset<e.size);}finally{await h.close();}
    const remoteHash=await call('windows_file_hash',{path:remote});if(remoteHash.sha256!==e.sha256||remoteHash.length!==e.size)throw Error('Destination checksum mismatch');
   }else{
    await noLinks(path.dirname(local));let h;try{h=await fs.open(local,'wx+');}catch(e){if(e.code!=='EEXIST')throw e;await noLinks(local);h=await fs.open(local,'r+');}
    try{do{
     if(control.cancelled || await fs.stat(idPath(s.transfer_id)+'.cancel').then(()=>true,()=>false)){s.state='cancelled';await save(s);return;}
     const part=await call('windows_file_chunk_read',{path:remote,offset:s.offset,chunk_length:chunkSize});if(part.length!==e.size)throw Error('Source size changed');const buffer=Buffer.from(part.contentBase64,'base64');if(!buffer.length&&s.offset<e.size)throw Error('Unexpected empty chunk');
     const st=await h.stat();if(st.size<s.offset)throw Error('Partial destination shorter than committed progress');
     const overlap=Math.min(buffer.length,st.size-s.offset),old=Buffer.alloc(overlap);let got=0;while(got<overlap){const r=await h.read(old,got,overlap-got,s.offset+got);if(!r.bytesRead)throw Error('Short read');got+=r.bytesRead;}if(!old.equals(buffer.subarray(0,overlap)))throw Error('Partial destination conflict');
     let n=overlap;while(n<buffer.length){const w=await h.write(buffer,n,buffer.length-n,s.offset+n);if(!w.bytesWritten)throw Error('Short write');n+=w.bytesWritten;}await h.sync();
     s.offset+=buffer.length;s.bytes_completed+=buffer.length;await save(s);
    }while(s.offset<e.size);}finally{await h.close();}
    if(await digest(local)!==e.sha256||(await fs.stat(local)).size!==e.size)throw Error('Export checksum mismatch');
   }
   // Persist next-file position before proceeding; repeated verification is safe.
   s.index++;s.offset=0;await save(s);s.index--;
  }
  if(s.direction==='import'){
   // Reconcile a lost final rename reply by verifying the destination manifest.
   if((await call('windows_file_stat',{path:s.stage})).exists)await call('windows_file_move',{path:s.stage,destination:s.guest});
   for(const e of s.entries){const p=s.guest+'\\'+e.relative;if(e.directory){if((await call('windows_file_stat',{path:p})).kind!=='directory')throw Error('Final directory missing');}else{const h=await call('windows_file_hash',{path:p});if(h.sha256!==e.sha256||h.length!==e.size)throw Error('Final destination conflict');}}
  }
  s.state='completed';await save(s);
 }catch(e){s.state='interrupted';s.error=e.detail??e.message;await save(s);}
}
export async function transferTool(name,args,call){
 if(name==='windows_transfer_start'){
  if((await call('windows_readiness',{})).command_ready!==true)throw Error('Windows command bridge is not ready');
  const s=await plan(args,call);await save(s);await begin(s,call);return report(s);
 }
 const s=await load(args.transfer_id);
 if(name==='windows_transfer_cancel'){
  if(s.state==='completed')return {...report(s),cancel_requested:false,cancel_pending:false};
  await fs.writeFile(idPath(s.transfer_id)+'.cancel','cancel',{mode:0o600});
  const control=active.get(s.transfer_id);if(control)control.cancelled=true;
  const deadline=Date.now()+2000;
  while((active.has(s.transfer_id)||await otherActive(s.transfer_id))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  if(!active.has(s.transfer_id)&&!await otherActive(s.transfer_id)){
   // Serialize with resume and reread: the transfer might have completed while
   // cancellation was in flight. Never overwrite a successful journal.
   let lock;
   try{lock=await acquire(s.transfer_id);}catch(error){
    if(!active.has(s.transfer_id)&&!await otherActive(s.transfer_id))throw error;
   }
   if(lock)try{const latest=await load(s.transfer_id);if(latest.state!=='completed'){latest.state='cancelled';await save(latest);}}finally{await fs.unlink(lock).catch(()=>{});}
  }
  const latest=await load(s.transfer_id),other=await otherActive(s.transfer_id);
  const result=report(latest,other);
  return {...result,cancel_requested:latest.state!=='completed',cancel_pending:result.state==='running',cleanup:'Partial files retained; cancellation never deletes source or destination.'};
 }
 if(name==='windows_transfer_resume'){
  if(active.has(s.transfer_id)||await otherActive(s.transfer_id)||s.state==='completed')return report(s,await otherActive(s.transfer_id));await fs.unlink(idPath(s.transfer_id)+'.cancel').catch(()=>{});
  await begin(s,call);return report(s);
 }
 return report(s,await otherActive(s.transfer_id));
}
