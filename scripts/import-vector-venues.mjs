// Refresh public POI snapshots within a small 3x3 tile neighborhood per city.
// Respect OpenFreeMap's download limit (50 MB, <=4 concurrent tile requests).
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {decodeTile,pointToCoordinates} from './vector-poi.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const MAX_BYTES=47*1024*1024;
export function venueKind(p){
 const accepted=new Set(['restaurant','bar','pub','biergarten','cafe','fast_food','food_court','nightclub','toilets','beer']);
 return [p.subclass,p.class].find(k=>accepted.has(k))||null;
}
export async function downloadCity(city,meta,budget={bytes:0,tiles:0}) {
 const z=14,tx=Math.floor((city.lng+180)/360*2**z),ty=Math.floor((1-Math.asinh(Math.tan(city.lat*Math.PI/180))/Math.PI)/2*2**z);
 const places=new Map();let cityBytes=0;
 const offsets=[[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
 for(let i=0;i<offsets.length;i+=3){
  if(budget.bytes>=MAX_BYTES)break;
  await Promise.all(offsets.slice(i,i+3).map(async ([dx,dy])=>{
   const x=tx+dx,y=ty+dy,url=meta.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);
   const response=await fetch(url,{headers:{'User-Agent':'InAPinch/3.0 (+https://github.com/JOTSmedia/inapinch)'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Vector tile HTTP '+response.status);
   const bytes=new Uint8Array(await response.arrayBuffer());budget.bytes+=bytes.length;budget.tiles++;cityBytes+=bytes.length;
   const pois=decodeTile(bytes).poi||[];
   for(const f of pois){
    const kind=venueKind(f.properties);const name=f.properties['name:latin']||f.properties.name;
    if(!kind||f.type!==1||f.x===null||(!name&&kind!=='toilets'))continue;
    const coords=pointToCoordinates(f.x,f.y,z,x,y,f.extent);
    const key=[name||kind,coords.lat.toFixed(5),coords.lng.toFixed(5)].join('|');
    places.set(key,{name:name||'Mapped restroom',kind,...coords,featureId:f.id,tile:`${z}/${x}/${y}`,source:meta.tiles[0]});
   }
  }));
 }
 return {cityId:city.id,source:'OpenFreeMap / OpenMapTiles / OpenStreetMap',retrievedAt:new Date().toISOString(),bytes:cityBytes,zoom:z,bounds:[pointToCoordinates(0,0,z,tx-1,ty-1).lat,pointToCoordinates(0,0,z,tx-1,ty-1).lng,pointToCoordinates(4096,4096,z,tx+1,ty+1).lat,pointToCoordinates(4096,4096,z,tx+1,ty+1).lng],places:[...places.values()]};
}
if(typeof process!=='undefined'&&process.argv[1]===fileURLToPath(import.meta.url)){
 const cities=JSON.parse(await readFile(root+'cities.json','utf8'));const meta=await(await fetch('https://tiles.openfreemap.org/planet')).json();const budget={bytes:0,tiles:0};
 await mkdir(root+'work/vector-poi',{recursive:true});
 for(const city of cities){const result=await downloadCity(city,meta,budget);await writeFile(root+`work/vector-poi/${city.id}.json`,JSON.stringify(result));console.log(city.id,result.places.length);}
 console.log(budget);
}
