import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

test('portable preview preserves application code, including literal dollar signs',async()=>{
  const root=new URL('../',import.meta.url);
  const html=await readFile(new URL('OPEN_ME.html',root),'utf8');
  const app=(await readFile(new URL('app.js',root),'utf8')).replace(/^import .*;\n/gm,'');
  assert.ok(html.includes(app),'Bundling must not interpret JavaScript dollar signs as replacement patterns');
  const modules=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.equal(modules.length,1);
  const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:modules[0],encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
  const classic=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.equal(classic.length,4);
  for(const code of classic)assert.doesNotThrow(()=>new vm.Script(code));
});
