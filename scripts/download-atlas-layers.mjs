// Fetch only the archive members consumed by extract-roadside.py.
// Existing dated extract metadata and completed layer bytes in work/geo-raw are reused.
import {parseArgs} from 'node:util';
import {fetchArchive,listArchives,readLayerGroup} from './geofabrik-archive.mjs';

const {values} = parseArgs({options:{
  state: {type:'string', multiple:true},
  layer: {type:'string', multiple:true},
  help: {type:'boolean', short:'h'}
}});

if (values.help) {
  console.log('Usage: node scripts/download-atlas-layers.mjs [--state geofabrik-slug] [--layer pois|roads]');
  console.log('Downloads all U.S. source extracts by default. Repeat --state to select multiple extracts.');
  console.log('Use --state california for both California files. Interrupted runs reuse their local cache.');
  process.exit(0);
}

const groups = [...new Set(values.layer || ['pois','roads'])];
if (groups.some(group => !['pois','roads'].includes(group))) throw Error('--layer requires pois or roads');
const requested = new Set((values.state || []).map(s => s.toLowerCase().replace(/[ _]+/g,'-')));
if (requested.delete('california')) { requested.add('norcal'); requested.add('socal'); }

const {downloadTerritoryBatch,territorySlugs,territoryTiles} = await import('./import-virgin-islands.mjs');
const territoryTargets=Object.entries(territorySlugs).map(([slug,code])=>({slug,code}));
const onlyVectorTargets=requested.size>0 && [...requested].every(slug=>Object.hasOwn(territorySlugs,slug));
// These regional extract names refer mainly to neighboring countries. Use the
// U.S. territory snapshots consistently for GU, MP, AS and VI.
const excluded=new Set(['micronesia','samoa',...Object.keys(territorySlugs)]);
const archiveTargets=onlyVectorTargets?[]:(await listArchives()).filter(target=>!excluded.has(target.slug));
const available=[...archiveTargets,...territoryTargets];
for (const slug of requested) {
  if (!available.some(archive => archive.slug === slug)) throw Error('Unknown source extract: ' + slug);
}
const targets = available.filter(archive => !requested.size || requested.has(archive.slug))
  .sort((a,b) => Number(Boolean(a.code)) - Number(Boolean(b.code)));
const failures = [];
for (const [index, {slug,url,code}] of targets.entries()) {
  try {
    if (code) {
      const result = await downloadTerritoryBatch({code,limit:territoryTiles(code).length});
      console.log(slug,result.done + '/' + result.planned,'tiles,',result.rows,'places');
      if (result.remaining) throw Error(result.remaining + ' territory tiles outstanding. Inspect work/'+code.toLowerCase()+'-vector/manifest.json');
    } else {
      const archive = await fetchArchive(slug,url);
      for (const group of groups) await readLayerGroup(archive,group);
      console.log((index+1) + '/' + targets.length, slug, groups.join('+'));
    }
  } catch (error) {
    failures.push(slug);
    console.error(slug + ' incomplete:',error.message);
  }
}
if (failures.length) {
  process.exitCode = 1;
  console.error('Retry these extracts:',failures.map(slug=>'--state ' + slug).join(' '));
}
