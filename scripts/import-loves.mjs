// The store locator's public HTML lists /api/fetch_stores as its data source.
// Join those records to actual operator location links, preserving store numbers.
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const origin='https://www.loves.com';
const directoryURL=origin+'/location-and-fuel-price-search/all-locations';
const dataURL=origin+'/api/fetch_stores';
const root=new URL('../',import.meta.url);
const validTypes=new Set(['Travel Stop','Car Stop','Country Store']);

export function storeLinks(html) {
  const result=new Map();
  for(const [,path,number] of html.matchAll(/href="(\/locations\/[a-z]{2}\/[^/"<>\s]+\/loves-(?:travel-stop|country-store)-[^/"<>\s]+?-(\d+))"/g)){
    result.set(Number(number),origin+path);
  }
  return result;
}

function countValue(value) {
  const s=String(value??'').trim();
  return /^\d{1,3}$/.test(s) ? Number(s) : null;
}

function detailRecord(html) {
  if(!html)return null;
  const block=html.match(/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return block ? JSON.parse(block[1]).props?.pageProps?.locationData : null;
}

export function normalizeLove(record, url, checked, detail) {
  const number=record.number;
  if(!validTypes.has(record.facilitySubtypeName))return null;
  if(!Number.isSafeInteger(number)||!url?.endsWith('-'+number))throw Error('Missing or mismatched operator listing for store '+number);
  const lat=record.latitude,lng=record.longitude;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<18||lat>72||lng< -180||lng> -60)throw Error('Invalid U.S. store coordinates');
  const state=String(record.state||'').trim().toUpperCase();
  const locality=String(record.city||'').trim();
  if(!/^[A-Z]{2}$/.test(state)||!locality)throw Error('Invalid store location');
  const amenities=record.mappedCustomFields?.amenities || [];
  const shower=amenities.find(f=>f.smaFieldName==='privateshowers');
  const privateShowers=String(shower?.fieldValue??'').trim().toLowerCase();
  const countField=detail?.number===number && detail.customFields?.find(f=>f.fieldName==='showercount');
  const showerCount=countValue(countField?.fieldValue);
  const showers=showerCount!==null ? showerCount>0 : privateShowers==='true' ? true : privateShowers==='false' ? false : null;
  const street=[record.address1,record.address2].filter(Boolean).join(' ').trim();
  return {
    id:'us-loves-'+number, cityId:'us', name:"Love's "+record.facilitySubtypeName+' #'+number+' · '+locality,
    category:record.facilitySubtypeName==='Travel Stop'?'Truck stop':'Gas station', state, locality, lat,lng,
    address:[street,locality,[state,record.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    addressKnown:Boolean(street), neighborhood:locality+', '+state, coordinateAccuracy:'facility', priority:35, roadside:true,
    showers,showerCount,accessibleShowerCount:null,
    showerNote:showers===true ? 'Showers listed by the operator. Check with the stop for availability and fees.' :
      showers===false ? 'The operator lists no showers at this location.' : 'The operator entry does not confirm shower availability.',
    access:'unknown', bathroomConfirmed:false, accessible:null, changingTable:null, purchaseLikely:false,
    dynamicListing:true, evidenceType:'operator-directory', accessNote:'Ask staff about restroom access and any purchase or entry requirements.',
    note:"Love's lists this facility. Restroom access and hours are unverified.", phone:record.phoneNumber||'',
    searchTerms:["Love's Loves travel stop country store gas station fuel highway",record.highway,record.exitNumber?'Exit '+record.exitNumber:''].filter(Boolean).join(' '),
    sources:[{label:"Love's store and amenities",url},{label:"Love's location directory",url:directoryURL}],
    checkedLabel:"Love's Travel Stops · "+checked
  };
}

export function buildLoveSnapshot(html,bulk,{checked=new Date().toISOString().slice(0,10),detailHTML}={}) {
  const links=storeLinks(html);
  if(!links.size || !Array.isArray(bulk.stores) || !bulk.stores.length)throw Error('Operator directory is empty');
  const detail=detailRecord(detailHTML);
  const locations=bulk.stores.map(r=>normalizeLove(r,links.get(r.number),checked,detail)).filter(Boolean);
  if(!locations.length || new Set(locations.map(p=>p.id)).size!==locations.length)throw Error('Invalid store IDs');
  locations.sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}));
  return {source:dataURL,directory:directoryURL,checked,locations};
}

// Only the public store list and map export are required. One accessible
// detail page illustrates a published shower count; numeric counts elsewhere
// remain absent when the source provides an availability flag alone.
export async function refreshLoves({fromCache=false,fetchImpl=fetch}={}) {
  async function source(file,url) {
    if(fromCache)return readFile(new URL('work/retail/'+file,root),'utf8');
    const res=await fetchImpl(url,{signal:AbortSignal.timeout(12000)});
    if(!res.ok)throw Error('Operator source HTTP '+res.status);
    return res.text();
  }
  const [html,bulk]=await Promise.all([source('loves.html',directoryURL),source('loves-stores',dataURL)]);
  const clanton=storeLinks(html).get(368);
  const detailHTML=clanton ? await source('loves-368',clanton).catch(()=>null) : null;
  const data=buildLoveSnapshot(html,JSON.parse(bulk),{detailHTML});
  await writeFile(new URL('data/travel-loves.json',root),JSON.stringify(data)+'\n');
  return {stops:data.locations.length,states:new Set(data.locations.map(s=>s.state)).size,
    withShowers:data.locations.filter(s=>s.showers===true).length};
}

if(typeof process!=='undefined' && process.argv[1]===fileURLToPath(import.meta.url)){
  console.log(await refreshLoves({fromCache:process.argv.includes('--cached')}));
}
