import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {distanceMiles} from '../logic.js';
import {usRegionAt} from '../us-geography.js';
const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/start\(\);\s*$/,'');
function setup(){
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'recommended',disabled:false,setAttribute(){},removeAttribute(){}});return nodes.get(id);};
  const kw={id:'key-west',name:'Key West',lat:24.558,lng:-81.782};
  const nyc={id:'nyc',name:'New York City',lat:40.742,lng:-73.985};
  const state={selects:[],toasts:[],draws:[],renders:0,callback:null,error:null};
  const context=vm.createContext({document:{getElementById:get},localStorage:{getItem(){return null;}},distanceMiles,usRegionAt,nearestCity:()=>nyc,navigator:{geolocation:{getCurrentPosition(success,failure){state.callback=success;state.error=failure;}}},kw,nyc,state,console,URL,Set,Map});
  vm.runInContext(source+`\ncity=kw;cityRevision=1;cityGuide={async select(id){state.selects.push(id);city=id==='us'?{id:'us',name:'United States'}:nyc;cityRevision++;}};render=()=>state.renders++;drawPosition=options=>state.draws.push(options);toast=message=>state.toasts.push(message);getResults=()=>[];globalThis.flow={locate,manualCity(){city=nyc;cityRevision++;},get city(){return city;},get position(){return position;}};`,context);
  return {flow:context.flow,state,get};
}
test('current-location flow chooses the nearest supported city and focuses nearby stops',async()=>{
  const {flow,state,get}=setup();flow.locate({auto:true});
  assert.equal(get('locate-btn').disabled,true);
  await state.callback({coords:{latitude:40.74,longitude:-73.99,accuracy:12}});
  assert.deepEqual(state.selects,['nyc']);assert.equal(flow.city.id,'nyc');
  assert.equal(get('sort-select').value,'distance');assert.match(get('location-status').textContent,/Near you/);
  assert.equal(state.draws[0].focus,true);assert.equal(get('locate-btn').disabled,false);
});
test('a delayed automatic location result preserves a manually chosen city',async()=>{
  const {flow,state,get}=setup();flow.locate({auto:true});flow.manualCity();
  await state.callback({coords:{latitude:24.55,longitude:-81.78,accuracy:12}});
  assert.deepEqual(state.selects,[]);assert.equal(flow.city.id,'nyc');assert.equal(get('locate-btn').disabled,false);
});
test('outside coverage does not present a distant city as local',async()=>{
  const {flow,state,get}=setup();flow.locate({auto:true});
  await state.callback({coords:{latitude:51.5,longitude:-0.12,accuracy:12}});
  assert.deepEqual(state.selects,[]);assert.match(get('location-status').textContent,/outside the U.S. map/);
});
test('denied location keeps city selection available without a repeated prompt',()=>{
  const {flow,state,get}=setup();flow.locate({auto:true});state.error({code:1});
  assert.equal(get('locate-btn').disabled,false);assert.match(get('location-status').textContent,/Choose a city/);
  assert.deepEqual(state.toasts,[]);
});

test('GPS centers on a rural U.S. location outside all of the themed guides',async()=>{
  const {flow,state,get}=setup();
  flow.locate({auto:true});
  await state.callback({coords:{latitude:43.4809,longitude:-110.7624,accuracy:18}});
  assert.deepEqual(state.selects,['us']);
  assert.equal(state.draws[0].focus,true);
  assert.match(get('location-status').textContent,/Wyoming/);
});
