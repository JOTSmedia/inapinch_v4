import test from 'node:test';
import assert from 'node:assert/strict';
import {usRegionAt, usRegions, usRegionsInBounds, usRegionView} from '../us-geography.js';

test('all 50 states, DC and five inhabited territories have an in-region view', () => {
  assert.equal(new Set(usRegions.map(r => r.code)).size, 56);
  for (const region of usRegions) {
    const {lat,lng,zoom} = usRegionView(region.code.toLowerCase());
    assert.equal(usRegionAt(lat,lng)?.code,region.code);
    assert.ok(zoom >= 3 && zoom <= 14);
  }
  assert.equal(usRegionView('ZZ'),null);
});

test('US eligibility follows the border through populated binational areas', () => {
  const cases = [
    [42.886,-78.879,'NY'], [42.904,-78.922,null], // Buffalo, Fort Erie
    [42.33,-83.05,'MI'], [42.31,-83.035,null],   // Detroit, Windsor
    [31.75,-106.48,'TX'], [31.72,-106.46,null], // El Paso, Ciudad Juárez
    [48.981,-123.074,'WA'], [49.019,-123.087,null], // Point Roberts, Tsawwassen
    [38.898,-77.036,'DC'], [24.555,-81.78,'FL']
  ];
  for (const [lat,lng,expected] of cases) assert.equal(usRegionAt(lat,lng)?.code ?? null,expected);
});

test('Aleutian places on both sides of the date line and populated territories resolve', () => {
  const cases = [
    [52.932,173.184,'AK'], [51.881,-176.658,'AK'], [21.307,-157.858,'HI'],
    [-14.276,-170.7,'AS'], [15.175,145.741,'MP'], [13.476,144.75,'GU'],
    [17.737,-64.707,'VI'], [18.465,-66.106,'PR']
  ];
  for (const [lat,lng,expected] of cases) {
    for (const wrap of [-360,0,360]) assert.equal(usRegionAt(lat,lng+wrap)?.code,expected);
  }
});

test('region lookup supports wrapped viewports, tiny inland boxes, islands and the world', () => {
  const codes = (west,south,east,north) => usRegionsInBounds({west,south,east,north}).map(r=>r.code);
  assert.deepEqual(codes(179,51,-179,54),['AK']);
  assert.deepEqual(codes(533.1,52.89,533.32,53.1),['AK']);
  assert.deepEqual(codes(-82,24,-81,25),['FL']);
  assert.deepEqual(codes(-76.998,38.900,-76.997,38.901),['DC']);
  assert.deepEqual(codes(-122.42,49.2,-122.418,49.21),[]);
  assert.deepEqual(codes(-104.5,48.9,-103.5,49.1),['MT','ND']);
  assert.equal(codes(-180,-90,180,90).length,56);
});

test('non-finite and out-of-range inputs cannot select a region', () => {
  for (const [lat,lng] of [[NaN,-80],[91,-80],[34,Infinity],[null,-80]]) {
    assert.equal(usRegionAt(lat,lng),null);
  }
  assert.deepEqual(usRegionsInBounds({west:0,east:1,south:10,north:1}),[]);
  assert.deepEqual(usRegionsInBounds({west:0,east:Infinity,south:0,north:1}),[]);
});
