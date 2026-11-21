// Build from US directory records captured from Pilot's public location API.
// Input is a JSON object with locations[], expected (U.S. count from the export),
// and missing[] (directory IDs not present in the regional responses).
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const origin='https://pilotcompany.com';
const source=origin+'/api/locations/export';

export function normalizePilot(site,checked) {
  if(site.country!=='United States'||site.status!=='Open')return null;
  const lines=site.linesOfBusiness.filter(line=>line.status==='Open'&&line.isPublicFacing===true);
  const line=lines.find(b=>b.isPrimaryLineOfBusiness)||lines[0];
  if(!line)return null;
  const number=String(site.locationId);
  const lat=line.latitude,lng=line.longitude;
  if(!/^\d+$/.test(number)||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('Invalid Pilot site '+number);
  const brand=line.primaryBusinessDescription||line.lobPublicDescription;
  if(!brand)throw Error('Unnamed Pilot site '+number);
  const state=line.state||site.state,locality=line.city||site.city;
  const street=[line.address1||site.address1,line.address2||site.address2].filter(Boolean).join(' ');
  const address=[street,locality,[state,line.postalCode||site.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const cardlock=/cardlock/i.test(brand),dealer=line.isDealer===true||/dealer/i.test(brand);
  const licensee=line.isLicensee===true||/licen[sc]/i.test(brand);
  const category=cardlock?'Fleet cardlock fuel station':dealer?'Fuel network dealer':licensee?'Licensed fuel stop':/travel center/i.test(brand)?'Travel center':'Fuel station';
  // The operator defines offering 322 as Showers. Missing an offering is
  // inconclusive. An explicit zero is different from an omitted Quantity.
  const offering=line.offerings?.find(item=>String(item.offeringCode)==='322');
  const quantity=offering?.offeringAttributes?.find(a=>a.description==='Quantity')?.value;
  const showerCount=/^\d{1,3}$/.test(String(quantity))?Number(quantity):null;
  const showers=offering ? showerCount===null||showerCount>0 : null;
  let showerNote='Shower availability has not been verified for this location.';
  if(showers)showerNote=(showerCount===null?'Pilot lists showers for this location.':'Pilot lists '+showerCount+(showerCount===1?' shower.':' showers.'))+' Contact the stop for current availability and fees.';
  if(showers===false)showerNote='The operator lists zero showers at this location.';
  const accessNote=cardlock?'Fleet cardlock fueling may require an authorized account or fuel card. Check entry and facility access before traveling.':dealer||licensee?'An independently operated fuel location participates in the Pilot network. Check with this operator about entry, purchases and restroom use.':'Check with the travel stop about restroom access, purchases and fees.';
  return {
    id:'us-pilot-'+number,cityId:'us',name:brand+' #'+number,category,state,locality,lat,lng,address,addressKnown:Boolean(street),
    neighborhood:[locality,state].filter(Boolean).join(', '),coordinateAccuracy:'facility',roadside:true,priority:cardlock?95:showers?35:55,
    showers,showerCount,accessibleShowerCount:null,showerNote,access:'unknown',bathroomConfirmed:false,accessible:null,changingTable:null,
    purchaseLikely:false,dynamicListing:true,evidenceType:'operator-directory',accessNote,phone:line.phone||null,
    note:'This stop appears in the Pilot location directory. Restroom hours and entry rules are unverified.',
    searchTerms:[brand,'Pilot network',cardlock?'fleet fuel':'truck stop gas fuel',site.interstate].filter(Boolean).join(' '),
    sources:[{label:'Pilot operator location and amenities',url:origin+'/locations/'+number},{label:'Pilot location directory',url:origin+'/locations'}],
    checkedLabel:'Pilot directory · '+checked
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node scripts/import-pilot.mjs path/to/pilot-sites.json [YYYY-MM-DD]');
  const input=JSON.parse(await readFile(process.argv[2],'utf8'));
  if(input.source!==origin+'/api/locations/'||input.locations.length!==input.expected||input.missing?.length!==0)throw Error('Incomplete Pilot U.S. directory');
  const checked=process.argv[3]||new Date().toISOString().slice(0,10);
  const locations=input.locations.map(site=>normalizePilot(site,checked)).filter(Boolean).sort((a,b)=>Number(a.id.slice(9))-Number(b.id.slice(9)));
  if(new Set(locations.map(p=>p.id)).size!==locations.length)throw Error('Duplicate Pilot location number');
  const excludedClosed=input.locations.filter(p=>p.status!=='Open').length;
  await writeFile(new URL('../data/travel-pilot.json',import.meta.url),JSON.stringify({source,checked,excludedClosed,locations})+'\n');
  console.log(JSON.stringify({locations:locations.length,states:new Set(locations.map(p=>p.state)).size,showers:locations.filter(p=>p.showers).length,counts:locations.filter(p=>p.showerCount>0).length,totals:locations.reduce((a,p)=>a+(p.showerCount||0),0),excludedClosed}));
}
