import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../work/retail/',import.meta.url));
const service='https://pilotcompany.com/api/locations/';
const centers=[[48.0,-122.1],[42.5,-121.2],[35.4,-119.0],[46.5,-112.0],[39.25,-112.0],[32.2,-110.9],[46.3,-101.4],[40.5,-102.0],[34.5,-103.0],[30.9,-98.2],[44.1,-93.5],[36.1,-94.5],[31.1,-89.8],[45.3,-84.6],[38.5,-84.3],[33.3,-82.6],[27.8,-82.0],[39.7,-75.3],[44.5,-69.4],[61.2,-149.9],[21.3,-157.9]];
async function get(path){
  const response=await fetch(service+path,{signal:AbortSignal.timeout(12500)});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
}
function trim(p){
  return {...p,parking:undefined,fuelCodes:undefined,fuelPrices:undefined,
    linesOfBusiness:(p.linesOfBusiness||[]).filter(b=>b.isPrimaryLineOfBusiness||b.offerings?.some(o=>String(o.offeringCode)==='322')).map(b=>({...b,
      hoursOfOperation:undefined,storeGroupCodes:undefined,offerings:(b.offerings||[]).filter(o=>String(o.offeringCode)==='322')}))};
}
async function windows(){
  await mkdir(root+'pilot-windows',{recursive:true});
  const todo=[...centers],failed=[];
  async function work(){while(todo.length){
    const [lat,lon]=todo.shift(),fn=root+'pilot-windows/'+lat+'_'+lon+'.json';
    try{
      try{const window=JSON.parse(await readFile(fn,'utf8'));if(Array.isArray(window))continue;}catch{ /* A missing or incomplete response needs a fresh request. */ }
      const params=new URLSearchParams({latitude:String(lat),longitude:String(lon),radius:'500'});
      const data=await get('radiusSearch?'+params);
      if(!Array.isArray(data.locations))throw Error('Invalid results');
      await writeFile(fn,JSON.stringify(data.locations.map(trim)));
    }catch(e){failed.push([lat,lon,String(e)]);}
  }}
  await Promise.all([work(),work(),work()]);
  return failed;
}
async function finish(){
  const all=JSON.parse(await readFile(root+'pilot-export')).locations.filter(p=>p.country==='United States');
  const ids=new Set(all.map(q=>String(q.locationId))),places=new Map(),failed=[];
  for(const [lat,lon] of centers){
    try{for(const p of JSON.parse(await readFile(root+'pilot-windows/'+lat+'_'+lon+'.json')))if(ids.has(String(p.locationId)))places.set(String(p.locationId),p);}catch{}
  }
  const missing=[...ids].filter(id=>!places.has(id));
  const out=()=>writeFile(root+'pilot-sites.json',JSON.stringify({source:service,locations:[...places.values()],expected:ids.size,missing:[...ids].filter(id=>!places.has(id))}));
  await out();
  if(missing.length>150)return {expected:ids.size,available:places.size,missing:missing.length};
  async function details(){while(missing.length){const id=missing.shift();try{let p=await get(id);if(String(p.locationId)===id)places.set(id,trim(p));}catch(e){failed.push(id);}}}
  await Promise.all([details(),details(),details()]);await out();
  return {expected:ids.size,found:places.size,failed};
}

// A fresh directory keeps a new export and its radius responses on the same run.
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  await mkdir(root,{recursive:true});
  const date=new Date().toISOString().slice(0,10);
  const version=JSON.parse(await readFile(root+'pilot-import-date.json','utf8').catch(()=>'null'));
  if(version!==date){
    const {rm}=await import('node:fs/promises');
    await rm(root+'pilot-windows',{recursive:true,force:true});
    const snapshot=await get('export');
    if(!Array.isArray(snapshot.locations)||!snapshot.locations.length)throw Error('Missing operator directory');
    await writeFile(root+'pilot-export',JSON.stringify(snapshot));
    await writeFile(root+'pilot-import-date.json',JSON.stringify(date));
  }
  const failedAreas=await windows();
  const result=await finish();
  console.log(JSON.stringify({failedAreas,...result}));
  if(result.found!==result.expected)process.exitCode=1;
}
