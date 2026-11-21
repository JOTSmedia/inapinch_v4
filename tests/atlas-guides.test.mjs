import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {escapeHTML, normalize} from '../logic.js';
import {usRegions} from '../us-geography.js';
import {cartographicPalette, buildMapStyle} from '../cartography.js';

const root = new URL('../', import.meta.url);
const source = (await readFile(new URL('city-guide.js',root),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('export ','');
const guides = JSON.parse(await readFile(new URL('cities.json',root),'utf8'));

function fixture(query='', base='https://example.test/v4/') {
  const href = base + query;
  const location = {href};
  const nodes = new Map();
  const events = [];
  function element(key) {
    if (!nodes.has(key)) nodes.set(key,{
      innerHTML:'', textContent:'', value:'', dataset:{},
      classList:{toggle(){}},style:{setProperty(){}},close(){},addEventListener(){},
      removeAttribute(){},setAttribute(){}
    });
    return nodes.get(key);
  }
  const document = {
    getElementById:element, querySelector:element, querySelectorAll:()=>[],
    documentElement:element('html'), body:element('body'), addEventListener(){}, dispatchEvent(){}
  };
  function navigate(a,b,url) {
    const current=new URL(location.href);
    if(current.protocol==='file:' && current.search!==url.search) throw Object.assign(Error('Cannot change local query'),{name:'SecurityError'});
    location.href=url.href;
  }
  const context = vm.createContext({
    URL,Intl,Date,location,document,usRegions,e:escapeHTML,normalize,
    history:{replaceState:navigate,pushState:navigate},
    window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},
    CustomEvent:class {},fetch:async()=>({ok:true,json:async()=>guides}),events
  });
  const ready = vm.runInContext(source+'\ninitCityGuide(guide => events.push(guide.id))',context);
  return {ready,events,element,location,context};
}

test('a fresh atlas opens nationwide and the city and state pickers keep their own choices', async()=>{
  const {ready,events,element} = fixture();
  const guide = await ready;
  assert.deepEqual(events,['us']);
  assert.equal(guide.cities.length,24);
  assert.equal(guide.cities.some(city=>city.id==='us'),false);
  const options = element('state-jump').innerHTML;
  for (const {code} of usRegions) assert.ok(options.includes(`value="${code}"`),code);
  assert.ok(['CA','HI','AK','DC','PR','AS','VI','MP','GU'].every(code=>options.includes(`value="${code}"`)));
});

test('a guide can be selected again after panning and stale share coordinates clear', async()=>{
  const {ready,events,location} = fixture('?city=nyc&spot=nyc-1&near=40,-74');
  const guide = await ready;
  assert.equal(new URL(location.href).searchParams.get('spot'),'nyc-1');
  await guide.select('nyc');
  assert.deepEqual(events,['nyc','nyc']);
  assert.equal(new URL(location.href).searchParams.has('near'),false);
  await guide.select('us');
  assert.equal(new URL(location.href).searchParams.get('city'),'us');
});

test('the US style labels states and towns and draws borders on both maps',()=>{
  const nation={id:'us',name:'United States',accent:'#177166'};
  assert.notEqual(cartographicPalette(nation).name,cartographicPalette({id:'nyc'}).name);
  for(const mode of ['city','wireframe']){
    const layers=buildMapStyle(nation,mode).layers;
    assert.ok(layers.find(layer=>layer.id==='state-names').minzoom<=3);
    assert.ok(layers.find(layer=>layer.id==='regional-place-names').minzoom<=5);
    for(const name of ['state-boundaries','country-boundaries'])assert.equal(layers.find(layer=>layer.id===name)['source-layer'],'boundary');
  }
});

test('portable city and spot history uses file-safe fragments and restores them on reload', async()=>{
  const base='file:///Users/person/IN_A_PINCH/OPEN_ME.html';
  const {ready,events,location,context}=fixture('#pinch?city=nyc&spot=nyc-01&near=40,-74',base);
  const guide=await ready;
  assert.deepEqual(events,['nyc']);
  assert.equal(vm.runInContext("routeURL().searchParams.get('spot')",context),'nyc-01');
  await guide.select('miami');
  assert.equal(new URL(location.href).search,'');
  assert.equal(new URL(location.href).hash,'#pinch?city=miami');
  vm.runInContext("const target=routeURL();target.searchParams.set('spot','us-osm-1');writeRouteURL(target);",context);
  assert.equal(vm.runInContext("routeURL().searchParams.get('spot')",context),'us-osm-1');
  const reloaded=fixture(new URL(location.href).hash,base);
  await reloaded.ready;
  assert.deepEqual(reloaded.events,['miami']);
  assert.equal(vm.runInContext("routeURL().searchParams.get('spot')",reloaded.context),'us-osm-1');
  vm.runInContext("history.pushState=()=>{throw Object.assign(Error(),{name:'SecurityError'})}",context);
  await guide.select('sf');
  assert.deepEqual(events,['nyc','miami','sf']);
});
