import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePilot} from '../scripts/import-pilot.mjs';

const snapshot=JSON.parse(await readFile(new URL('../data/travel-pilot.json',import.meta.url),'utf8'));
const checked=snapshot.checked;
const base={locationId:'123',country:'United States',status:'Open',state:'TN',city:'Knoxville'};
const line={status:'Open',isPublicFacing:true,isPrimaryLineOfBusiness:true,primaryBusinessDescription:'Pilot Travel Center',latitude:35.96,longitude:-83.92,offerings:[]};
const convert=(offering,overrides={})=>normalizePilot({...base,linesOfBusiness:[{...line,offerings:[offering],...overrides}]},checked);

test('Pilot directory totals, public/affiliate categories and coordinates persist through import',()=>{
  const rows=snapshot.locations;
  assert.equal(rows.length,878);
  assert.equal(snapshot.excludedClosed,5);
  assert.equal(new Set(rows.map(p=>p.id)).size,rows.length);
  assert.equal(new Set(rows.map(p=>p.state)).size,43);
  assert.equal(rows.filter(p=>p.showers===true).length,641);
  assert.equal(rows.filter(p=>p.showerCount>0).length,639);
  assert.equal(rows.filter(p=>p.category==='Fleet cardlock fuel station').length,57);
  assert.equal(rows.filter(p=>p.category==='Fuel network dealer').length,144);
  for(const p of rows){
    assert.match(p.id,/^us-pilot-\d+$/);
    assert.equal(p.sources[0].url,'https://pilotcompany.com/locations/'+p.id.slice(9));
    assert.ok(p.lat>=24&&p.lat<50&&p.lng>=-125&&p.lng< -66);
    assert.equal(p.roadside,true);
    assert.equal(p.access,'unknown');
    assert.equal(p.bathroomConfirmed,false);
  }
  assert.equal(rows.find(p=>p.id==='us-pilot-1103').showerCount,5);
  assert.equal(rows.find(p=>p.id==='us-pilot-1173').showers,null);
  assert.match(rows.find(p=>p.id==='us-pilot-31006').accessNote,/Fleet cardlock/);
});

test('Pilot shower filter requires offering 322 on an open, public-facing business',()=>{
  const amenity=(code,value)=>({offeringCode:code,offeringAttributes:value===null?[]:[{description:'Quantity',value}]});
  assert.equal(convert(amenity('322','5')).showerCount,5);
  assert.equal(convert(amenity('322','0')).showers,false);
  assert.equal(convert(amenity('322',null)).showers,true);
  assert.equal(convert(amenity('322',null)).showerCount,null);
  assert.equal(convert(amenity('323','5')).showers,null);
  assert.equal(convert(amenity('322','1'),{isPublicFacing:false}),null);
  assert.equal(convert(amenity('322','1'),{status:'Temporary Closed'}),null);
  assert.equal(normalizePilot({...base,country:'Canada',linesOfBusiness:[line]},checked),null);
  assert.equal(normalizePilot({...base,status:'Temporary Closed',linesOfBusiness:[line]},checked),null);
});
