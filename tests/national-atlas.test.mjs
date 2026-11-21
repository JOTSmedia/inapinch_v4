import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createVenueAtlas} from '../national-venues.js';
import {usRegionAt} from '../us-geography.js';
const root=new URL('../data/',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('atlas-catalog.json',root),'utf8'));
async function chunk(key){
  const code=await readFile(new URL('atlas/'+key+'.js',root),'utf8');
  const match=/^globalThis\.inAPinchAtlasData\("([0-9-]+)","([A-Za-z0-9+/=]+)"\);\n$/.exec(code);
  assert.ok(match);assert.equal(match[1],key);
  return JSON.parse(gunzipSync(Buffer.from(match[2],'base64')));
}
test('the national atlas ships a geographically indexed directory in all 56 U.S. jurisdictions',async()=>{
  const expected='AK AL AR AS AZ CA CO CT DC DE FL GA GU HI IA ID IL IN KS KY LA MA MD ME MI MN MO MP MS MT NC ND NE NH NJ NM NV NY OH OK OR PA PR RI SC SD TN TX UT VA VI VT WA WI WV WY'.split(' ');
  assert.deepEqual(Object.keys(catalog.regions).sort(), expected.sort());
  // Incomplete state archives can otherwise seem covered by a few neighboring border POIs.
  for(const state of ['MD','WI'])assert.ok(catalog.regions[state]>=10_000,'Missing statewide source rows in '+state);
  for(const state of expected)assert.ok(catalog.regions[state]>0,'Expected records in '+state);
  assert.equal(Object.values(catalog.regions).reduce((x,y)=>x+y,0),catalog.count);
  assert.equal(catalog.cells.reduce((n,c)=>n+c[3],0),catalog.count);
  assert.equal(catalog.cells.reduce((n,c)=>n+c[4],0),catalog.restrooms);
  assert.ok(catalog.roadside>0);
  assert.equal(catalog.cells.reduce((n,c)=>n+c[9],0),catalog.roadside);
  const roadsideKinds=new Set(['fuel','services','rest_area','truck_stop']);
  let actualRoadside=0;
  const files=await readdir(new URL('atlas/',root));
  assert.equal(files.length,catalog.chunks.length);
  const ids=new Set();
  let total=0;
  for(const [key,size] of catalog.chunks){
    const rows=await chunk(key);assert.equal(rows.length,size);
    for(const [id,kind,lat,lng,name,additional=[]] of rows){
      if (roadsideKinds.has(catalog.kinds[kind]) || additional.some(i=>roadsideKinds.has(catalog.kinds[i]))) actualRoadside++;
      assert.ok(!ids.has(id));ids.add(id);assert.ok(catalog.kinds[kind]);
      assert.ok(Number.isInteger(lat)&&Number.isInteger(lng)&&typeof name==='string');
    }
    total+=rows.length;
  }
  assert.equal(total,catalog.count);
  assert.equal(actualRoadside,catalog.roadside);
});
test('real local packages return nearby stops outside city guides without any remote service',async()=>{
  const atlas=createVenueAtlas(catalog,chunk);
  const idPrefixes=new Set();
  for(const [name,lat,lng,minimum=6,state] of [
    ['Burlington VT',44.4759,-73.2121],['Flagstaff AZ',35.198,-111.651],
    ['Juneau AK',58.300,-134.409],['Hilo HI',19.724,-155.087],['Fargo ND',46.8788,-96.7898],
    ['New Brunswick NJ',40.49,-74.45,150,'NJ'],['Madison WI',43.074,-89.384,300,'WI'],
    ['Green Bay WI',44.513,-88.014,150,'WI'],['Baltimore MD',39.29,-76.61,500,'MD'],
    ['Frederick MD',39.414,-77.41,150,'MD'],['St. Thomas VI',18.342,-64.93,100,'VI'],
    ['St. John VI',18.332,-64.79,60,'VI'],['St. Croix VI',17.746,-64.704,35,'VI'],
    ['Hagåtña GU',13.476,144.751,200,'GU'],['Pago Pago AS',-14.278,-170.703,25,'AS'],
    ['Saipan MP',15.181,145.737,80,'MP'],['Tinian MP',14.968,145.629,10,'MP'],
    ['Rota MP',14.14,145.15,8,'MP']
  ]){
    const bounds={west:lng-.065,east:lng+.065,south:lat-.05,north:lat+.05};
    const {records,partial}=await atlas.query(bounds);
    assert.equal(partial,false,name);assert.ok(records.length>=minimum,name+' returned '+records.length+' places');
    for(const p of records){
      assert.ok(p.lat>=bounds.south && p.lat<=bounds.north && p.lng>=bounds.west && p.lng<=bounds.east);
      const prefix=/^us-(osm|poi)-/.exec(p.id)?.[1];
      assert.ok(prefix,'Unrecognized source identity: '+p.id);
      idPrefixes.add(prefix);
      if(state){assert.equal(p.state,state,name);assert.equal(prefix,['VI','GU','AS','MP'].includes(state)?'poi':'osm',name);}
      assert.ok(usRegionAt(p.lat,p.lng));
      if(p.bathroomConfirmed)assert.equal(p.category,'Mapped restroom');
    }
  }
  assert.deepEqual([...idPrefixes].sort(),['osm','poi']);
});
test('overview and close-up use separate coordinate and count semantics',()=>{
  const atlas=createVenueAtlas(catalog,chunk);
  const world={west:-180,east:180,south:-90,north:90};
  assert.equal(atlas.overview(world,false).reduce((sum,p)=>sum+p.count,0),catalog.count);
  assert.equal(atlas.overview(world,'roadside').reduce((sum,p)=>sum+p.count,0),catalog.roadside);
  assert.equal(atlas.overview(world,true).reduce((sum,p)=>sum+p.count,0),catalog.restrooms);
});
