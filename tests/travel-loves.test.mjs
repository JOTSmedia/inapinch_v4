import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {directionsURL,filterPlaces} from '../logic.js';
import {normalizeLove,storeLinks} from '../scripts/import-loves.mjs';

const snapshot=JSON.parse(await readFile(new URL('../data/travel-loves.json',import.meta.url),'utf8'));
const locations=snapshot.locations;

test("Love's publishes individual, linked fuel and travel facilities with operator-reported shower flags",()=>{
  assert.equal(snapshot.source,'https://www.loves.com/api/fetch_stores');
  assert.equal(new Set(locations.map(p=>p.id)).size,locations.length);
  assert.ok(locations.length>=650);
  if(snapshot.checked==='2026-11-21'){
    assert.equal(locations.length,681);
    assert.equal(new Set(locations.map(p=>p.state)).size,42);
    assert.equal(filterPlaces(locations,{filters:new Set(['showers'])}).length,599);
    assert.equal(locations.filter(p=>p.showers===null).length,82);
  }
  for(const p of locations){
    assert.match(p.id,/^us-loves-[0-9]+$/);
    assert.match(p.sources[0].url,/^https:\/\/www\.loves\.com\/locations\/[a-z]{2}\/.+\/loves-(travel-stop|country-store)-/);
    assert.ok(p.sources[0].url.endsWith('-'+p.id.split('-').pop()));
    assert.ok(p.addressKnown && p.roadside && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    assert.equal(p.bathroomConfirmed,false);assert.equal(p.access,'unknown');
    assert.equal(new URL(directionsURL(p)).searchParams.get('travelmode'),'driving');
  }
  const clanton=locations.find(p=>p.id==='us-loves-368');
  if(snapshot.checked==='2026-11-21'){assert.equal(clanton.showers,true);assert.equal(clanton.showerCount,5);}
});
test('source conversion distinguishes an omitted amenity, an explicitly unavailable shower, and a positive shower flag without a numeric count',()=>{
  const url='https://www.loves.com/locations/al/clanton/loves-travel-stop-clanton-368';
  const base={number:368,facilitySubtypeName:'Travel Stop',latitude:32.844151,longitude:-86.591963,
    address1:'300 Arby Dr',city:'Clanton',state:'AL',zip:'35046'};
  function convert(value,detail){
    return normalizeLove({...base,mappedCustomFields:{amenities:value===null?[]:[{smaFieldName:'privateshowers',fieldValue:value}]}},url,'2026-11-21',detail);
  }
  assert.equal(convert(null).showers,null);
  assert.equal(convert('false').showers,false);
  assert.equal(convert('true').showers,true);
  assert.equal(convert('true').showerCount,null);
  assert.equal(convert(null,{number:333,customFields:[{fieldName:'showercount',fieldValue:'15'}]}).showers,null);
  assert.equal(convert(null,{number:368,customFields:[{fieldName:'showercount',fieldValue:'0'}]}).showers,false);
  const links=storeLinks('<a href="/locations/al/clanton/loves-travel-stop-clanton-368"></a><a href="/locations/al/cottondale/loves-speedco-cottondale-911"></a>');
  assert.deepEqual([...links],[[368,url]]);
});
