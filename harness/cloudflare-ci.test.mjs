import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {discoverTests,validateCoverage,parseResult,runSuite} from './cloudflare-ci.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(t){const dir=mkdtempSync(resolve(tmpdir(),'pbx-ci-policy-'));for(const folder of ['harness','tests','mvp/tests','cloudflare/tests'])mkdirSync(resolve(dir,folder),{recursive:true});writeFileSync(resolve(dir,'tests/existing.test.mjs'),"import test from 'node:test';test('existing',()=>{});");t.after(()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir(),'pbx-ci-policy-')));rmSync(dir,{recursive:true,force:true});});return {dir,manifest:{schemaVersion:1,baselineSha:'a'.repeat(40),baselineExpectedCases:1,baselineFiles:['tests/existing.test.mjs'],manualSuites:[]}};}
const tap=(pass=1,fail=0,skip=0)=>`TAP version 13\n# tests ${pass+fail+skip}\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skip}\n# todo 0\n`;
test('policy: Cloudflare remote validation includes all UI and Node MVP regression suites',()=>{
 const manifest=JSON.parse(readFileSync(new URL('./cloudflare-test-suites.json',import.meta.url)));
 const contract=validateCoverage(root,manifest),workflow=readFileSync(new URL('../.github/workflows/cloudflare-isolation.yml',import.meta.url),'utf8');
 assert.match(workflow,/run: node harness\/cloudflare-ci\.mjs/);
 for(const path of ['tests/ui-state.test.mjs','tests/ui-static.test.mjs','tests/ui-qr.test.mjs','tests/ui-build.test.mjs','tests/ui-pages-environment.test.mjs'])assert.ok(contract.files.includes(path),path);
 assert.equal(contract.files.filter(path=>path.startsWith('mvp/tests/')).length,12);
 assert.equal(contract.baselineFiles.length,27);assert.deepEqual(contract.errors,[]);
 assert.match(workflow,/branches: \[feat\/promise-box-cloudflare-harness-fix-20261014\]/);assert.match(workflow,/contents: read/);assert.doesNotMatch(workflow,/secrets\.|wrangler\s+deploy|pages\s+deploy|railway\s+up/);
});
test('new nested isolation test files are automatically included',t=>{const {dir,manifest}=fixture(t);mkdirSync(resolve(dir,'harness/new'),{recursive:true});writeFileSync(resolve(dir,'harness/new/guard.test.mjs'),'// synthetic test source');assert.ok(validateCoverage(dir,manifest).files.includes('harness/new/guard.test.mjs'));});
test('missing baseline and requested file omissions fail coverage',t=>{const {dir,manifest}=fixture(t);assert.ok(validateCoverage(dir,manifest,[]).errors.length);manifest.baselineFiles.push('tests/missing.test.mjs');assert.ok(validateCoverage(dir,manifest).errors.some(e=>e.includes('Missing baseline')));});
test('zero-test, failed, skipped, cancelled, incomplete and inconsistent results cannot become PASS',()=>{
 for(const result of [{status:0,stdout:tap(0)},{status:1,stdout:tap(1,1)},{status:0,stdout:tap(1,0,1)},{status:0,stdout:''},{status:0,stdout:tap().replace('# tests 1','# tests 2')},{status:null,error:Error('Synthetic launch error')},{status:0,signal:'SIGTERM',stdout:tap()}])assert.equal(parseResult(result).status,'FAIL');
 assert.equal(parseResult({status:0,stdout:tap()}).status,'PASS');
});
test('new and existing counts remain separate and failed evidence is retained',t=>{const {dir,manifest}=fixture(t);writeFileSync(resolve(dir,'harness/new.test.mjs'),'// synthetic new file');const output=resolve(dir,'evidence');const result=runSuite(dir,{manifest,output,execute:file=>({status:file.startsWith('harness')?1:0,stdout:file.startsWith('harness')?tap(0,1):tap()})});assert.equal(result.status,'FAIL');assert.equal(result.existing.pass,1);assert.equal(result.new.fail,1);assert.equal(JSON.parse(readFileSync(resolve(output,'summary.json'))).status,'FAIL');});
test('dropped baseline case counts fail even when the file reports PASS',t=>{const {dir,manifest}=fixture(t);manifest.baselineExpectedCases=2;assert.equal(runSuite(dir,{manifest,execute:()=>({status:0,stdout:tap()})}).status,'FAIL');});
test('manual browser classification is explicit NOT_RUN and source changes invalidate it',t=>{const {dir,manifest}=fixture(t);const path='tests/browser.test.mjs';writeFileSync(resolve(dir,path),'// manual browser procedure');manifest.manualSuites=[{path,status:'NOT_RUN',reason:'Browser only',sha256:createHash('sha256').update(readFileSync(resolve(dir,path))).digest('hex')}];assert.equal(validateCoverage(dir,manifest).manualSuites[0].status,'NOT_RUN');writeFileSync(resolve(dir,path),'changed');assert.throws(()=>validateCoverage(dir,manifest),/requires review/);});
test('real skipped Node subprocess is classified NOT_RUN rather than PASS',t=>{const {dir}=fixture(t);writeFileSync(resolve(dir,'tests/skip.test.mjs'),"import test from 'node:test';test.skip('synthetic skipped',()=>{});");const run=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/skip.test.mjs'],{cwd:dir,encoding:'utf8',windowsHide:true});const parsed=parseResult(run);assert.equal(parsed.status,'FAIL');assert.equal(parsed.notRun,1);});
