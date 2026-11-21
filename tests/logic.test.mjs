import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleStatus, filterPlaces, distanceMiles, directionsURL} from '../logic.js';

const park={id:'park',name:'Bayview Park',address:'Truman Avenue',neighborhood:'Midtown',access:'public',accessible:null,lat:24.5569,lng:-81.7888,hours:{scope:'restroom',schedule:Array.from({length:7},()=>[[420,1260]])}};

test('restroom status uses Key West time across daylight saving and UTC date changes',()=>{
  assert.equal(scheduleStatus(park,new Date('2026-07-14T11:00:00Z')).state,'open');
  assert.equal(scheduleStatus(park,new Date('2026-07-15T00:59:00Z')).state,'open');
  assert.equal(scheduleStatus(park,new Date('2026-07-15T01:00:00Z')).state,'closed');
  assert.equal(scheduleStatus(park,new Date('2026-11-21T11:59:00Z')).state,'closed');
  assert.equal(scheduleStatus(park,new Date('2026-11-21T12:00:00Z')).state,'open');
});

test('venue hours and missing hours never imply open restrooms',()=>{
  assert.equal(scheduleStatus({...park,hours:{...park.hours,scope:'venue'}},new Date('2026-07-14T12:00:00Z')).state,'unknown');
  assert.equal(scheduleStatus({...park,hours:null}).state,'unknown');
});

test('overnight schedule includes the prior local day',()=>{
  const p={...park,hours:{scope:'restroom',schedule:[[],[],[],[],[],[[1200,120]],[]]}};
  assert.equal(scheduleStatus(p,new Date('2026-11-21T06:30:00Z')).state,'open');
  assert.equal(scheduleStatus(p,new Date('2026-11-21T07:00:00Z')).state,'closed');
});

test('filters combine and unknown access features are excluded',()=>{
  const paid={...park,id:'paid',name:'Fort Zachary Taylor',access:'paid',accessible:true};
  assert.equal(filterPlaces([park,paid],{filters:new Set(['free','accessible'])}).length,0);
  assert.deepEqual(filterPlaces([park,paid],{query:'bayview truman'}).map(p=>p.id),['park']);
  assert.equal(filterPlaces([park,paid],{savedOnly:true,saved:new Set(['paid'])})[0].id,'paid');
});

test('distance and directions are coordinates-based without invented route times',()=>{
  assert.equal(distanceMiles(park,park),0);
  assert.ok(Math.abs(distanceMiles({lat:0,lng:0},{lat:1,lng:0})-69.093)<.01);
  const url=new URL(directionsURL(park));
  assert.equal(url.searchParams.get('api'),'1');
  assert.equal(url.searchParams.get('travelmode'),'walking');
  assert.equal(url.searchParams.get('destination'),'24.5569,-81.7888');
});
