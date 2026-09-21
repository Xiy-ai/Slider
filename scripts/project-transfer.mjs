import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024, MAX_ENTRIES = 2000;
const excluded = new Set(['.git', 'node_modules', '.venv', 'venv', 'bin', 'obj', '.DS_Store']);
const hash = data => createHash('sha256').update(data).digest('hex');
function nameCheck(name) {
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) || name === '.' || name === '..') throw Error(`Unsupported transfer filename: ${name}`);
}
function windowsPath(value) {
  if (typeof value !== 'string' || !/^C:\\SliderWorkspaces\\/i.test(value)) throw Error('Windows destination/source must be a directory below C:\\SliderWorkspaces.');
  value.slice(20).split('\\').forEach(nameCheck);
  return value;
}
function macPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('Mac path must be absolute.');
  return path.resolve(value);
}
async function noLinks(value) {
  for (let walk = value;; walk = path.dirname(walk)) {
    const info = await fs.lstat(walk);
    if (info.isSymbolicLink()) throw Error(`Symbolic links are not transferred: ${walk}`);
    if (walk === path.dirname(walk)) break;
  }
}
function manifest() {
  const entries = []; let total = 0;
  return { entries, add(entry) {
    if (entry.size > MAX_FILE) throw Error('A transfer file exceeds 8 MiB; large-file streaming is not available yet.');
    total += entry.size;
    if (entries.length >= MAX_ENTRIES || total > MAX_TOTAL) throw Error('Transfer exceeds 2000 entries or 256 MiB.');
    entries.push(entry);
  }, get bytes() { return total; } };
}

export async function transferProject(operation, args, call) {
  if ((await call('windows_status', {})).state !== 'running') throw Error('Start Windows before transferring a project.');
  const importing = operation === 'windows_project_import';
  const local = macPath(importing ? args.mac_source : args.mac_destination);
  const guest = windowsPath(importing ? args.windows_destination : args.windows_source);
  const plan = manifest();
  if (importing) {
    await noLinks(local);
    if (!(await fs.stat(local)).isDirectory()) throw Error('Mac source must be a directory.');
    const walk = async (folder, relative = '') => {
      const names = new Set();
      for await (const item of await fs.opendir(folder)) {
        if (excluded.has(item.name)) continue;
        nameCheck(item.name);
        const key = item.name.toLowerCase();
        if (names.has(key)) throw Error('Source contains names that collide on Windows.');
        names.add(key);
        const source = path.join(folder, item.name), rel = relative ? relative+'\\'+item.name : item.name;
        const info = await fs.lstat(source);
        if (!info.isDirectory() && !info.isFile()) throw Error(`Unsupported file type: ${source}`);
        plan.add({relative:rel, directory:info.isDirectory(), size:info.isFile()?info.size:0});
        if (info.isDirectory()) await walk(source, rel);
      }
    };
    await walk(local);
    if ((await call('windows_file_stat', {path:guest})).exists) throw Error('Windows destination already exists. Choose a new directory.');
  } else {
    await noLinks(path.dirname(local));
    const walk = async (folder, relative = '') => {
      let offset = 0;
      do {
        const page = await call('windows_file_list', {path:folder, limit:200, offset});
        for (const item of page.items) {
          nameCheck(item.name);
          if (item.reparse_point) throw Error('Junctions and symbolic links cannot be exported.');
          const rel = relative ? relative+'\\'+item.name : item.name;
          plan.add({relative:rel, directory:item.kind==='directory', size:item.size??0});
          if (item.kind==='directory') await walk(folder+'\\'+item.name, rel);
        }
        offset = page.next_offset;
      } while (offset !== null);
    };
    await walk(guest);
  }
  const staging = importing ? `C:\\SliderWorkspaces\\.slider-import-${randomUUID()}` : local;
  if (importing) await call('windows_file_mkdir', {path:staging});
  else await fs.mkdir(local); // Exclusive creation: never merge into user data.
  try {
    for (const entry of plan.entries) {
      const localFile = path.join(local, ...entry.relative.split('\\'));
      const remoteFile = (importing ? staging : guest)+'\\'+entry.relative;
      if (entry.directory) {
        if (importing) await call('windows_file_mkdir', {path:remoteFile});
        else await fs.mkdir(localFile);
        continue;
      }
      if (importing) {
        await noLinks(localFile);
        const handle = await fs.open(localFile, 'r');
        let data;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size !== entry.size) throw Error('Source changed during transfer.');
          data = Buffer.alloc(entry.size);
          let offset=0;
          while (offset<data.length) { const read=await handle.read(data,offset,data.length-offset,offset); if(!read.bytesRead)throw Error('Source changed during transfer.');offset+=read.bytesRead; }
        } finally { await handle.close(); }
        await call('windows_file_write', {path:remoteFile, encoding:'base64', content:data.toString('base64')});
        const check = await call('windows_file_read', {path:remoteFile,max_bytes:MAX_FILE});
        if (hash(Buffer.from(check.content,check.encoding==='base64'?'base64':'utf8'))!==hash(data)) throw Error('Transferred file checksum mismatch.');
      } else {
        const result = await call('windows_file_read', {path:remoteFile,max_bytes:MAX_FILE});
        const data = Buffer.from(result.content,result.encoding==='base64'?'base64':'utf8');
        if (data.length!==entry.size) throw Error('Source changed during transfer.');
        await fs.writeFile(localFile,data,{flag:'wx'});
        if(hash(await fs.readFile(localFile))!==hash(data))throw Error('Exported file checksum mismatch.');
      }
    }
    if(importing)await call('windows_file_move',{path:staging,destination:guest});
    return {destination:importing?guest:local, entries:plan.entries.length, bytes:plan.bytes, verified:true, excluded:importing?[...excluded]:[]};
  } catch(error) {
    throw Error(`${error.detail || error.message} Transfer may be incomplete; inspect ${staging}. No automatic replay was attempted.`);
  }
}
