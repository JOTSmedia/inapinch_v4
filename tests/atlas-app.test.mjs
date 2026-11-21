import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {escapeHTML, distanceMiles, isRoadside, isFoodVenue, businessListingURL, scheduleStatus, directionsURL} from '../logic.js';
import {mapBounds, intersects, pointFilter, markerGroups} from '../atlas-view.js';
import {createVenueMatcher, placeFromFeature} from '../venue-data.js';
import {usRegionAt, usRegionsInBounds} from '../us-geography.js';
const src=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/start\(\);\s*$/,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const boundsAt=(lat,lng)=>({south:lat-.015,north:lat+.015,west:lng-.018,east:lng+.018});
const feature=(id,name,lat,lng)=>({id,properties:{name,class:'restaurant'},geometry:{type:'Point',coordinates:[lng,lat]}});
function harness(){
  const controls=new Map(), queue=[];
  const get=id=>{if(!controls.has(id))controls.set(id,{value:'',textContent:'',hidden:false});return controls.get(id);};
  const context=vm.createContext({
    URL,Map,Set,localStorage:{getItem(){return null;}},document:{getElementById:get},
    e:escapeHTML,isRoadside,isFoodVenue,businessListingURL,scheduleStatus,directionsURL,
    distanceMiles,mapBounds,intersects,pointFilter,createVenueMatcher,placeFromFeature,usRegionAt,usRegionsInBounds,
    createViewportDiscovery:({onUpdate})=>({cancel(){},load(){onUpdate({state:'loading',features:[]});context.emit=onUpdate;}}),
    fixture:{zoom:16,bounds:boundsAt(43.48,-110.76)},queue,
    nationalData:{query:()=>[]},setTimeout,clearTimeout,console
  });
  vm.runInContext(src+`
    nationalIndex=nationalData;
    city={id:'us',name:'United States'};cityGuide={cities:[]};
    venueAtlas={query:b=>new Promise(resolve=>queue.push(resolve)),overview:()=>[]};
    render=()=>{placeIndex=new Map(places.map(p=>[p.id,p]));};
    map={getZoom:()=>fixture.zoom,getCenter:()=>({lat:(fixture.bounds.south+fixture.bounds.north)/2,lng:(fixture.bounds.east+fixture.bounds.west)/2}),getBounds:()=>({getSouth:()=>fixture.bounds.south,getNorth:()=>fixture.bounds.north,getWest:()=>fixture.bounds.west,getEast:()=>fixture.bounds.east})};
    globalThis.flow={refreshViewport,ids:()=>places.map(p=>p.id), message:areaMessage};
  `,context);
  return {c:context,controls:get,queue};
}
test('panning between Wyoming and New Jersey replaces markers, state and neighborhood results; stale data stays discarded',async()=>{
  const {c,queue,controls}=harness();
  c.flow.refreshViewport();
  c.emit({state:'ready',features:[feature(1,'Jackson Café',43.48,-110.76)]});
  assert.deepEqual([...c.flow.ids()],['us-poi-1']);
  assert.equal(controls('area-name').textContent,'Wyoming');
  c.fixture.bounds=boundsAt(40.818,-74.21);
  c.flow.refreshViewport();
  assert.deepEqual([...c.flow.ids()],[]);
  queue[0]({records:[{id:'obsolete',name:'Old Wyoming result',lat:43.48,lng:-110.76}],partial:false});
  await tick();
  assert.deepEqual([...c.flow.ids()],[]);
  c.emit({state:'ready',features:[feature(2,'Montclair Café',40.818,-74.21)]});
  assert.deepEqual([...c.flow.ids()],['us-poi-2']);
  assert.equal(controls('area-name').textContent,'New Jersey');
  queue[1]({records:[],partial:false});
  await tick();
  assert.equal(controls('area-retry').hidden,true);
});
test('local atlas listings remain usable when the neighborhood service is unavailable',async()=>{
  const {c,queue,controls}=harness();
  c.flow.refreshViewport();
  c.emit({state:'error',features:[]});
  queue[0]({records:[{id:'us-osm-n123',name:'Example library',lat:43.48,lng:-110.76}],partial:false});
  await tick();
  assert.deepEqual([...c.flow.ids()],['us-osm-n123']);
  assert.equal(controls('area-retry').hidden,false);
  assert.match(controls('area-status').textContent,/could not load/);
});
test('crossing the dateline keeps US place coordinates in view and clusters on the visible world copy',()=>{
  const b={south:49,north:55,west:178,east:184};
  assert.equal(pointFilter(b)({lat:52,lng:-179}),true);
  assert.equal(intersects(b,{south:50,north:53,west:-180,east:-178}),true);
  const fake={getCenter:()=>({lng:181}),getZoom:()=>8,project:([lat,lng])=>({x:lng,y:lat})};
  const groups=[...markerGroups([{lat:52,lng:-179,id:'a'},{lat:52,lng:179,id:'b'}],fake)];
  assert.equal(groups.length,1);assert.equal(groups[0].sumLng/2,180);
});


test('an operator duplicate enriches a mapped shower with its contact and driving directions',()=>{
  const {c,controls}=harness();
  const baseline={id:'guide',name:'Example Travel Stop',category:'Mapped shower',lat:43.48,lng:-110.76,
    cityId:'us',showers:true,dynamicListing:true,sources:[{label:'Map',url:'https://example.com/map'}]};
  const operator={...baseline,id:'operator',category:'Truck stop',evidenceType:'operator-directory',roadside:true,
    phone:'(307) 555-0123',showerCount:3,accessibleShowerCount:1,showerNote:'The operator lists 3 showers. Check availability.',
    sources:[{label:'Operator',url:'https://example.com/stop'}]};
  c.baseline=baseline;c.operator=operator;
  c.flow.refreshViewport();
  vm.runInContext("viewport.guidePlaces=[baseline];viewport.indexRows=[operator];applyViewport(viewport);applyViewport(viewport);renderDetails(places[0]);",c);
  assert.deepEqual([...c.flow.ids()],['guide']);
  assert.equal(baseline.sources.length,1);
  assert.equal(baseline.roadside,undefined);
  const html=controls('detail-content').innerHTML;
  assert.equal(html.match(/3 showers/g).length,1);
  assert.match(html,/href="tel:\+13075550123"/);
  assert.match(html,/Driving directions/);
  assert.match(html,/<dt>Accessible showers<\/dt><dd>1 listed by the operator/);
  assert.match(html,/https:\/\/example.com\/stop/);
  assert.match(html,/https:\/\/example.com\/map/);
  assert.equal(vm.runInContext("placeIcon(places[0])",c),'shower');
  assert.equal(vm.runInContext("placeIcon({category:'Gas station'})",c),'fuel');
  assert.equal(vm.runInContext("roadsidePhone({...operator,phone:'javascript:alert(1)'});",c),null);
  assert.equal(vm.runInContext("showerDescription({...operator,showerCount:1,showerNote:'Showers listed by the operator. Check fees.'})",c),'1 shower listed. Check fees.');
});
