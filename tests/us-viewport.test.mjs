import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewportDiscovery, detailTiles} from '../us-viewport.js';
import {decodeTile,pointToCoordinates} from '../scripts/vector-poi.mjs';

const template='https://tiles.example/{z}/{x}/{y}.pbf';
const utf8 = str => [...new TextEncoder().encode(str)];
function varint(n) {
  const bytes=[];
  while(n>=128){bytes.push(n%128+128);n=Math.floor(n/128);}
  return [...bytes,n];
}
const uint=(key,n)=>[key*8,...varint(n)];
const field=(key,b)=>[key*8+2,...varint(b.length),...b];
// Encode only the public MVT wire fields used by the live POI reader.
function tile(...points) {
  const names=['class','name'];
  const values=[...new Set(points.flatMap(p=>[p.kind,p.name]).filter(Boolean))];
  const items=points.map(p=>{
    const attrs=[0,values.indexOf(p.kind)];
    if(p.name)attrs.push(1,values.indexOf(p.name));
    const geometry=[9,...varint(p.x*2),...varint(p.y*2)];
    return field(2,[...uint(1,p.id),...field(2,attrs),...uint(3,1),...field(4,geometry)]);
  });
  const layer=[...field(1,utf8('poi')),...items.flat(),...names.flatMap(s=>field(3,utf8(s))),
    ...values.flatMap(s=>field(4,field(1,utf8(s)))),...uint(5,4096),...uint(15,2)];
  return Uint8Array.from(field(3,layer));
}
function area(x,y,dx=0,dy=0,start=100,end=3996) {
  const nw=pointToCoordinates(start,start,14,x,y), se=pointToCoordinates(end,end,14,x+dx,y+dy);
  return {west:nw.lng,north:nw.lat,east:se.lng,south:se.lat};
}
const la=[2804,6503];
const atArea=area(...la);
const sample=tile({id:117,kind:'fuel',x:2000,y:2000}, {id:22,kind:'restaurant',name:'Café',x:2070,y:2010},
  {id:65537,kind:'toilets',x:102,y:138}, {id:42,kind:'unrelated',name:'Other',x:2050,y:2050});
const meta=()=>Response.json({tiles:[template]});
const binary=b=>new Response(b,{headers:{'content-type':'application/x-protobuf'}});
function fakeFetch(onTile) {
  const calls=[];
  return {calls,fetchImpl:async(url,opts)=>{
    calls.push(url);assert.equal(opts.credentials,'omit');assert.ok(opts.signal);
    return url.endsWith('/planet')?meta():onTile(url,opts);
  }};
}

