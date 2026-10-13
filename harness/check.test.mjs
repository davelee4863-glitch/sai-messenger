import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync} from 'node:fs';
import {resolve, dirname, join, relative, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {validate, blockers, containsSecret, sensitivePath} from './check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const date = '2026-10-13T00:00:00.000Z';
const risk = {id:'SAI-R999', priority:'P0', status:'OPEN', title:'synthetic risk', evidence:'synthetic reproduction', prevention:'synthetic guard', regressionTest:'PENDING'};
const incident = {id:'SAI-INC-20261013-99', loggedAt:date, occurredAt:date, recordType:'SYNTHETIC', severity:'HIGH', status:'OPEN', symptom:'synthetic symptom', rootCause:'UNCONFIRMED', resolution:'PENDING', prevention:'synthetic guard', regressionTest:'PENDING', evidence:'synthetic reproduction'};
const r = risks => ({schemaVersion:1, risks});
const i = incidents => ({schemaVersion:1, incidents});
const completed = {status:'VERIFIED', regressionTest:'harness/check.test.mjs', regressionResult:'PASS', regressionEvidence:'node --test harness/check.test.mjs; synthetic run 99; exit 0', resolvedBy:'synthetic implementer', reviewedBy:'synthetic reviewer', verificationEvidence:'synthetic reviewer independently reran run 99', verifiedAt:date, verificationCommit:'a'.repeat(40)};
const doneRisk = {...risk, ...completed};
const doneIncident = {...incident, ...completed, rootCause:'synthetic parser bug', resolution:'synthetic parser fix'};

test('valid open records', () => assert.deepEqual(validate(r([risk]), i([incident])), []));
test('duplicate risk rejected', () => assert.match(validate(r([risk,risk]), i([])).join(' '), /duplicate/));
test('duplicate incident rejected', () => assert.match(validate(r([]), i([incident,incident])).join(' '), /duplicate/));
test('premature VERIFIED rejected', () => assert.ok(validate(r([{...risk,status:'VERIFIED'}]), i([{...incident,status:'VERIFIED'}])).length >= 2));
test('P0 and HIGH block release', () => assert.deepEqual(blockers(r([risk]), i([incident])), [risk.id,incident.id]));
test('unresolved P1 is tracked but does not alone block', () => assert.deepEqual(blockers(r([{...risk,priority:'P1'}]), i([])), []));
test('complete synthetic evidence satisfies structural schema', () => assert.deepEqual(validate(r([doneRisk]), i([doneIncident])), []));

for (const field of ['loggedAt','occurredAt','recordType','symptom','rootCause','resolution','prevention','regressionTest','evidence']) {
 test('missing incident field rejected: '+field, () => {
  const record = {...incident}; delete record[field];
  assert.ok(validate(r([]),i([record])).length > 0);
 });
}
for (const value of ['not-a-date','2026-02-30T00:00:00.000Z','2026-10-13','2026-10-13T00:00:00Z']) {
 test('invalid occurrence timestamp rejected: '+value, () => assert.match(validate(r([]),i([{...incident,occurredAt:value}])).join(' '), /timestamp/));
}
for (const [name, patch] of [
 ['regression PENDING',{regressionTest:'PENDING'}],
 ['README is not a test',{regressionTest:'harness/README.md'}],
 ['directory is not a test',{regressionTest:'harness'}],
 ['outside repository',{regressionTest:'../outside.test.mjs'}],
 ['absolute path',{regressionTest:resolve(root,'harness/check.test.mjs')}],
 ['regression NOT_RUN',{regressionResult:'NOT_RUN'}],
 ['regression FAIL',{regressionResult:'FAIL'}],
 ['regression evidence missing',{regressionEvidence:''}],
 ['review evidence NOT_RUN',{verificationEvidence:'NOT_RUN'}],
 ['review evidence whitespace',{verificationEvidence:'   '}],
 ['reviewer whitespace',{reviewedBy:'   '}],
 ['self review normalized',{reviewedBy:' SYNTHETIC IMPLEMENTER '}],
 ['implementer missing',{resolvedBy:undefined}],
 ['reviewer missing',{reviewedBy:undefined}],
 ['review commit missing',{verificationCommit:undefined}],
 ['review timestamp invalid',{verifiedAt:'not-a-date'}]
]) {
 test('VERIFIED rejected: '+name, () => {
  assert.ok(validate(r([{...doneRisk,...patch}]), i([])).length > 0);
  assert.ok(validate(r([]), i([{...doneIncident,...patch}])).length > 0);
 });
}
test('unconfirmed cause with whitespace rejected', () => assert.match(validate(r([]),i([{...doneIncident,rootCause:' UNCONFIRMED '}])).join(' '), /confirmed cause/));
test('pending resolution rejected', () => assert.match(validate(r([]),i([{...doneIncident,resolution:'PENDING'}])).join(' '), /resolution/));
test('invalid VERIFIED P0 still blocks release helper', () => assert.ok(blockers(r([{...risk,status:'VERIFIED',regressionTest:'harness/README.md',reviewedBy:'same',verificationEvidence:'NOT_RUN'}]),i([])).length > 0));
for (const record of [null,42,'synthetic',[]]) {
 test('malformed records fail closed: '+JSON.stringify(record), () => assert.ok(validate(r([record]),i([record])).length >= 2));
}
test('malformed inventories block release without crash', () => assert.ok(blockers(null,null).length > 0));

const credentialCases = [
 ['OpenAI key','sk-proj-synthetic-never-live-123456'],
 ['Bearer','Bearer synthetic-never-live-123456'],
 ['assignment','password=synthetic-never-live'],
 ['JSON password','{"password":"synthetic-never-live"}'],
 ['JSON API key','{"api_key":"synthetic-never-live"}'],
 ['Basic','Authorization: Basic c3ludGhldGljOnN5bnRoZXRpYw=='],
 ['credential URL','https://synthetic:synthetic@example.invalid/'],
 ['private key','-----BEGIN PRIVATE KEY----- synthetic -----END PRIVATE KEY-----']
];
for (const [label,value] of credentialCases) {
 test('credential rejected in direct inventory: '+label, () => {
  assert.equal(containsSecret(value),true);
  assert.match(validate(r([]),i([{...incident,symptom:value}])).join(' '), /credential/i);
 });
}
for (const path of ['.env','.env.production','.ENV.production','private.PEM','private.key','id_rsa','id_ed25519','id_dsa','service-account.json','credentials.json','secrets/credentials.production.json']) {
 test('sensitive tracked filename detected: '+path, () => assert.equal(sensitivePath(path),true));
}
test('example filenames allowed', () => {
 assert.equal(sensitivePath('.env.example'),false);
 assert.equal(sensitivePath('harness/.env.sample'),false);
});

function fixture(action) {
 const dir = mkdtempSync(join(tmpdir(),'sai-harness-test-'));
 try {
  cpSync(resolve(root,'harness'),join(dir,'harness'),{recursive:true});
  mkdirSync(join(dir,'public')); mkdirSync(join(dir,'.github/workflows'),{recursive:true});
  cpSync(resolve(root,'.github/workflows/harness.yml'),join(dir,'.github/workflows/harness.yml'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({scripts:{start:'node server.js'}}));
  writeFileSync(join(dir,'server.js'),'const synthetic = true;\n');
  writeFileSync(join(dir,'public/index.html'),'<script>const synthetic = true;</script>\n');
  writeFileSync(join(dir,'harness/known-risks.json'),JSON.stringify(r([risk])));
  writeFileSync(join(dir,'harness/incidents.json'),JSON.stringify(i([])));
  execFileSync('git',['init','--quiet'],{cwd:dir,stdio:'pipe'});
  execFileSync('git',['add','.'],{cwd:dir,stdio:'pipe'});
  return action(dir);
 } finally {
  const part = relative(tmpdir(),dir);
  if (isAbsolute(part) || part.startsWith('..') || !part.startsWith('sai-harness-test-')) throw new Error('Unsafe fixture cleanup target');
  rmSync(dir,{recursive:true,force:true});
 }
}
const run = (dir,script,args=[]) => spawnSync(process.execPath,[script,...args],{cwd:dir,encoding:'utf8'});
const blocked = (result,reason) => {
 assert.equal(result.signal,null);
 assert.equal(result.error,undefined);
 assert.ok([1,2].includes(result.status));
 assert.match(result.stderr,reason);
 assert.doesNotMatch(result.stderr,/node:internal|ERR_MODULE_NOT_FOUND/);
};
const recordArgs = ['--id',incident.id,'--severity','HIGH','--occurred-at',date,'--record-type','SYNTHETIC','--symptom','synthetic failure','--cause','UNCONFIRMED','--resolution','PENDING','--prevention','synthetic guard','--test','PENDING','--evidence','synthetic reproduction'];

test('CLI duplicate rejected without altering the journal', () => fixture(dir => {
 assert.equal(run(dir,'harness/record-incident.mjs',recordArgs).status,0);
 const path = join(dir,'harness/incidents.json');
 const before = readFileSync(path,'utf8');
 blocked(run(dir,'harness/record-incident.mjs',recordArgs),/duplicate incident ID/);
 assert.equal(readFileSync(path,'utf8'),before);
 const record = JSON.parse(before).incidents[0];
 assert.equal(record.recordType,'SYNTHETIC'); assert.equal(record.occurredAt,date);
 assert.equal(record.resolution,'PENDING');
}));
test('CLI missing new fields and duplicate options rejected', () => fixture(dir => {
 for (const field of ['occurred-at','resolution']) {
  const args = [...recordArgs]; args.splice(args.indexOf('--'+field),2);
  blocked(run(dir,'harness/record-incident.mjs',args),/required/i);
 }
 blocked(run(dir,'harness/record-incident.mjs',[...recordArgs,'--id',incident.id]),/unique/);
 assert.deepEqual(JSON.parse(readFileSync(join(dir,'harness/incidents.json'))).incidents,[]);
}));
test('CLI credential attempts rejected without writing or echoing credentials', () => fixture(dir => {
 const path = join(dir,'harness/incidents.json'), before = readFileSync(path,'utf8');
 for (const [,value] of credentialCases) {
  const args = [...recordArgs]; args[args.indexOf('--symptom')+1] = value;
  const result = run(dir,'harness/record-incident.mjs',args);
  blocked(result,/Potential secret/); assert.equal(result.stderr.includes(value),false);
  assert.equal(readFileSync(path,'utf8'),before);
 }
}));
test('release CLI blocks unresolved P0 and forged verification', () => fixture(dir => {
 blocked(run(dir,'harness/check.mjs',['--release']),/RELEASE BLOCKED: SAI-R999/);
 writeFileSync(join(dir,'harness/known-risks.json'),JSON.stringify(r([{...risk,status:'VERIFIED',regressionTest:'harness/README.md',reviewedBy:'same',verificationEvidence:'NOT_RUN'}])));
 blocked(run(dir,'harness/check.mjs',['--release']),/requires.*(?:test file|reviewer|evidence)/);
}));
test('preflight rejects a directly edited credential inventory', () => fixture(dir => {
 writeFileSync(join(dir,'harness/incidents.json'),JSON.stringify(i([{...incident,symptom:credentialCases[3][1]}])));
 const result = run(dir,'harness/check.mjs');
 blocked(result,/Potential credential/); assert.equal(result.stderr.includes('synthetic-never-live'),false);
}));
test('preflight rejects malformed JSON without an unhandled crash', () => fixture(dir => {
 writeFileSync(join(dir,'harness/incidents.json'),'{not-json');
 blocked(run(dir,'harness/check.mjs'),/Inventory JSON unreadable or malformed/);
}));
test('preflight detects case-varied sensitive Git paths', () => fixture(dir => {
 writeFileSync(join(dir,'.ENV.production'),'SYNTHETIC_ONLY=redacted');
 execFileSync('git',['add','--','.ENV.production'],{cwd:dir,stdio:'pipe'});
 blocked(run(dir,'harness/check.mjs'),/Tracked sensitive filename/);
}));
test('preflight detects server, inline, external and harness JS syntax errors', () => {
 for (const [path,source] of [
  ['server.js','const = ;'],
  ['public/index.html','<script>const = ;</script>'],
  ['public/external.js','const = ;'],
  ['harness/record-incident.mjs','const = ;']
 ]) fixture(dir => {
  writeFileSync(join(dir,path),source);
  execFileSync('git',['add','--',path],{cwd:dir,stdio:'pipe'});
  blocked(run(dir,'harness/check.mjs'),/Syntax\/config|syntax/);
 });
});
