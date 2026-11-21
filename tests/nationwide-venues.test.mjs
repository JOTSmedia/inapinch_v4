import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeFromFeature,createVenueMatcher,mergeVenuePlaces,getCachedPlaces,saveVenues,deleteCachedPlaces} from '../venue-data.js';
import {businessListingURL,filterPlaces,isFoodVenue} from '../logic.js';

const places = {
  helena: [-112.036, 46.589],
  juneau: [-134.410, 58.302],
  hilo: [-155.086, 19.725],
  vancouver: [-123.117, 49.283]
};
const feature = (id,kind,coordinates,name) => ({
  id, properties:{class:kind,name}, geometry:{type:'Point',coordinates}
});

test('a Montana venue is discoverable from any active guide and links to its actual location', () => {
  const point = feature(943,'bar',places.helena,'Downtown Taproom');
  const currentCity = {id:'key-west',name:'Key West',state:'FL'};
  const venue = placeFromFeature(point,currentCity);
  assert.equal(venue.id,'us-poi-943');
  assert.deepEqual(venue,placeFromFeature(point,{id:'nyc'}));
  assert.equal(venue.state,'MT');
  assert.equal(venue.neighborhood,'Montana');
  const query = new URL(businessListingURL(venue,currentCity)).searchParams.get('query');
  assert.match(query,/Downtown Taproom/);
  assert.match(query,/-112\.036/);
  assert.doesNotMatch(query,/Key West|FL/);
  assert.equal(venue.access,'unknown');
  assert.deepEqual(filterPlaces([venue],{filters:new Set(['confirmed'])}),[]);
});

test('a regional or unnamed facility is discoverable without implying restroom availability', () => {
  for (const [coordinates,state] of [[places.hilo,'HI'],[places.juneau,'AK']]) {
    for (const kind of ['fuel','rest_area','services','library','fast_food','restaurant','convenience']) {
      const point = placeFromFeature(feature(0,kind,coordinates));
      assert.equal(point.id,'us-poi-0');
      assert.equal(point.nameKnown,false);
      assert.equal(point.state,state);
      assert.equal(point.bathroomConfirmed,false);
      assert.equal(point.access,'unknown');
      assert.equal(point.accessible,null);
      assert.equal(point.hours,undefined);
      assert.equal(new URL(businessListingURL(point)).searchParams.get('query'), coordinates[1].toFixed(5) + ',' + coordinates[0].toFixed(5));
    }
  }
  assert.equal(placeFromFeature(feature(1,'restaurant',places.vancouver)),null);
  assert.equal(placeFromFeature(feature(1,'toilets',null)),null);
});

test('POI names, source addresses, and numeric-string IDs survive conversion', () => {
  const f = feature('94512345678901234','restaurant',places.helena,'La Peña');
  Object.assign(f.properties,{'addr:housenumber':'2','addr:street':'Test Street','addr:city':'Helena'});
  const p = placeFromFeature(f);
  assert.equal(p.id,'us-poi-94512345678901234');
  assert.equal(p.address,'2 Test Street');
  assert.equal(p.addressKnown,true);
  assert.equal(p.neighborhood,'Helena, MT');
  assert.equal(isFoodVenue(p),true);
  assert.match(new URL(businessListingURL(p,{id:'nyc',name:'New York City',state:'NY'})).searchParams.get('query'), /^La Peña, 2 Test Street, Helena, MT$/);
});

test('source identity matches V3 snapshots, recent renames and share links across guides', () => {
  const snapshot = {id:'nyc-poi-87543',name:'Previous name',sourceFeatureId:87543,lat:40.78,lng:-73.97};
  const update = placeFromFeature(feature(87543,'bar',[-73.97,40.78],'Renamed business'));
  const matcher = createVenueMatcher([snapshot]);
  assert.equal(matcher.byId(update.id),snapshot);
  assert.equal(matcher.find(update),snapshot);
  assert.deepEqual(mergeVenuePlaces([snapshot],[update]),[]);
  assert.equal(createVenueMatcher([update]).byId(snapshot.id),update);
});

test('distinct nearby unnamed toilets and non-Latin venue names retain their identities', () => {
  const row = (id,name,kind='toilets') => placeFromFeature(feature(id,kind,places.helena,name));
  const a = row(11), b = row(12);
  assert.equal(mergeVenuePlaces([a],[b]).length,1);
  const c = row(undefined,'松','restaurant'), d = row(undefined,'林','restaurant');
  assert.notEqual(c.id,d.id);
  assert.equal(mergeVenuePlaces([c],[d]).length,1);
  assert.equal(mergeVenuePlaces([c],[{...c,id:'official'}]).length,0);
});

test('optional browser bookmark storage gracefully handles missing IndexedDB', async () => {
  if (globalThis.indexedDB) return;
  assert.deepEqual(await getCachedPlaces(['us-poi-45','la-poi-951']),[]);
  assert.equal(await saveVenues([{id:'us-poi-45'}]),false);
  assert.equal(await deleteCachedPlaces(['us-poi-45']),false);
});

test('discarded source IDs can resolve saved pins and deep links using the surviving record', () => {
  const live = placeFromFeature(feature(9,'toilets',places.helena));
  const atlas = {...live, id:'us-osm-n56', evidenceType:'osm-atlas', sourceFeatureId:null};
  const matcher = createVenueMatcher([atlas]);
  assert.equal(matcher.find(live),atlas);
  matcher.alias(live.id,atlas);
  assert.equal(matcher.byId(live.id),atlas);
  assert.equal(matcher.byId('nyc-poi-9'),atlas);
  const nextDoor = placeFromFeature(feature(12,'toilets',[places.helena[0],places.helena[1]+0.00004]));
  assert.equal(matcher.find(nextDoor),undefined);
});

test('verified shower filter fields require shower-specific evidence', () => {
  const source = feature(1,'fuel',places.helena,'Example Truck Stop');
  assert.equal(placeFromFeature(source).showers,null);
  source.properties.shower = 'no';
  assert.equal(placeFromFeature(source).showers,null);
  source.properties.shower = 'yes';
  assert.equal(placeFromFeature(source).showers,true);
  assert.equal(placeFromFeature(feature(2,'shower',places.helena)).showers,true);
  assert.equal(placeFromFeature(feature(2,'showers',places.helena)).bathroomConfirmed,false);
});

test('nearby stops with the same name and distinct source identities stay separate', () => {
  const west = placeFromFeature(feature(37,'rest_area',places.helena,'River Rest Area'));
  const east = placeFromFeature(feature(38,'rest_area',[places.helena[0]+.00012,places.helena[1]],'River Rest Area'));
  assert.equal(createVenueMatcher([west]).find(east),undefined);
});
