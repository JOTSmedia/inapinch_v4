import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {scheduleStatus,filterPlaces,distanceMiles} from '../logic.js';
const read=async name=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
const cities=await read('cities.json');
const all=await read('locations.json');

test('city directories and ratings allowlist agree without cross-city ID collisions',async()=>{
  assert.equal(cities.length,24);
  for(const id of ['nyc','miami','la','austin','sf','key-west'])assert.ok(cities.some(c=>c.id===id));
  const ids=[];
  for(const city of cities){
    const data=await read(`data/${city.id}.json`);
    assert.equal(data.locations.length,city.count);
    assert.equal(data.locations.filter(p=>p.bathroomConfirmed===true).length,city.confirmedCount);
    for(const p of data.locations){
      assert.equal(p.cityId,city.id);assert.equal(p.timezone,city.timezone);
      assert.ok(Number.isFinite(p.lat)&&Number.isFinite(p.lng));
      assert.ok(distanceMiles(city,p)<50,`${city.id}: ${p.name} lies within the intended metropolitan area`);
      assert.ok(p.sources.length&&p.sources.every(s=>['https:','http:'].includes(new URL(s.url).protocol)));
      ids.push(p.id);
    }
    await access(new URL('../'+city.art,import.meta.url));
  }
  assert.equal(ids.length,new Set(ids).size);
  assert.deepEqual(new Set(ids),new Set(all.locations.map(p=>p.id)));
});

test('unknown restroom access never leaks into confirmed, public, or accessible filters',async()=>{
  for(const city of cities.filter(c=>c.id!=='key-west')){
    const {locations}=await read(`data/${city.id}.json`);
    const leads=locations.filter(p=>!p.bathroomConfirmed);
    for(const filter of ['confirmed','free','accessible','open'])assert.equal(filterPlaces(leads,{filters:new Set([filter])}).length,0,`${city.id} ${filter}`);
  }
});

test('one UTC instant gives correct opening status in each supported time zone',()=>{
  const make=timezone=>({timezone,hours:{scope:'restroom',schedule:Array.from({length:7},()=>[[540,1020]])}});
  const now=new Date('2026-07-14T16:00:00Z');
  for(const timezone of ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix'])assert.equal(scheduleStatus(make(timezone),now).state,'open',timezone);
  assert.equal(scheduleStatus(make('Pacific/Honolulu'),now).state,'closed');
  assert.equal(scheduleStatus(make('America/Los_Angeles'),new Date('2026-11-21T16:30:00Z')).state,'closed');
  assert.equal(scheduleStatus(make('America/New_York'),new Date('2026-11-21T16:30:00Z')).state,'open');
});

test('Phoenix does not inherit Denver daylight-saving time',()=>{
  const p=timezone=>({timezone,hours:{scope:'restroom',schedule:Array.from({length:7},()=>[[540,1020]])}});
  const now=new Date('2026-07-14T15:30:00Z');
  assert.equal(scheduleStatus(p('America/Denver'),now).state,'open');
  assert.equal(scheduleStatus(p('America/Phoenix'),now).state,'closed');
});

test('24-hour and overnight schedules work across local midnight',()=>{
  const open={timezone:'America/Los_Angeles',hours:{scope:'restroom',schedule:Array.from({length:7},()=>[[0,1440]])}};
  assert.equal(scheduleStatus(open,new Date('2026-11-21T08:00:00Z')).state,'open');
  const overnight={timezone:'Pacific/Honolulu',hours:{scope:'restroom',schedule:[[],[],[],[],[],[[1200,120]],[]]}};
  assert.equal(scheduleStatus(overnight,new Date('2026-11-21T11:00:00Z')).state,'open');
  assert.equal(scheduleStatus(overnight,new Date('2026-11-21T12:00:00Z')).state,'closed');
});

test('saved city stops remain independently selectable',()=>{
  const ny=all.locations.find(p=>p.cityId==='nyc'),la=all.locations.find(p=>p.cityId==='la');
  const saved=new Set([ny.id,la.id]);
  assert.deepEqual(filterPlaces([ny],{savedOnly:true,saved}).map(p=>p.id),[ny.id]);
  assert.deepEqual(filterPlaces([la],{savedOnly:true,saved}).map(p=>p.id),[la.id]);
  assert.equal(saved.size,2);
});
