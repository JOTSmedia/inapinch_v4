// Rebuild from the federal inventory, or pass a previously downloaded
// {source,features} ArcGIS response as the first argument.
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const source='https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/NTAD_Truck_Stop_Parking/FeatureServer/0';
const compiled='2019-04-09';
const clean=value=>{
  const text=String(value??'').trim().replace(/\s+/g,' ');
  return /^(NA|N\/A|UNKNOWN|NULL|NONE|NOT AVAILABLE)$/i.test(text)?'':text;
};

function facilityType(name){
  if(/weigh(?:t)? (?:station|scale|enforcement)|port of entry|inspection station|\(POE\)/i.test(name))return 'Weigh or inspection station';
  if(/truck[- ]only|truck parking|truck pull[- ]off/i.test(name))return 'Truck parking';
  if(/rest stop or truck facility/i.test(name))return 'Highway rest or truck facility';
  if(/welcome (?:center|centre)|visitor (?:information )?center|travel information center/i.test(name))return 'Highway visitor center';
  if(/service plaza|travel plaza|turnpike plaza/i.test(name))return 'Highway service plaza';
  if(/rest\s*(?:area|stop|haven)/i.test(name))return 'Highway rest area';
  if(/parking/i.test(name))return 'Highway parking area';
  return 'Highway rest or truck facility';
}

export function fromInventory(feature) {
  const a=feature.attributes;
  const objectId=a.OBJECTID;
  const lat=a.latitude,lng=a.longitude;
  if(!Number.isSafeInteger(objectId)||objectId<=0||!Number.isFinite(lat)||lat<24||lat>50||!Number.isFinite(lng)||lng< -125||lng> -66)throw Error('Invalid continental U.S. survey record '+objectId);
  const state=clean(a.state),locality=clean(a.municipality),county=clean(a.county),name=clean(a.nhs_rest_stop);
  const category=facilityType(name);
  const route=clean(a.highway_route);
  const mile=clean(a.mile_post);
  const mileLabel=/^\d+(?:\.\d+)?$/.test(mile)?'mile '+mile:mile;
  const region=locality||county;
  const address=[route,mileLabel,region,state].filter(Boolean).join(', ');
  const noFacilities=/no facilities|no services/i.test(name);
  const truckOnly=/truck[- ]only/i.test(name);
  const limited=category==='Weigh or inspection station'||category==='Truck parking';
  const accessNote=noFacilities?'The federal inventory describes this stop as having no facilities or services. Choose another stop for a bathroom.':truckOnly?'The survey identifies this as a truck-only stop. Check posted vehicle restrictions.':limited?'This location serves commercial vehicles. Public entry and restroom access are unconfirmed.':'Check posted entry rules, hours and restroom access before stopping.';
  return {
    id:'us-ntad-'+objectId,cityId:'us',name:name||[route,'truck parking facility'].filter(Boolean).join(' '),category,
    lat,lng,state,locality,address,addressKnown:false,neighborhood:[region,state].filter(Boolean).join(', '),
    coordinateAccuracy:'facility',priority:noFacilities||limited?95:58,roadside:true,showers:null,
    access:'unknown',bathroomConfirmed:false,accessible:null,changingTable:null,purchaseLikely:false,
    dynamicListing:true,evidenceType:'federal-inventory',accessNote,
    note:'This location appears in the FHWA truck parking inventory compiled in 2019. The inventory records facilities for commercial vehicles. Current operating status, bathroom access and shower availability are unverified.',
    searchTerms:['highway roadside truck parking',route,region,state].filter(Boolean).join(' '),
    sources:[{label:'Federal survey record',url:source+'/'+objectId},{label:'FHWA / BTS truck parking inventory',url:source}],
    checkedLabel:'Federal highway inventory · compiled April 2019'
  };
}

async function download(){
  async function query(params){
    const response=await fetch(source+'/query?'+new URLSearchParams({...params,f:'json'}),{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('Federal source HTTP '+response.status);
    const data=await response.json();
    if(data.error)throw Error(data.error.message);
    return data;
  }
  const {count}=await query({where:'1=1',returnCountOnly:'true'});
  const features=[];
  while(features.length<count){
    const data=await query({where:'1=1',outFields:'*',outSR:'4326',orderByFields:'OBJECTID',resultRecordCount:'400',resultOffset:String(features.length)});
    if(!data.features?.length)throw Error('Federal source pagination ended early');
    features.push(...data.features);
  }
  if(features.length!==count)throw Error('Federal inventory changed during import');
  return {source,features};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const input=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):await download();
  if(input.source!==source||!Array.isArray(input.features)||!input.features.length)throw Error('Unexpected federal inventory source');
  const locations=input.features.map(fromInventory).sort((a,b)=>Number(a.id.slice(8))-Number(b.id.slice(8)));
  if(new Set(locations.map(p=>p.id)).size!==locations.length)throw Error('Duplicate federal survey ID');
  const counts={};
  for(const place of locations)counts[place.category]=(counts[place.category]||0)+1;
  const snapshot={source,checked:new Date().toISOString().slice(0,10),compiled,rights:'U.S. government work, available for unrestricted public use.',locations};
  await writeFile(new URL('../data/travel-rest-areas.json',import.meta.url),JSON.stringify(snapshot)+'\n');
  console.log(locations.length+' records across '+new Set(locations.map(p=>p.state)).size+' states',counts);
}
