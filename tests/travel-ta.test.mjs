import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {filterPlaces,directionsURL} from '../logic.js';

const snapshot=JSON.parse(await readFile(new URL('../data/travel-ta.json',import.meta.url),'utf8'));
const stops=snapshot.locations;

test('operator travel-stop directory preserves identifiers, mapped locations and provenance',()=>{
  assert.match(snapshot.source,/^https:\/\/www\.ta-petro\.com\//);
  assert.equal(new Set(stops.map(p=>p.id)).size,stops.length);
  assert.ok(stops.length>=350);
  assert.ok(new Set(stops.map(p=>p.state)).size>=44);
  for(const p of stops){
    assert.match(p.id,/^us-ta-\d+$/);
    assert.equal(p.roadside,true);
    assert.ok(p.name && p.address && p.lat>=18 && p.lat<=72 && p.lng< -60 && p.lng>= -180);
    assert.ok(p.sources.some(s=>s.url===snapshot.source));
    assert.equal(new URL(directionsURL(p)).searchParams.get('travelmode'),'driving');
  }
});
test('showers filter distinguishes positive counts, reported zeroes and omissions',()=>{
  const withShowers=filterPlaces(stops,{filters:new Set(['showers'])});
  const datedSnapshot=snapshot.checked==='2026-11-21';
  if(datedSnapshot){
    assert.equal(stops.length,360);
    assert.equal(withShowers.length,351);
    assert.equal(stops.filter(p=>p.showers===false).length,2);
    assert.equal(stops.filter(p=>p.showers===null).length,7);
    assert.equal(withShowers.reduce((sum,p)=>sum+p.showerCount,0),3088);
  }
  for(const p of stops){
    assert.equal(p.showers,p.showerCount===null ? null : p.showerCount>0);
    assert.ok(p.showerNote);
    assert.ok(p.accessibleShowerCount===null || Number.isInteger(p.accessibleShowerCount));
  }
  assert.equal(stops.find(p=>p.id==='us-ta-0001').showerCount,11);
  for(const flag of ['confirmed','free','accessible','open']){
    assert.deepEqual(filterPlaces(stops,{filters:new Set([flag])}),[]);
  }
});
