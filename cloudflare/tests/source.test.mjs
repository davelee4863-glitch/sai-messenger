import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {bundle} from '../build.mjs';
test('migration test preflight resolves pinned dependencies and syntax checks every Worker/test source',()=>{
 assert.equal(JSON.parse(readFileSync(new URL('../node_modules/miniflare/package.json',import.meta.url))).version,'4.20260730.0');
 assert.ok(createRequire(new URL('../../mvp/package.json',import.meta.url)).resolve('ws').includes('node_modules'));
 for(const folder of [new URL('../',import.meta.url),new URL('./',import.meta.url)])for(const name of readdirSync(folder).filter(n=>n.endsWith('.mjs')))execFileSync(process.execPath,['--check',fileURLToPath(new URL(name,folder))],{stdio:'pipe'});
});
test('UI assets are reused; Worker bundle excludes file SQLite/listen/ws dependencies and has no paid bindings',async()=>{
 const worker=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8'),runtime=readFileSync(new URL('../runtime.mjs',import.meta.url),'utf8');
 assert.match(worker,/MODE!==['"]local/);assert.match(runtime,/cf:false/);assert.match(runtime,/outboundService/);assert.match(runtime,/useSQLite:true/);assert.doesNotMatch(runtime,/r2Buckets|aiBinding|remoteProxy|accountId|apiToken/);
 const built=readFileSync(await bundle(),'utf8');assert.doesNotMatch(built,/from ["']node:(?:sqlite|fs|http|https)["']|from ["']ws["']/);
 assert.match(readFileSync(new URL('../../mvp/client/app.mjs',import.meta.url),'utf8'),/이대로 확정할까요\?/);
});
