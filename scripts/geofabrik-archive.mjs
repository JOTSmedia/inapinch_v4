// Maintainer-only selective extractor. Read just the named shapefile members
// from Geofabrik's dated state archives, with a three-request shared queue.
import {mkdir,readFile,writeFile,rename,readdir as readdirNames} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
const folder=fileURLToPath(new URL('../work/geo-raw/',import.meta.url));
const pending=new Map(), waiting=[];
let busy=0;
async function withSlot(task) {
  if(busy>=3)await new Promise(resolve=>waiting.push(resolve));
  busy++;
  try{return await task();}
  finally{busy--;waiting.shift()?.();}
}
async function disk(file, task, json=false) {
  try{const buf=await readFile(file);return json?JSON.parse(buf):buf;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(pending.has(file))return pending.get(file);
  const request=(async()=>{
    const value=await task();
    const temp=file+'.'+Math.random().toString(36).slice(2)+'.tmp';
    await writeFile(temp,json?JSON.stringify(value):value);
    await rename(temp,file);
    return value;
  })();
  pending.set(file,request);
  try{return await request;}finally{pending.delete(file);}
}
async function range(url, header) {
  return withSlot(async()=>{
    for(let attempt=0; ;attempt++){
      try{
        const target=new URL(url);
        if(attempt)target.searchParams.set('layers','facilities');
        const response=await fetch(target,{headers:{Range:'bytes='+header,'Accept-Encoding':'identity','User-Agent':'IN-A-PINCH-US-Atlas/4 Geofabrik partial extract'},signal:AbortSignal.timeout(14000)});
        if(response.status!==206 || !response.headers.get('content-range')?.startsWith('bytes ')){
          await response.body?.cancel();throw Error('Range unavailable: '+response.status+' '+url);
        }
        return {bytes:Buffer.from(await response.arrayBuffer()),source:response.url,modified:response.headers.get('last-modified')};
      }catch(error){
        if(attempt>=1)throw error;
        await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
      }
    }
  });
}
export async function listArchives(){
  await mkdir(folder,{recursive:true});
  const all=await disk(join(folder,'targets.json'),async()=>{
    const response=await fetch('https://download.geofabrik.de/index-v1-nogeom.json',{signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw Error('Geofabrik catalog unavailable');
    const listing=await response.json();
    return listing.features.map(f=>f.properties).filter(p=>p.urls.shp &&
      (p.parent==='us' || p.parent==='us/california' || ['micronesia','samoa'].includes(p.id)))
      .map(p=>({slug:p.id.replace(/^us\//,''),url:p.urls.shp}));
  },true);
  if(!all.some(p=>p.slug==='norcal')||!all.some(p=>p.slug==='alaska'))throw Error('Incomplete national source catalog');
  return all;
}
export async function fetchArchive(slug,url){
  await mkdir(join(folder,slug),{recursive:true});
  return disk(join(folder,slug,'archive.json'),async()=>{
    const {bytes,source,modified}=await range(url,'-65536');
    const files={};
    for(let i=0;i+46<bytes.length;i++){
      if(bytes.readUInt32LE(i)!==0x02014b50)continue;
      const len=bytes.readUInt16LE(i+28);
      const name=bytes.toString('utf8',i+46,i+46+len);
      // Only these members are needed to reconstruct a geographic point.
      if(!/^gis_osm_(pois|traffic|transport)(_a)?_free_1\.(dbf|shp)$/.test(name))continue;
      let offset=bytes.readUInt32LE(i+42);
      const compressed=bytes.readUInt32LE(i+20), size=bytes.readUInt32LE(i+24);
      if(offset===0xffffffff){
        const end=i+46+len+bytes.readUInt16LE(i+30);
        for(let p=i+46+len;p+4<=end;){
          const tag=bytes.readUInt16LE(p),length=bytes.readUInt16LE(p+2);
          if(tag===1){offset=Number(bytes.readBigUInt64LE(p+4+(size===0xffffffff?8:0)+(compressed===0xffffffff?8:0)));break;}
          p+=4+length;
        }
      }
      files[name]={offset,compressed,size,method:bytes.readUInt16LE(i+10)};
    }
    if(!files['gis_osm_pois_free_1.dbf'])throw Error('POI directory missing in '+slug);
    return {slug,source,modified,files};
  },true);
}
export async function readMember(archive,name){
  const e=archive.files[name];
  if(!e)throw Error('Missing '+name+' for '+archive.slug);
  const path=join(folder,archive.slug,name+'.compressed');
  const bytes=await disk(path,async()=>{
    const {bytes}=await range(archive.source,e.offset+'-'+(e.offset+e.compressed+1023));
    if(bytes.readUInt32LE(0)!==0x04034b50)throw Error('Local ZIP header missing for '+name);
    const start=30+bytes.readUInt16LE(26)+bytes.readUInt16LE(28);
    const raw=bytes.subarray(start,start+e.compressed);
    if(raw.length!==e.compressed || bytes.toString('utf8',30,30+bytes.readUInt16LE(26))!==name)throw Error('Archive member mismatch: '+archive.slug+' '+name);
    return raw;
  });
  const data=e.method===0?bytes:inflateRawSync(bytes);
  if(data.length!==e.size)throw Error('Uncompressed size mismatch: '+name);
  return data;
}

// Adjacent DBF/SHP entries occupy one contiguous range in Geofabrik's archives.
// A range per group avoids repeatedly opening the same regional file.
export async function readLayerGroup(archive, layer) {
  const directory=join(folder,archive.slug);
  const pattern=layer==='pois' ? /^gis_osm_pois_/ : /^gis_osm_(traffic|transport)_/;
  const members=Object.entries(archive.files).filter(([name])=>pattern.test(name));
  if(!members.length)return 0;
  const available=new Set(await readdirNames(directory));
  const missing=members.filter(([name])=>!available.has(name+'.compressed'));
  if(!missing.length)return 0;
  if(missing.length===1){
    await readMember(archive,missing[0][0]);
    return 1;
  }
  const left=Math.min(...missing.map(([,e])=>e.offset));
  const right=Math.max(...missing.map(([,e])=>e.offset+e.compressed+1023));
  let bytes;
  try {
    ({bytes}=await range(archive.source,left+'-'+right));
  } catch {
    // A large range may time out even when individual ZIP members are reachable.
    // Preserve the same dated archive and validate each member against its directory.
    for (const [name] of missing) {
      const source=new URL(archive.source);
      source.searchParams.set('extract',name.replaceAll('.','_'));
      await readMember({...archive,source:source.href},name);
    }
    return missing.length;
  }
  for(const [name,e] of missing){
    const off=e.offset-left;
    if(bytes.readUInt32LE(off)!==0x04034b50)throw Error('Invalid local header for '+archive.slug+' '+name);
    const namelen=bytes.readUInt16LE(off+26);
    const start=off+30+namelen+bytes.readUInt16LE(off+28);
    const raw=bytes.subarray(start,start+e.compressed);
    if(bytes.toString('utf8',off+30,off+30+namelen)!==name || raw.length!==e.compressed)throw Error('Truncated '+name);
    const dest=join(directory,name+'.compressed');
    const tmp=dest+'.'+Math.random().toString(36).slice(2)+'.tmp';
    await writeFile(tmp,raw);await rename(tmp,dest);
  }
  return missing.length;
}
