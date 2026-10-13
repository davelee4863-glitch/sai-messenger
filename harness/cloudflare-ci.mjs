import {readdirSync, readFileSync, lstatSync, realpathSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync, execFileSync} from 'node:child_process';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEST_ROOTS = ['harness', 'tests', 'mvp/tests', 'cloudflare/tests'];
const MANUAL_PATHS = new Set(['tests/ui-browser-regression.test.mjs']);
export function childEnvironment() { const env={...process.env};delete env.NODE_TEST_CONTEXT;return env; }
const testName = /\.(?:test|spec)\.(?:mjs|js|cjs|ts)$/;
const safePath = path => typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.startsWith('/') && !/^[a-z]:/i.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
export function discoverTests(root) {
  const base = realpathSync(root), found = [];
  function walk(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1) || !realpathSync(path).startsWith(base + sep)) throw Error('Linked or external test path');
    if (info.isDirectory()) for (const name of readdirSync(path)) walk(resolve(path, name));
    else if (info.isFile() && testName.test(path)) found.push(relative(base, path).split(sep).join('/'));
  }
  for (const folder of TEST_ROOTS) walk(resolve(base, folder));
  if (existsSync(resolve(base,'.git'))) {
    const tracked=execFileSync('git',['ls-files','-z'],{cwd:base,encoding:'utf8'}).split('\0').filter(path=>testName.test(path));
    for(const path of tracked) if(!found.includes(path)) { if(!safePath(path))throw Error('Unsafe tracked test path');walk(resolve(base,path)); }
  }
  return [...new Set(found)].sort();
}
export function validateCoverage(root, manifest, requested) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.baselineSha) || !Number.isSafeInteger(manifest.baselineExpectedCases) || manifest.baselineExpectedCases < 1 || !Array.isArray(manifest.baselineFiles) || !manifest.baselineFiles.length || !Array.isArray(manifest.manualSuites)) throw Error('Invalid CI suite manifest');
  const baseline = manifest.baselineFiles;
  if (baseline.some(path=>!safePath(path)||!testName.test(path)) || new Set(baseline).size !== baseline.length) throw Error('Invalid or duplicate baseline tests');
  const discovered = discoverTests(root), manual = new Set();
  for (const item of manifest.manualSuites) {
    if (!item || !MANUAL_PATHS.has(item.path) || !safePath(item.path) || !testName.test(item.path) || item.status !== 'NOT_RUN' || typeof item.reason !== 'string' || !item.reason.trim() || !/^[a-f0-9]{64}$/.test(item.sha256) || manual.has(item.path) || baseline.includes(item.path) || !discovered.includes(item.path)) throw Error('Invalid manual test classification');
    if (createHash('sha256').update(readFileSync(resolve(root,item.path),'utf8').replace(/\r\n/g,'\n')).digest('hex') !== item.sha256) throw Error('Manual test classification requires review after source changes');
    manual.add(item.path);
  }
  const files = discovered.filter(path=>!manual.has(path));
  for (const path of baseline) if (!files.includes(path)) errors.push('Missing baseline test: '+path);
  if (requested !== undefined && (!Array.isArray(requested) || new Set(requested).size !== requested.length || requested.length !== files.length || files.some(path=>!requested.includes(path)))) errors.push('Requested execution omits or adds test files');
  return {files,baselineFiles:baseline,manualSuites:manifest.manualSuites,errors};
}
export function parseResult(result, {file}={}) {
  if (result.error || result.signal || !Number.isInteger(result.status)) return {status:'FAIL',pass:0,fail:0,notRun:1,reason:'Execution error or incomplete process'};
  const counts = {};
  for (const key of ['tests','pass','fail','cancelled','skipped','todo']) {
    const lines = [...String(result.stdout).matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];
    if (!lines.length) return {status:'FAIL',pass:0,fail:0,notRun:1,reason:'Missing TAP completion totals'};
    counts[key] = Number(lines.at(-1)[1]);
    if (!Number.isSafeInteger(counts[key]) || counts[key] > 1000000) return {status:'FAIL',pass:0,fail:0,notRun:1,reason:'Invalid or unbounded TAP count'};
  }
  if (counts.tests === 0 || counts.pass+counts.fail+counts.cancelled+counts.skipped+counts.todo !== counts.tests) return {status:'FAIL',pass:0,fail:0,notRun:1,reason:'Zero tests or inconsistent TAP totals'};
  if (file) {
    const names=[...String(result.stdout).matchAll(/^# Subtest: (.+)\r?$/gm)].map(match=>match[1].trim().replace(/\\+/g,'/'));
    if (!names.length || (counts.tests===1 && names.length===1 && (names[0]===file || names[0].endsWith('/'+file) || names[0].split('/').at(-1)===file.split('/').at(-1)))) return {status:'FAIL',pass:0,fail:0,notRun:1,reason:'No registered test cases; Node file placeholder is not a test PASS'};
  }
  const notRun = counts.cancelled+counts.skipped+counts.todo;
  return {status:result.status===0&&counts.fail===0&&notRun===0?'PASS':'FAIL',pass:counts.pass,fail:counts.fail,notRun,tests:counts.tests,exitCode:result.status,reason:result.status!==0?'Nonzero test exit':notRun?'Skipped/cancelled/todo tests are not PASS':undefined};
}
export function runSuite(root, {manifest,output,execute}={}) {
  const contract = validateCoverage(root,manifest);
  if (contract.errors.length) throw Error(contract.errors.join('\n'));
  const results = [], baseline = {pass:0,fail:0,notRun:0}, added = {pass:0,fail:0,notRun:0};
  if (output) mkdirSync(output,{recursive:true});
  for (const [index,file] of contract.files.entries()) {
    const run = execute ? execute(file) : spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',file],{cwd:root,env:childEnvironment(),encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
    const result = {...parseResult(run,{file}),file,group:contract.baselineFiles.includes(file)?'existing':'new'};
    results.push(result);
    const group = result.group==='existing'?baseline:added;
    for (const key of ['pass','fail','notRun']) group[key] += result[key];
    if (output) writeFileSync(resolve(output,String(index+1).padStart(2,'0')+'.tap'),String(run.stdout||'')+'\n'+String(run.stderr||''));
    console.log(JSON.stringify(result));
  }
  const baselineCountMatches = baseline.pass+baseline.fail+baseline.notRun === manifest.baselineExpectedCases;
  const summary = {scope:'automated Node tests only',status:results.every(r=>r.status==='PASS')&&baselineCountMatches?'PASS':'FAIL',baselineCountMatches,existing:baseline,new:added,filesDiscovered:contract.files.length,filesExecuted:results.length,manualSuites:contract.manualSuites,results,cloudDeploymentAuthorized:false,liveInventoryVerified:false};
  if (output) writeFileSync(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output=resolve(ROOT,'cloudflare/.local/ci');
  try {
    const manifest=JSON.parse(readFileSync(resolve(ROOT,'harness/cloudflare-test-suites.json')));
    const summary=runSuite(ROOT,{manifest,output});
    console.log(JSON.stringify({status:summary.status,existing:summary.existing,new:summary.new,manualSuites:summary.manualSuites}));
    process.exitCode=summary.status==='PASS'?0:1;
  } catch(error) {
    mkdirSync(output,{recursive:true});
    const report={status:'FAIL',executionError:error.message,cloudDeploymentAuthorized:false,liveInventoryVerified:false};
    writeFileSync(resolve(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
    console.error(JSON.stringify(report));process.exitCode=1;
  }
}
