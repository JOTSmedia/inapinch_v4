import {readdir, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {usRegionAt} from '../us-geography.js';
import {venueKind} from '../venue-data.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const grid=(lat,lng,z)=>{
  const n=2**z;
  return [Math.min(n-1,Math.floor((lng+180)/360*n)),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)];
};
const aliases={toilet:'toilets',chemist:'pharmacy',guesthouse:'guest_house',arts_centre:'arts_centre',biergarten:'biergarten',fast_food:'fast_food',camp_site:'camp_site',foodcourt:'food_court',sports_centre:'sports_centre',general:'convenience',bicycle_rental:'bicycle_rental'};
const chunks=new Map(),cells=new Map(),states=new Map(),seen=new Map(),kinds=[];
const manifests=[];
const increment=(object,key)=>object.set(key,(object.get(key)||0)+1);
const inputs=[['nation-points','n'],['nation-areas','a'],['roads-points','n'],['roads-areas','a'],...['vi','gu','mp','as'].map(code=>[code+'-vector','v'])];
let count=0,restrooms=0,roadside=0;
const kindCounts={};
const roadsideKinds=new Set(['fuel','rest_area','services','truck_stop']);
const rank=k=>k==='toilets'?0:k==='shower'||k==='showers'?1:roadsideKinds.has(k)?2:3;
function attachKind(record,cell,kind){
  if(!kinds.includes(kind))kinds.push(kind);
  const index=kinds.indexOf(kind);
  const tagged=record[1]===null?[]:[record[1],...(record[5]||[])];
  if(tagged.includes(index))return;
  if(kind==='toilets'){cell[4]++;cell[7]+=record[2];cell[8]+=record[3];restrooms++;}
  if(roadsideKinds.has(kind) && !tagged.some(i=>roadsideKinds.has(kinds[i]))){
    cell[9]++;cell[10]+=record[2];cell[11]+=record[3];roadside++;
  }
  tagged.push(index);tagged.sort((a,b)=>rank(kinds[a])-rank(kinds[b]));
  record[1]=tagged[0];if(tagged.length>1)record[5]=tagged.slice(1);
  kindCounts[kind]=(kindCounts[kind]||0)+1;
}
for(const [directory,prefix] of inputs){
  const dir=join(root,'work',directory);
  const names=await readdir(dir).catch(()=>[]);
  for(const name of names.sort()){
    if(!name.endsWith('.json') || name==='samoa.json' || name==='micronesia.json')continue;
    const data=JSON.parse(await readFile(join(dir,name),'utf8'));
    if(!Array.isArray(data)){manifests.push({file:directory+'/'+name,data});continue;}
    for(const [sourceKind,sourceId,name,lat,lng] of data){
      const kind=aliases[sourceKind] || sourceKind;
      if(!venueKind({class:kind}) || !Number.isFinite(lat) || !Number.isFinite(lng))continue;
      const id=prefix+sourceId;
      if(seen.has(id)){
        const [record,cell]=seen.get(id);
        attachKind(record,cell,kind);
        if(!record[4]&&name)record[4]=name;
        continue;
      }
      const region=usRegionAt(lat,lng);
      if(!region)continue;
      const [x,y]=grid(lat,lng,7),chunk=x+'-'+y;
      const [cx,cy]=grid(lat,lng,9),cell=cx+'-'+cy+'-'+region.code;
      const rawLat=Math.round(lat*1e5),rawLng=Math.round(lng*1e5);
      if(!chunks.has(chunk))chunks.set(chunk,[]);
      const record=[id,null,rawLat,rawLng,name||''];
      chunks.get(chunk).push(record);
      if(!cells.has(cell))cells.set(cell,[cx,cy,region.code,0,0,0,0,0,0,0,0,0]);
      const c=cells.get(cell);
      c[3]++;c[5]+=rawLat;c[6]+=rawLng;
      attachKind(record,c,kind);seen.set(id,[record,c]);
      increment(states,region.code);count++;
    }
  }
}
if(!count)throw Error('No national source files were available.');
const dest=join(root,'data','atlas');
await mkdir(dest,{recursive:true});
const entries=[];
for(const [key,rows] of [...chunks].sort()){
  rows.sort((a,b)=>a[2]-b[2] || a[3]-b[3] || a[0].localeCompare(b[0]));
  const zip=gzipSync(JSON.stringify(rows),{level:9}).toString('base64');
  await writeFile(join(dest,key+'.js'),'globalThis.inAPinchAtlasData('+JSON.stringify(key)+',"'+zip+'");\n');
  entries.push([key,rows.length]);
}
for(const name of await readdir(dest)){if(name.endsWith('.js') && !chunks.has(name.slice(0,-3)))await rm(join(dest,name));}
for(const c of cells.values()){c[5]=Math.round(c[5]/c[3]);c[6]=Math.round(c[6]/c[3]);c[7]=c[4]?Math.round(c[7]/c[4]):0;c[8]=c[4]?Math.round(c[8]/c[4]):0;c[10]=c[9]?Math.round(c[10]/c[9]):0;c[11]=c[9]?Math.round(c[11]/c[9]):0;}
// The display anchor for every area is an actual mapped facility nearest its
// centroid. Selecting a coastal area therefore lands on a stop, including islands.
const anchors=new Map();
for(const [row,c] of seen.values()){
  const tags=[row[1],...(row[5]||[])].map(i=>kinds[i]);
  if(!anchors.has(c))anchors.set(c,[]);
  const chosen=anchors.get(c);
  for(const offset of [5,...(tags.includes('toilets')?[7]:[]),...(tags.some(k=>roadsideKinds.has(k))?[10]:[])]){
    const dx=(row[3]-c[offset+1])*Math.cos(c[offset]/1e5*Math.PI/180), dy=row[2]-c[offset];
    const squared=dx*dx+dy*dy;
    if(!chosen[offset] || squared<chosen[offset].distance)chosen[offset]={lat:row[2],lng:row[3],distance:squared};
  }
}
for(const [cell,picks] of anchors){
  for(const offset of [5,7,10]){
    if(picks[offset]){cell[offset]=picks[offset].lat;cell[offset+1]=picks[offset].lng;}
  }
}
const catalog={source:'OpenStreetMap contributors via Geofabrik and OpenFreeMap',license:'ODbL 1.0',checked:new Date().toISOString().slice(0,10),chunkZoom:7,cellZoom:9,count,restrooms,roadside,kindCounts,regions:Object.fromEntries([...states].sort()),kinds,chunks:entries,cells:[...cells.values()]};
await writeFile(join(root,'data','atlas-catalog.json'),JSON.stringify(catalog));
await writeFile(join(root,'data','atlas-sources.json'),JSON.stringify({source:'https://download.geofabrik.de/north-america/us.html',license:'https://www.openstreetmap.org/copyright',imports:manifests},null,2)+'\n');
console.log(JSON.stringify({count,restrooms,states:states.size,files:entries.length}));
