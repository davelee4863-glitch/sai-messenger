import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {configuration} from '../config.mjs';
import {bundle} from '../build.mjs';
import {runtime,maintenance} from '../runtime.mjs';
test('invalid numeric budget and session settings fail closed before opening persistent storage',async()=>{
 for(const key of ['REQUEST_BUDGET','READ_BUDGET','WRITE_BUDGET','SESSION_IDLE_MS','SESSION_ABSOLUTE_MS'])for(const value of ['not-a-number','NaN','Infinity','0','-1','1.5','999999999999999999999'])assert.throws(()=>configuration({[key]:value}),/Invalid local/);
 assert.throws(()=>configuration({QUOTA_PAUSED:'maybe'}));assert.throws(()=>configuration({D1_FAILURE:'maybe'}));
 assert.equal(configuration({SESSION_IDLE_MS:'1'}).SESSION_IDLE_MS,1);assert.equal(configuration({}).REQUEST_BUDGET,80000);
 await assert.rejects(runtime({persist:resolve(tmpdir(),'promise-box-cf-invalid-config-unused'),bindings:{WRITE_BUDGET:'not-a-number'}}),/Invalid local/);
});
test('concurrent local emulators cannot share persistence; original owner remains usable and restart releases ownership',async t=>{
 const persist=await mkdtemp(resolve(tmpdir(),'promise-box-cf-'));let mf=await runtime({persist});t.after(async()=>{await mf.dispose();if(!resolve(persist).startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup rejected');await rm(persist,{recursive:true,force:true});});await assert.rejects(runtime({persist}),/writer lock exists/);
 assert.equal((await mf.dispatchFetch('http://localhost:8787/health')).status,200);await mf.dispose();mf=await runtime({persist});assert.equal((await mf.dispatchFetch('http://localhost:8787/health')).status,200);
});
test('parallel builds return immutable complete Worker strings, never a partially-written shared file',async()=>{
 const outputs=await Promise.all(Array.from({length:8},()=>bundle()));assert.equal(new Set(outputs).size,1);assert.ok(outputs.every(value=>value.includes('Workspace')&&value.includes('export {')));
});
test('local runtime works from an unrelated working directory with its own isolated persistence',async t=>{
 const dir=await mkdtemp(resolve(tmpdir(),'promise-box-cf-'));t.after(async()=>{if(!resolve(dir).startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup rejected');await rm(dir,{recursive:true,force:true});});
 const code=`import {runtime} from ${JSON.stringify(new URL('../runtime.mjs',import.meta.url).href)}; const mf=await runtime({persist:${JSON.stringify(resolve(dir,'state'))}});try{const health=await mf.dispatchFetch('http://localhost:8787/health');const page=await mf.dispatchFetch('http://localhost:8787/');if(health.status!==200||page.status!==200||!(await page.text()).includes('약속함'))throw new Error('Cross-directory runtime failed');console.log('CWD_ISOLATION_PASS');}finally{await mf.dispose();}`;
 assert.match(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8',timeout:30000}),/CWD_ISOLATION_PASS/);
});
