import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildMapStyle,cartographicPalette} from '../cartography.js';
import {placeFromFeature,mergeVenuePlaces,venueKind} from '../venue-data.js';
import {pointToCoordinates,decodeTile} from '../scripts/vector-poi.mjs';
import {businessListingURL} from '../logic.js';
const cities=JSON.parse(await readFile(new URL('../cities.json',import.meta.url),'utf8'));
const city=cities.find(c=>c.id==='nyc');
const feature=(id=1,name='Example Bar',lng=-73.99)=>({id,properties:{name,class:'bar'},geometry:{type:'Point',coordinates:[lng,40.74]}});

test('every city gets a distinct original palette and real geographic vector layers',()=>{
 const names=new Set();
 for(const c of cities){
  names.add(cartographicPalette(c).name);
  for(const mode of ['wireframe','city']){
   const style=buildMapStyle(c,mode);assert.equal(style.version,8);assert.equal(style.metadata.cityId,c.id);
   assert.equal(style.sources.openmaptiles.url,'https://tiles.openfreemap.org/planet');
   assert.ok(style.layers.some(l=>l['source-layer']==='transportation'));
   assert.ok(style.layers.some(l=>l['source-layer']==='water'));
   assert.ok(style.layers.some(l=>l['source-layer']==='park'));
   assert.ok(style.layers.some(l=>l['source-layer']==='building'));
   assert.equal(style.layers.length,new Set(style.layers.map(l=>l.id)).size);
   assert.ok(!JSON.stringify(style).includes('api_key'));
  }
 }
 assert.equal(names.size,24);
});
test('discovered food venues stay unverified and cannot acquire invented addresses or access',()=>{
 const p=placeFromFeature(feature(),city);assert.ok(p);assert.equal(p.bathroomConfirmed,false);
 assert.equal(p.access,'unknown');assert.equal(p.addressKnown,false);assert.equal(p.accessible,null);
 assert.equal(p.dynamicListing,true);assert.equal(p.id,'us-poi-1');
 const query=new URL(businessListingURL(p,city)).searchParams.get('query');
 assert.match(query,/Example Bar/);assert.match(query,/-73\.99000/);assert.doesNotMatch(query,/Street address/);
});
test('a mapped toilet is bathroom evidence without inferring free, accessible, or open access',()=>{
 const f=feature();f.properties={class:'toilets'};
 const p=placeFromFeature(f,city);assert.equal(p.bathroomConfirmed,true);assert.equal(p.access,'unknown');
 assert.equal(p.accessible,null);assert.equal(p.hours,undefined);
});
test('discovery excludes irrelevant points, invalid coordinates and foreign locations',()=>{
 const f=feature();f.properties.class='hospital';assert.equal(placeFromFeature(f,city),null);
 assert.equal(placeFromFeature(feature(2,'Foreign bar',-9),city),null);
 const bad=feature();bad.geometry.coordinates=[NaN,40];assert.equal(placeFromFeature(bad,city),null);
 assert.equal(venueKind({subclass:'pub',class:'beer'}),'pub');
});
test('venue discovery deduplicates feature IDs and preserves authoritative records and chain branches',()=>{
 const first=placeFromFeature(feature(),city);const duplicate=placeFromFeature(feature(2),city);
 assert.equal(mergeVenuePlaces([first],[first,duplicate]).length,0);
 const official={...first,id:'official',bathroomConfirmed:true,access:'public'};
 assert.equal(mergeVenuePlaces([official],[duplicate]).length,0);assert.equal(official.access,'public');
 assert.equal(mergeVenuePlaces([first],[placeFromFeature(feature(3,'Example Bar',-73.98),city)]).length,1);
});
test('all city snapshots expanded beyond their starter lists and retain source provenance',async()=>{
 let count=0;
 for(const c of cities){
  const {locations}=JSON.parse(await readFile(new URL(`../data/${c.id}.json`,import.meta.url),'utf8'));
  assert.ok(locations.length>=200,c.id);count+=locations.length;
  for(const p of locations.filter(p=>p.evidenceType==='vector-poi')){
   assert.ok(p.sourceTile&&p.sourceFeatureId);assert.equal(p.sourceSnapshot,'2026-11-15');
   assert.equal(p.access,'unknown');assert.equal(p.addressKnown,false);
  }
 }
 assert.equal(count,27431);
});
test('vector coordinate decoding is geographically anchored, and malformed protobuf is rejected',()=>{
 assert.deepEqual(pointToCoordinates(2048,2048,0,0,0),{lat:0,lng:0});
 assert.equal(pointToCoordinates(0,0,0,0,0).lng,-180);
 assert.ok(Math.abs(pointToCoordinates(0,0,0,0,0).lat-85.05112878)<1e-7);
 assert.throws(()=>decodeTile(new Uint8Array([15])),/wire type/);
});
