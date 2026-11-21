import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isFoodVenue,businessListingURL,shouldLocateOnStart,preferredMapStyle} from '../logic.js';
test('fresh visits locate automatically; explicit city and bathroom links keep their destination',()=>{
  assert.equal(shouldLocateOnStart('https://example.com/v2/'),true);
  assert.equal(shouldLocateOnStart('https://example.com/v2/?city=nyc'),false);
  assert.equal(shouldLocateOnStart('https://example.com/v2/?city=sf&spot=sf-05'),false);
  assert.equal(shouldLocateOnStart('https://example.com/v2/?spot=bayview'),false);
});
test('wireframe is the default and City is an explicit alternative',()=>{
  assert.equal(preferredMapStyle(null),'wireframe');assert.equal(preferredMapStyle('wireframe'),'wireframe');
  assert.equal(preferredMapStyle('city'),'city');assert.equal(preferredMapStyle('bogus'),'wireframe');
});
test('restaurant and bar categories get business links; parks do not',()=>{
  for(const category of ['Restaurant','Bar','Pub','Restaurant & bar','Beer garden','Café','Food hall'])assert.equal(isFoodVenue({category}),true,category);
  for(const category of ['Park','Public restroom','Airport'])assert.equal(isFoodVenue({category}),false,category);
});
test('Maps links identify the named business and city, handle punctuation, and carry no key',()=>{
  const p={name:'Pickles Pub’s Sandbar',address:'511 Greene Street'};
  const url=new URL(businessListingURL(p,{name:'Key West',state:'FL'}));
  assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/maps/search/');
  assert.equal(url.searchParams.get('api'),'1');
  assert.equal(url.searchParams.get('query'),'Pickles Pub’s Sandbar, 511 Greene Street, Key West, FL');
  assert.equal(url.searchParams.has('key'),false);
  assert.equal(new URL(businessListingURL({...p,googlePlaceId:'known-place'},{name:'Key West'})).searchParams.get('query_place_id'),'known-place');
});
test('every food venue in the shipped directory resolves to a named Maps destination',async()=>{
  const read=async n=>JSON.parse(await readFile(new URL('../'+n,import.meta.url),'utf8'));
  const cities=await read('cities.json');const data=await read('locations.json');let count=0;
  for(const place of data.locations.filter(isFoodVenue)){
    const city=cities.find(c=>c.id===place.cityId);assert.ok(city);
    const query=new URL(businessListingURL(place,city)).searchParams.get('query');
    assert.ok(query.includes(place.name)&&query.includes(city.name));count++;
  }
  assert.ok(count>=134);
});