test('neighborhood requests use visible tiles only, cap wide views and cross the dateline in either longitude convention',()=>{
  assert.equal(detailTiles(atArea,12).length,1);
  assert.equal(detailTiles(atArea,9).length,0);
  assert.equal(detailTiles(area(...la,9,9),14).length,0);
  const b={west:179.992,east:-179.992,south:51.85,north:51.852};
  const tiles=detailTiles(b,16);
  assert.deepEqual(new Set(tiles.map(t=>t.x)),new Set([0,16383]));
  assert.deepEqual(tiles,detailTiles({...b,east:180.008},16));
  assert.deepEqual(tiles,detailTiles({...b,west:-180.008},16));
  assert.equal(detailTiles({...b,north:NaN},16).length,0);
});
test('live decoder delivers eligible unnamed facilities and named restaurants, clipping cached tiles after pan',async()=>{
  const service=fakeFetch(()=>binary(sample)), events=[];
  const d=createViewportDiscovery({...service,onUpdate:e=>events.push(e.state)});
  const first=await d.load(atArea,16);
  assert.deepEqual(events,['loading','ready']);
  assert.equal(first.completedTiles,1);assert.equal(first.totalTiles,1);assert.equal(first.failedTiles,0);
  assert.deepEqual(first.features.map(f=>f.id),[117,22,65537]);
  assert.ok(!first.features[0].properties.name);
  assert.equal(first.features[0].properties.class,'fuel');
  const second=await d.load(area(...la,0,0,1950,2090),17);
  assert.deepEqual(second.features.map(f=>f.id),[117,22]);
  assert.equal(first.features[0],second.features[0]);
  assert.equal(service.calls.length,2);
  assert.equal((await d.load(atArea,6)).state,'overview');
  assert.equal(service.calls.length,2);
});
test('a clipped, decoded empty area differs from failed metadata, bad HTTP bodies and partial tiles; retry loads only misses',async()=>{
  let fail=true;
  const service=fakeFetch(url=>{
    if(fail && url.includes('/'+(la[0]+1)+'/'))return new Response('html', {headers:{'content-type':'text/html'}});
    return binary(new Uint8Array());
  });
  const d=createViewportDiscovery(service);
  const b=area(...la,1);
  let r=await d.load(b,15);
  assert.equal(r.state,'partial');assert.deepEqual(r.features,[]);assert.equal(r.completedTiles,1);assert.equal(r.failedTiles,1);
  fail=false;
  r=await d.load(b,15);
  assert.equal(r.state,'ready');assert.equal(r.totalTiles,2);assert.equal(r.failedTiles,0);assert.deepEqual(r.features,[]);
  assert.equal(service.calls.filter(u=>u.endsWith('/'+la[0]+'/'+la[1]+'.pbf')).length,1);
  const bad=createViewportDiscovery({fetchImpl:async()=>new Response(null,{status:503})});
  assert.equal((await bad.load(b,15)).state,'error');
  assert.throws(()=>decodeTile(Uint8Array.of(26,10,128)) ,/Truncated/);
  const corrupt=createViewportDiscovery(fakeFetch(()=>binary(Uint8Array.of(26,10,128))));
  assert.equal((await corrupt.load(b,15)).state,'error');
});
test('a later pan cancels older requests and stale completions never overwrite the current neighborhood',async()=>{
  let oldRelease, resolveStart;
  const oldStarted=new Promise(resolve=>{resolveStart=resolve;});
  const service=fakeFetch(async(url,options)=>{
    if(url.includes('/'+la[0]+'/')){
      resolveStart(options.signal);
      await new Promise(resolve=>{oldRelease=resolve;}); // a service ignoring abort
      return binary(sample);
    }
    return binary(tile({id:5,kind:'toilets',x:1950,y:1980}));
  });
  const events=[];
  const d=createViewportDiscovery({...service,onUpdate:event=>events.push(event)});
  const old=d.load(atArea,16);
  const oldSignal=await oldStarted;
  const fresh=await d.load(area(la[0]+1,la[1]),17);
  assert.ok(oldSignal.aborted);
  assert.deepEqual(fresh.features.map(f=>f.id),[5]);
  const n=events.length;oldRelease();
  assert.equal(await old,undefined);assert.equal(events.length,n);
});
test('tile reads can be canceled during metadata, and sparse repeated pans keep the tile cache bounded',async()=>{
  let abortCalled=false;
  const states=[];
  const d=createViewportDiscovery({onUpdate:e=>states.push(e.state),fetchImpl:async(url,{signal})=>
    new Promise((_,reject)=>signal.addEventListener('abort',()=>{abortCalled=true;reject(Error('aborted'));},{once:true}))});
  const q=d.load(atArea,15);d.cancel();await q;
  assert.equal(abortCalled,true);assert.deepEqual(states,['loading']);
  const svc=fakeFetch(()=>binary(new Uint8Array()));
  const c=createViewportDiscovery(svc);
  for(let x=0;x<=160;x++)await c.load(area(la[0]+x,la[1]),18);
  const before=svc.calls.length;
  await c.load(atArea,16);
  assert.equal(svc.calls.length,before+1);
});

