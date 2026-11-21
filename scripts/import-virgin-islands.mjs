// Maintainer import. Run successive batches to resume the same dated tileset.
import {mkdir, readFile, readdir, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeTile, pointToCoordinates} from './vector-poi.mjs';
import {venueKind} from '../venue-data.js';
import {usRegionAt, usRegionsInBounds} from '../us-geography.js';

const work = fileURLToPath(new URL('../work/', import.meta.url));
const zoom = 14;
const scale = 2 ** zoom;
const metadataURL = 'https://tiles.openfreemap.org/planet';
const byteBudget = 48_000_000;
// Include the inhabited islands and adjacent cays. Clip POIs using official jurisdiction geometry.
const viWindows = [
  {west:-65.10, south:18.278, east:-64.646, north:18.429}, // St. Thomas, Water Island, St. John
  {west:-64.918, south:17.665, east:-64.551, north:17.809} // St. Croix and Buck Island
];
const box = (west,south,east,north)=>({west,south,east,north});
const targets = {
  VI: {slug:'us-virgin-islands', windows:viWindows,
    centers:[[-64.9307,18.3419],[-64.794,18.332],[-64.704,17.744],[-64.883,17.712]]},
  GU: {slug:'guam', windows:[box(144.562,13.181,145.010,13.707)],
    centers:[[144.751,13.474],[144.8,13.50],[144.839,13.558],[144.67,13.29]]},
  AS: {slug:'american-samoa', windows:[
    box(-170.84,-14.376,-170.541,-14.224), // Tutuila and Aunuu
    box(-169.677,-14.2,-169.595,-14.15), // Ofu and Olosega
    box(-169.525,-14.275,-169.414,-14.205), // Tau
    box(-171.094,-11.066,-171.061,-11.037), // Swains
    box(-168.170,-14.557,-168.145,-14.530) // Rose Atoll
  ], centers:[[-170.703,-14.278],[-169.67,-14.177],[-169.5,-14.25],[-171.08,-11.054]]},
  MP: {slug:'northern-mariana-islands', windows:[
    box(145.68,15.068,145.846,15.291), // Saipan, Managaha
    box(145.574,14.88,145.725,15.105), // Tinian
    box(145.539,14.834,145.582,14.867), // Aguijan
    box(145.114,14.103,145.306,14.212), // Rota
    box(145.702,18.053,145.835,18.177), // Pagan
    box(145.786,17.546,145.874,17.64), // Alamagan
    box(145.619,18.707,145.706,18.808), // Agrihan
    box(146.041,15.995,146.089,16.036), // Farallon de Medinilla
    box(145.618,16.30,145.726,16.407), // Anatahan
    box(145.749,16.676,145.811,16.733), // Sarigan
    box(145.815,17.284,145.876,17.344), // Guguan
    box(145.35,19.63,145.45,19.718), // Asuncion
    box(145.18,20.00,145.27,20.06), // Maug
    box(144.86,20.511,144.922,20.57) // Farallon de Pajaros
  ], centers:[[145.72,15.214],[145.625,14.97],[145.142,14.135],[145.755,18.123]]}
};
export const territorySlugs = Object.fromEntries(Object.entries(targets).map(([code,target])=>[target.slug, code]));
const col = x => Math.floor((x + 180) / 360 * scale);
const row = y => Math.floor((1 - Math.asinh(Math.tan(y*Math.PI/180)) / Math.PI) / 2 * scale);
const nearestCenter = (p,centers) => Math.min(...centers.map(([x,y]) => (x-p.lng)**2+(y-p.lat)**2));

export function territoryTiles(code='VI') {
  const {windows,centers}=targets[code];
  const tiles = new Map();
  for (const box of windows) {
    for (let x=col(box.west);x<=col(box.east);x++) {
      for (let y=row(box.north);y<=row(box.south);y++) {
        const a=pointToCoordinates(0,0,zoom,x,y), b=pointToCoordinates(4096,4096,zoom,x,y);
        if (!usRegionsInBounds({west:a.lng,south:b.lat,east:b.lng,north:a.lat}).some(r=>r.code===code)) continue;
        const key=x+'-'+y;
        tiles.set(key,{x,y,key,rank:nearestCenter(pointToCoordinates(2048,2048,zoom,x,y),centers)});
      }
    }
  }
  return [...tiles.values()].sort((a,b)=>a.rank-b.rank);
}

export const viTiles=()=>territoryTiles('VI');

async function atomicJSON(file,data) {
  const tmp=file+'.tmp';
  await writeFile(tmp,JSON.stringify(data));
  await rename(tmp,file);
}

async function cachedJSON(file) {
  try { return JSON.parse(await readFile(file,'utf8')); }
  catch (error) { if (error.code==='ENOENT') return null; throw error; }
}

export function territoryRows(bytes,x,y,code='VI') {
  const rows=[];
  for (const f of decodeTile(bytes,'poi').poi || []) {
    const kind=venueKind(f.properties);
    if (!kind || f.x===null || f.y===null || f.type!==1) continue;
    const {lat,lng}=pointToCoordinates(f.x,f.y,zoom,x,y,f.extent);
    if (usRegionAt(lat,lng)?.code!==code) continue;
    const name=f.properties['name:latin']||f.properties.name||f.properties['name:en']||'';
    const id=f.id??[kind,lat.toFixed(5),lng.toFixed(5),name].join('|');
    rows.push([kind,id,name,Number(lat.toFixed(6)),Number(lng.toFixed(6))]);
  }
  return rows;
}

