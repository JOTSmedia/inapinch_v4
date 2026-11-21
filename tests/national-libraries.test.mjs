import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNationalIndex} from '../national-index.js';
import {filterPlaces} from '../logic.js';

const world={south:-90,west:-180,north:90,east:180};
const fixture={meta:{surveyLabel:'FY 2024',title:'Public Libraries Survey',sourceUrl:'https://www.imls.gov/'},
  rows:[
    ['us-library-1','Branch A','Main Street','Town A','AK','12345',52,179.7],
    ['us-library-2','Branch B','','Town B','AK','12345',52.1,-179.2],
    ['us-library-3','Branch C','','Town C','NY','12345',40,-74],
    ['us-library-4','Branch D','','Town C','NY','12345',40.01,-74.01]
  ]};

test('national index supports wrapped bounds and a viewport crossing the date line',()=>{
  const index=createNationalIndex([fixture]);
  for(const [west,east] of [[175,-175],[175,185],[-185,-175]]){
    assert.equal(index.query({south:50,north:54,west,east}).length,2);
  }
  assert.equal(index.query({...world,west:100,east:470}).length,4);
  assert.equal(index.get('us-library-1').address,'Main Street, Town A, AK, 12345');
  assert.equal(index.get('missing'),undefined);
});
test('public library records have conservative restroom and hours evidence',()=>{
  const index=createNationalIndex([fixture]);
  for(const flag of ['free','purchase','confirmed','accessible','open','showers','roadside']){
    assert.deepEqual(filterPlaces(index.query(world),{filters:new Set([flag])}),[]);
  }
  const groups=index.overview(world,4);
  assert.equal(groups.reduce((sum,cell)=>sum+cell.count,0),4);
  for(const group of groups)assert.equal(Boolean(group.place),group.count===1);
});
test('federal snapshot includes all states, DC and geolocated U.S. outlying branches',async()=>{
  const snapshot=JSON.parse(await readFile(new URL('../data/national-libraries.json',import.meta.url),'utf8'));
  const index=createNationalIndex([snapshot]);
  assert.equal(index.count,snapshot.meta.count);
  assert.ok(index.count>15000);
  const jurisdictions=new Set(snapshot.rows.map(row=>row[4]));
  for(const key of 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI'.split(' ')) assert.ok(jurisdictions.has(key),key);
  assert.ok(snapshot.rows.some(row=>row[8]==='approximate'));
  assert.ok(snapshot.rows.every(row=>row[0].startsWith('us-library-') && row[1] && Number.isFinite(row[6]) && Number.isFinite(row[7])));
});
