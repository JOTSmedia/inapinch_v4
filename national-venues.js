import {intersects, pointFilter} from './atlas-view.js';
import {placeFromFeature} from './venue-data.js';

const chunkRequests = new Map();
const receivers = new Map();

// Local script assets work on GitHub Pages and when OPEN_ME.html is double-clicked.
// Only a generated numeric grid key is used to construct the asset path.
function loadChunk(key) {
  if (chunkRequests.has(key)) {
    const promise = chunkRequests.get(key);
    chunkRequests.delete(key);
    chunkRequests.set(key, promise);
    return promise;
  }
  if (!/^\d+-\d+$/.test(key)) return Promise.reject(Error('Invalid map area'));
  globalThis.inAPinchAtlasData = (id, encoded) => receivers.get(id)?.(encoded);
  const request = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    const finish = () => {clearTimeout(timer); receivers.delete(key); el.remove();};
    const fail = () => {finish(); reject(Error('Could not load the map area'));};
    const timer = setTimeout(fail, 20000);
    receivers.set(key, async encoded => {
      finish();
      try {
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        resolve(await new Response(stream).json());
      } catch(error) { reject(error); }
    });
    el.onerror = fail;
    el.src = './data/atlas/' + key + '.js';
    document.head.append(el);
  });
  chunkRequests.set(key, request);
  request.catch(() => {if(chunkRequests.get(key)===request)chunkRequests.delete(key);});
  // Pending requests are shared even while a user is panning.
  request.then(() => {
    if (chunkRequests.size > 12) {
      const oldest = [...chunkRequests.keys()].find(k => !receivers.has(k));
      if (oldest) chunkRequests.delete(oldest);
    }
  }, () => {});
  return request;
}

function tileBounds(x, y, zoom) {
  const n = 2 ** zoom;
  const latitude = row => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) * 180 / Math.PI;
  return {west:360*x/n-180, east:360*(x+1)/n-180, north:latitude(y), south:latitude(y+1)};
}

export async function loadVenueAtlas() {
  const result = await fetch('./data/atlas-catalog.json');
  if (!result.ok) throw Error('National map index unavailable');
  return createVenueAtlas(await result.json());
}

export function createVenueAtlas(catalog, readChunk = loadChunk) {
  const tiles = catalog.chunks.map(([key]) => {
    const [x,y] = key.split('-').map(Number);
    return {key, bounds:tileBounds(x,y,catalog.chunkZoom)};
  });
  const cells = catalog.cells.map(([x,y,state,count,restrooms,lat,lng,wcLat,wcLng,roads,roadLat,roadLng]) =>
    ({state,count,restrooms,lat:lat/1e5,lng:lng/1e5,wcLat:wcLat/1e5,wcLng:wcLng/1e5,
      roads,roadLat:roadLat/1e5,roadLng:roadLng/1e5,bounds:tileBounds(x,y,catalog.cellZoom)}));

  function overview(bounds, mode) {
    const selection=mode===true?'confirmed':mode;
    const result=[];
    for(const c of cells){
      if(!intersects(bounds,c.bounds))continue;
      let {count,lat,lng}=c;
      if(selection==='confirmed'){count=c.restrooms;lat=c.wcLat;lng=c.wcLng;}
      if(selection==='roadside'){count=c.roads;lat=c.roadLat;lng=c.roadLng;}
      if(count)result.push({state:c.state,count,lat,lng,bounds:c.bounds});
    }
    return result;
  }

  async function query(bounds) {
    const visible = pointFilter(bounds);
    const needed = tiles.filter(tile => intersects(bounds,tile.bounds));
    const results = await Promise.allSettled(needed.map(tile => readChunk(tile.key)));
    const records = [];
    for (const page of results) {
      if (page.status!=='fulfilled') continue;
      for (const [id,kindCode,rawLat,rawLng,name,additional=[]] of page.value) {
        const lat=rawLat/1e5, lng=rawLng/1e5;
        if (!visible({lat,lng})) continue;
        const kind = catalog.kinds[kindCode];
        const place = placeFromFeature({properties:{class:kind,name}, geometry:{type:'Point',coordinates:[lng,lat]}});
        if (!place) continue;
        const tags=[kind,...additional.map(i=>catalog.kinds[i])];
        place.roadside=tags.some(k=>['fuel','services','rest_area','truck_stop'].includes(k));
        if(tags.includes('shower')||tags.includes('showers'))place.showers=true;
        place.purchaseLikely ||= tags.some(k=>['restaurant','cafe','bar','pub','fast_food','biergarten','food_court'].includes(k));
        place.searchTerms=tags.join(' ').replaceAll('_',' ');
        if(id.startsWith('v')){
          place.sourceFeatureId=id.slice(1);place.id='us-poi-'+place.sourceFeatureId;
          place.checkedLabel='OpenFreeMap territory extract · '+catalog.checked;
        }else{
          place.id='us-osm-'+id;place.evidenceType='osm-atlas';
          place.checkedLabel='Geofabrik U.S. extracts · '+catalog.checked;
          place.sources[1]={label:'OpenStreetMap data from Geofabrik',url:'https://download.geofabrik.de/north-america/us.html'};
        }
        records.push(place);
      }
    }
    return {records,partial:results.some(r=>r.status==='rejected')};
  }
  return {overview,query,count:catalog.count,regions:catalog.regions};
}

// Group by actual counts, so a dense cell contributes its share of the centroid.
export function atlasBuckets(cells, map) {
  const groups=new Map(), zoom=map.getZoom(), mid=map.getCenter().lng;
  for(const cell of cells){
    const lng=cell.lng+360*Math.round((mid-cell.lng)/360);
    const pixel=map.project([cell.lat,lng],zoom);
    const key=Math.floor(pixel.x/66)+'/'+Math.floor(pixel.y/66);
    let group=groups.get(key);
    if(!group){group={count:0,lat:0,lng:0,anchor:cell,states:new Set()};groups.set(key,group);}
    group.count+=cell.count;group.lat+=cell.lat*cell.count;group.lng+=lng*cell.count;
    group.states.add(cell.state);
    if(cell.count>group.anchor.count)group.anchor=cell;
  }
  return [...groups.values()].map(g=>({...g,lat:g.lat/g.count,lng:g.lng/g.count,states:[...g.states].sort()}));
}
