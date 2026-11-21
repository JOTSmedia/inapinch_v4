import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fromInventory} from '../scripts/import-rest-areas.mjs';

const snapshot=JSON.parse(await readFile(new URL('../data/travel-rest-areas.json',import.meta.url),'utf8'));
const locations=snapshot.locations;

test('federal highway inventory ships source-addressable records for all 48 contiguous states',()=>{
  assert.equal(snapshot.compiled,'2019-04-09');
  assert.equal(locations.length,1915);
  assert.equal(new Set(locations.map(p=>p.state)).size,48);
  assert.equal(new Set(locations.map(p=>p.id)).size,locations.length);
  for(const p of locations){
    assert.match(p.id,/^us-ntad-\d+$/);
    assert.equal(p.sources[0].url,snapshot.source+'/'+p.id.slice('us-ntad-'.length));
    assert.ok(p.lat>=24&&p.lat<=50&&p.lng>=-125&&p.lng<=-66);
    assert.equal(p.roadside,true);
    assert.equal(p.access,'unknown');
    assert.equal(p.bathroomConfirmed,false);
    assert.equal(p.showers,null);
    assert.match(p.checkedLabel,/2019/);
  }
  const first=locations.find(p=>p.id==='us-ntad-1');
  assert.equal(first.name,'Grand Bay Welcome Center');
  assert.equal(first.address,'I-10 EB, mile 0.485, Grand Bay, AL');
});

test('survey labels preserve restrictions, directions and unknown amenity status',()=>{
  const prepare=(name,route='I-90 WB',mile='By Exit 56')=>fromInventory({attributes:{OBJECTID:15,nhs_rest_stop:name,latitude:44,longitude:-95,state:'MN',municipality:'N/A',county:'Test County',highway_route:route,mile_post:mile}});
  const generic=prepare('NHS Rest Stop or Truck Facility 15');
  assert.equal(generic.category,'Highway rest or truck facility');
  assert.match(generic.address,/I-90 WB, By Exit 56/);
  assert.doesNotMatch(generic.address,/N\/A/);
  assert.equal(prepare('Weigh Scale Complex, No Facilities').category,'Weigh or inspection station');
  assert.match(prepare('Weigh Scale Complex, No Facilities').accessNote,/no facilities or services/i);
  assert.match(prepare('Truck-Only Safety Rest Area North').accessNote,/truck-only/i);
  assert.equal(prepare('UNKNOWN').name,'I-90 WB truck parking facility');
});