export const viRows=(bytes,x,y)=>territoryRows(bytes,x,y,'VI');

async function readTile(tile,template,allowance,fetchImpl,cache,code) {
  let received=0;
  try {
    const url=template.replace('{z}',zoom).replace('{x}',tile.x).replace('{y}',tile.y);
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(9000)});
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('HTTP '+response.status);
    }
    if (Number(response.headers.get('content-length'))>allowance) {
      await response.body?.cancel(); throw Error('Download budget exhausted');
    }
    const chunks=[];
    const reader=response.body?.getReader();
    if (reader) {
      for (;;) {
        const part=await reader.read();
        if (part.done) break;
        received+=part.value.length;
        if(received>allowance){await reader.cancel();throw Error('Download budget exhausted');}
        chunks.push(part.value);
      }
    }
    const rows=territoryRows(Buffer.concat(chunks),tile.x,tile.y,code);
    await atomicJSON(join(cache,tile.key+'.json'),{received,rows});
    return {received};
  } catch(error) { return {received,error:String(error.message||error)}; }
}

let busy=false;
export async function downloadTerritoryBatch({code='VI',limit=24,tileJSON,fetchImpl=fetch}={}) {
  if (!Object.hasOwn(targets,code)) throw Error('Unknown U.S. territory: '+code);
  const {slug,windows}=targets[code];
  const output=join(work,code.toLowerCase()+'-vector');
  const cache=join(output,'tiles');
  if (busy) throw Error('Run one territory batch at a time');
  busy=true;
  try {
    await mkdir(cache,{recursive:true});
    const prev=await cachedJSON(join(output,'manifest.json'));
    let template=prev?.template || tileJSON?.tiles?.[0];
    if (!template) {
      const response=await fetchImpl(metadataURL,{signal:AbortSignal.timeout(9000)});
      if (!response.ok) throw Error('OpenFreeMap TileJSON HTTP '+response.status);
      template=(await response.json()).tiles[0];
    }
    if (new URL(template).origin!=='https://tiles.openfreemap.org') throw Error('Unexpected vector tile source');
    if (!prev) await atomicJSON(join(output,'manifest.json'),{metadataURL,template,zoom,windows,completedTiles:[],failedBytes:0,failures:{}});
    const plan=territoryTiles(code);
    const cached=await readdir(cache);
    const completed=new Set(cached.filter(s=>s.endsWith('.json')).map(s=>s.slice(0,-5)));
    const failures=prev?.failures || {};
    const rows=new Map();
    let bytes=prev?.failedBytes || 0;
    let failedBytes=bytes;
    for (const key of completed) {
      const record=await cachedJSON(join(cache,key+'.json'));
      bytes+=record.received;
      delete failures[key];
      for(const item of record.rows) rows.set(item[1],item);
    }
    const pending=plan.filter(t=>!completed.has(t.key)).sort((a,b)=>(failures[a.key]?.attempts||0)-(failures[b.key]?.attempts||0));
    const batch=pending.slice(0,Math.max(0,Math.min(plan.length,Math.floor(limit))));
    for(let i=0;i<batch.length;i+=3) {
      const group=batch.slice(i,i+3);
      const allowance=Math.floor((byteBudget-bytes)/group.length);
      if(allowance<90_000)break;
      const results=await Promise.all(group.map(t=>readTile(t,template,allowance,fetchImpl,cache,code)));
      for(const [j,result] of results.entries()){
        const {key}=group[j];bytes+=result.received;
        if(result.error){failedBytes+=result.received;failures[key]={attempts:(failures[key]?.attempts||0)+1,error:result.error};}
        else {
          completed.add(key);delete failures[key];
          const record=await cachedJSON(join(cache,key+'.json'));
          for(const item of record.rows)rows.set(item[1],item);
        }
      }
    }
    const date=template.match(/\/(20\d{2})(\d{2})(\d{2})[_/]/);
    const result={planned:plan.length,done:completed.size,remaining:plan.length-completed.size,bytes,rows:rows.size,failed:Object.keys(failures).length};
    await atomicJSON(join(output,slug+'.json'),[...rows.values()].sort((a,b)=>a[3]-b[3]||a[4]-b[4]));
    await atomicJSON(join(output,'manifest.json'),{source:'OpenStreetMap contributors via OpenFreeMap / OpenMapTiles',metadataURL,template,sourceDate:date?date.slice(1,4).join('-'):null,retrievedAt:new Date().toISOString(),zoom,windows,completedTiles:[...completed].sort(),...result,failedBytes,failures});
    return result;
  } finally {busy=false;}
}

export const downloadVIBatch=(options={})=>downloadTerritoryBatch({...options,code:'VI'});

if(typeof process!=='undefined' && process.argv[1]===fileURLToPath(import.meta.url)){
    const code=process.argv[2]?.toUpperCase();
  const hasCode=Object.hasOwn(targets,code);
  console.log(await downloadTerritoryBatch({code:hasCode?code:'VI',limit:Number(process.argv[hasCode?3:2]||24)}));
}
