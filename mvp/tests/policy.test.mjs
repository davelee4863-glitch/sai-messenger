import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeDataPath} from '../store.mjs';
import {createMVP} from '../server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),base='ceff7952c04506ddd42ca012ec10ba5cf89c4761';
const read=path=>readFileSync(resolve(root,path),'utf8');
test('legacy product, Pages source/workflows and risk Git blobs remain unchanged',()=>{
 const paths=execFileSync('git',['ls-tree','-r','--name-only',base],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(path=>/^(docs\/|public\/|scripts\/|tests\/)|^(server\.js|package(?:-lock)?\.json|\.github\/workflows\/(?:ui-preview|harness)\.yml|harness\/known-risks\.json)$/.test(path));
 assert.ok(paths.length>15);for(const path of paths)assert.equal(execFileSync('git',['hash-object','--path='+path,path],{cwd:root,encoding:'utf8'}).trim(),execFileSync('git',['rev-parse',base+':'+path],{cwd:root,encoding:'utf8'}).trim(),path);
 const prior=JSON.parse(execFileSync('git',['show',base+':harness/incidents.json'],{cwd:root,encoding:'utf8'}));assert.deepEqual(JSON.parse(read('harness/incidents.json')).incidents.slice(0,prior.incidents.length),prior.incidents);
});
test('database, journal sidecars and credential files are ignored and never tracked',()=>{
 for(const path of ['mvp/.mvp-data/core.sqlite','mvp/private/test-credentials.json','mvp/core.sqlite-wal','mvp/core.sqlite-shm','mvp/node_modules/ws/package.json'])assert.ok(execFileSync('git',['check-ignore',path],{cwd:root,encoding:'utf8'}).trim());
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0');assert.equal(tracked.filter(path=>/\.(?:sqlite|db)(?:-wal|-shm)?$|(?:^|\/)test-credentials.*\.json$|(?:^|\/)node_modules\//.test(path)).length,0);
});
test('MVP client uses text nodes and relative authenticated endpoints without browser credential storage',()=>{
 const app=read('mvp/client/app.mjs');assert.ok(app.includes('document.createTextNode'));assert.ok(app.includes("textContent=message"));
 assert.doesNotMatch(app,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|localStorage|sessionStorage|https?:\/\//);
 assert.match(read('mvp/server.mjs'),/default-src 'none'/);assert.match(read('mvp/server.mjs'),/HttpOnly; SameSite=Strict/);
});
test('database paths cannot overlap source and publication directories',()=>{
 for(const path of ['docs/test.sqlite','public/test.sqlite','mvp/client/test.sqlite','harness/test.sqlite','tests/test.sqlite'])assert.throws(()=>safeDataPath(resolve(root,path)),/source or publication/);
 assert.throws(()=>safeDataPath(':memory:'),/isolated SQLite/);
});
test('limits and networking cannot be disabled through test configuration',()=>{
 for(const limits of [{messages:0},{requests:Infinity},{login:1001},{ws:-1}])assert.throws(()=>createMVP({limits}),/Rate limits/);
 assert.throws(()=>createMVP({host:'0.0.0.0'}),/loopback/);assert.throws(()=>createMVP({externalApi:true}),/loopback/);
});
test('MVP CI has no deploy permissions, environment, external credentials or paid API calls',()=>{
 const workflow=read('.github/workflows/core-mvp.yml');assert.match(workflow,/feat\/promise-box-core-mvp-20261013/);assert.match(workflow,/mvp\/tests\/\*\.test\.mjs/);assert.doesNotMatch(workflow,/pages:\s*write|id-token:\s*write|environment:|secrets\.|deploy-pages|railway|upload-artifact/);
 const pkg=JSON.parse(read('mvp/package.json'));assert.equal(pkg.dependencies.ws,'8.22.0');assert.equal(Object.keys(pkg.dependencies).length,1);
});
