import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addStreetMap,STREET_TILE_URL} from '../street-map.js';
function setup(){
  const handlers={};const status={hidden:true,textContent:''};const map={};let captured;
  const layer={on(event,callback){handlers[event]=callback;return this;},addTo(target){assert.equal(target,map);return this;}};
  const L={tileLayer(url,options){captured={url,options};return layer;}};
  assert.equal(addStreetMap(map,L,status),layer);
  return {handlers,status,captured};
}
test('street maps request the official public tile endpoint without credentials',()=>{
  const {captured}=setup();
  assert.equal(captured.url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(captured.url,STREET_TILE_URL);
  assert.equal(Object.keys(captured.options).some(k=>/key|token|auth/i.test(k)),false);
  assert.match(captured.options.attribution,/OpenStreetMap contributors/);
  assert.equal(captured.options.referrerPolicy,'strict-origin-when-cross-origin');
});
test('successful viewport loads clear an earlier network warning',()=>{
  const {handlers,status}=setup();
  handlers.loading();handlers.tileerror();handlers.load();assert.equal(status.hidden,false);
  handlers.loading();handlers.tileload();handlers.load();assert.equal(status.hidden,true);
});
test('failed and partial tile loads explain connection trouble without blocking the directory',()=>{
  const {handlers,status}=setup();
  handlers.loading();handlers.tileerror();handlers.load();
  assert.equal(status.hidden,false);assert.match(status.textContent,/Check your connection/);
  assert.match(status.textContent,/pins, the list, and walking directions remain available/);
  handlers.loading();handlers.tileload();handlers.tileerror();handlers.load();
  assert.equal(status.hidden,false);assert.match(status.textContent,/Some street-map tiles/);
});
