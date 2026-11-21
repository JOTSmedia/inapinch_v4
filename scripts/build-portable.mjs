import {readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {posix, join} from 'node:path';
import {gzipSync} from 'node:zlib';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>readFile(join(root,file),'utf8');
const embedded={'cities.json':JSON.parse(await read('cities.json'))};
for(const file of await readdir(join(root,'data'))){
  if(file.endsWith('.json'))embedded['data/'+file]=JSON.parse(await read('data/'+file));
}
let html=await read('index.html');
for(const [,file] of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)]){
  const css=await read(file);
  html=html.replace('<link rel="stylesheet" href="'+file+'">',()=>'<style>'+css+'</style>');
}
for(const [,file] of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]){
  const vendor=(await read(file)).replace(/<\/script/gi,'<\\/script');
  html=html.replace('<script src="'+file+'"></script>',()=>'<script>'+vendor+'</script>');
}
// Bundle the app's actual module graph. The portable and hosted entry points
// must execute the same viewport, geolocation and data conversion code.
const packed=gzipSync(JSON.stringify(embedded)).toString('base64');
let script=`const packed=Uint8Array.from(atob('${packed}'),c=>c.charCodeAt(0));
const directory=JSON.parse(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
const nativeFetch=window.fetch.bind(window);
window.fetch=(url,options)=>{
  const key=String(url).replace(/^\\.\\//,'');
  if(key==='locations.json')return Promise.resolve(Response.json({locations:directory['cities.json'].flatMap(c=>directory['data/'+c.id+'.json'].locations.map(p=>({id:p.id,cityId:p.cityId})))}));
  return Object.hasOwn(directory,key)?Promise.resolve(Response.json(directory[key])):nativeFetch(url,options);
};
const bundledModules={};\n`;
const visited=new Set();
async function bundle(file){
  if(visited.has(file))return;
  visited.add(file);
  const source=await read(file);
  const imports=/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];[ \t]*\n/gm;
  const bindings=[];
  for(const [,names,path] of source.matchAll(imports)){
    const dependency=posix.normalize(posix.join(posix.dirname(file),path));
    await bundle(dependency);
    const fields=names.trim().replace(/\s+as\s+/g,':');
    bindings.push('const {'+fields+'}=bundledModules['+JSON.stringify(dependency)+'];');
  }
  const exports=[...source.matchAll(/^export\s+(?:async\s+)?(?:class|function|const|let)\s+([\w$]+)/gm)].map(match=>match[1]);
  const body=source.replace(imports,'').replace(/^export\s+/gm,'');
  script+='bundledModules['+JSON.stringify(file)+']=(()=>{\n'+bindings.join('\n')+'\n'+body+'\nreturn {'+exports.join(',')+'};})();\n';
}
await bundle('app.js');
html=html.replace('<script type="module" src="app.js"></script>',()=>'<script type="module">'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
await writeFile(join(root,'OPEN_ME.html'),html);
console.log('Built portable V4 from '+visited.size+' application modules.');