test('normal app refresh promotes a live result to its packaged equivalent, keeps share links resolvable, and clears it on an international pan',async()=>{
  const {default:vm}=await import('node:vm');
  const {readFile}=await import('node:fs/promises');
  const {usRegionAt,usRegionsInBounds}=await import('../us-geography.js');
  const {placeFromFeature,createVenueMatcher}=await import('../venue-data.js');
  const {distanceMiles}=await import('../logic.js');
  const {routeURL,writeRouteURL}=await import('../city-guide.js');
  const {mapBounds,intersects,pointFilter}=await import('../atlas-view.js');
  const app=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/start\(\);\s*$/,'');
  const {lat,lng}=pointToCoordinates(2070,2010,14,...la);
  const authoritative={id:'us-osm-n781',name:'Café',lat,lng,category:'Restaurant',cityId:'us'};
  const svc=fakeFetch(()=>binary(sample));
  const actual=createViewportDiscovery;
  const items=new Map(), links=[], opened=[];
  const get=id=>{if(!items.has(id))items.set(id,{value:'',textContent:''});return items.get(id);};
  const ctx=vm.createContext({
    URL,Map,Set,distanceMiles,mapBounds,intersects,pointFilter,placeFromFeature,createVenueMatcher,usRegionAt,usRegionsInBounds,
    localStorage:{getItem:()=>null}, document:{getElementById:get}, location:{href:'https://example.org/'},
    history:{replaceState:(a,b,url)=>links.push(url.href)}, opened, clearTimeout,setTimeout,
    fixture:{bounds:atArea,zoom:16},authoritative,
    createViewportDiscovery:opts=>{
      const d=actual({...opts,fetchImpl:svc.fetchImpl});
      return {cancel:d.cancel,load:(b,z)=>ctx.loadPromise=d.load(b,z)};
    }
  });
  vm.runInContext(routeURL.toString()+'\n'+writeRouteURL.toString()+'\n'+app+`
    city={id:'us',name:'United States'};cityGuide={cities:[]};
    nationalIndex={query:()=>[]};
    venueAtlas={query:()=>new Promise(resolve=>globalThis.packageArrived=resolve),overview:()=>[]};
    render=()=>{placeIndex=new Map(places.map(p=>[p.id,p]));};
    renderDetails=p=>opened.push(p.id);
    openDetail=id=>{selectedId=id;pendingSpot=null;opened.push(id);};
    map={getZoom:()=>fixture.zoom,getCenter:()=>({lat:(fixture.bounds.south+fixture.bounds.north)/2,lng:(fixture.bounds.east+fixture.bounds.west)/2}),
      getBounds:()=>({getSouth:()=>fixture.bounds.south,getNorth:()=>fixture.bounds.north,getWest:()=>fixture.bounds.west,getEast:()=>fixture.bounds.east})};
    globalThis.ui={refreshViewport,ids:()=>places.map(p=>p.id),selected:()=>selectedId,
      select:id=>{selectedId=id;}, link:id=>{pendingSpot={id};applyViewport(viewport);}};
  `,ctx);
  ctx.ui.refreshViewport();await ctx.loadPromise;
  assert.ok(ctx.ui.ids().includes('us-poi-22'));
  ctx.ui.select('us-poi-22');
  ctx.packageArrived({records:[authoritative],partial:false});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ctx.ui.selected(),authoritative.id);
  assert.ok(!ctx.ui.ids().includes('us-poi-22'));
  assert.equal(new URL(links.at(-1)).searchParams.get('spot'),authoritative.id);
  ctx.ui.link('us-poi-22');assert.equal(opened.at(-1),authoritative.id);
  const before=svc.calls.length;
  ctx.fixture.bounds={west:-.14,east:-.10,south:51.50,north:51.51};
  ctx.ui.refreshViewport();
  assert.equal(get('area-name').textContent,'Outside the U.S.');
  assert.deepEqual([...ctx.ui.ids()],[]);
  assert.equal(svc.calls.length,before);
});
