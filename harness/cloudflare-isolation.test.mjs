import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {APP_ID, NAMESPACE, BINDINGS} from '../cloudflare/isolation-identity.mjs';
import {LOCAL_PLAN, KINDS, MAX_INVENTORY_AGE_MS, validateLocalPlan, validateIsolation, validateRollback, compareProtectedResources, fingerprint} from './cloudflare-isolation.mjs';
import {preflight} from './cloudflare-preflight.mjs';

const NOW = Date.parse('2026-10-13T14:30:00.000Z');
const clone = value => structuredClone(value);
const foreignId = kind => 'synthetic:existing-app:' + kind;
function relationships(kind) {
  if (kind === 'workers') return {targetIds:['durableObjects','d1','r2','kv','queues','secrets','environmentVariables'].map(foreignId)};
  if (['d1','r2','kv','queues'].includes(kind)) return {workerIds:[foreignId('workers')],binding:'FOREIGN_'+kind.toUpperCase()};
  if (kind === 'durableObjects') return {workerId:foreignId('workers'),className:'ForeignWorkspace',scriptName:'existing-app-workers',binding:'FOREIGN_DO'};
  if (['secrets','environmentVariables','routes','domains'].includes(kind)) return {workerId:foreignId('workers')};
  if (['migrations','backups'].includes(kind)) return {targetId:foreignId('d1')};
  if (kind === 'logs') return {targetId:foreignId('workers')};
  if (kind === 'permissions') return {scope:'resource',role:'editor',principalId:'synthetic:foreign-principal',targetIds:[foreignId('workers'),foreignId('d1')]};
  return {};
}
function rejected(errors, code) { assert.ok(errors.includes(code) || errors.some(error=>error.startsWith('ISOLATION_INVENTORY_')), code); }
function inventory({owned = false, now = NOW} = {}) {
  return {schemaVersion: 1, accountId: 'synthetic-account', capturedAt: new Date(now).toISOString(), source: 'synthetic', paginationComplete: true,
    categoriesComplete: Object.fromEntries(KINDS.map(kind => [kind, true])),
    resources: Object.fromEntries(KINDS.map(kind => [kind, [ ...(owned ? clone(LOCAL_PLAN.resources[kind]) : []), {id: `synthetic:existing-app:${kind}`, name: `existing-app-${kind}`, owner: 'synthetic:existing-app', namespace: 'existing-app', ...relationships(kind)}]]))};
}
const validate = (plan, fixture) => validateIsolation(plan, fixture, {now: NOW});
const rollback = () => ({schemaVersion: 1, appId: APP_ID, namespace: NAMESPACE, environment: 'local', steps: [{action: 'restore-backup', targetId: LOCAL_PLAN.resources.durableObjects[0].id, backupId: LOCAL_PLAN.resources.backups[0].id}, {action: 'rebuild-projection', targetId: LOCAL_PLAN.resources.d1[0].id}]});

test('checked-in local plan uses immutable app ownership and dedicated bindings', () => {
  const plan = JSON.parse(readFileSync(new URL('../cloudflare/isolation-plan.json', import.meta.url)));
  assert.deepEqual(validateLocalPlan(plan), []);
  assert.deepEqual(validate(plan, inventory()), []);
  assert.deepEqual(validate(plan, inventory({owned: true})), []);
  assert.equal(plan.deploymentAuthorized, false);
  assert.equal(plan.liveInventoryVerified, false);
  assert.ok(plan.bindings.every(binding => binding.name.startsWith('PBX_CF_')));
  assert.deepEqual(validateLocalPlan(JSON.parse(JSON.stringify(plan))), []);
});

for (const kind of KINDS) {
  test(`${kind}: injecting another app resource into the plan fails closed`, () => {
    const plan = clone(LOCAL_PLAN), fixture = inventory();
    plan.resources[kind].push(clone(fixture.resources[kind][0]));
    assert.ok(validate(plan, fixture).some(error => error === 'ISOLATION_PLAN_IMMUTABLE:resources'));
  });
  test(`${kind}: foreign ownership inside the reserved namespace fails closed`, () => {
    const fixture = inventory();
    fixture.resources[kind][0].namespace = NAMESPACE;
    rejected(validate(LOCAL_PLAN, fixture), `ISOLATION_FOREIGN_NAMESPACE:${kind}`);
  });
  test(`${kind}: incomplete category inventory fails closed`, () => {
    const fixture = inventory();
    fixture.categoriesComplete[kind] = false;
    assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_INCOMPLETE'));
    delete fixture.resources[kind];
    assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_CATEGORIES'));
  });
}
for (const kind of KINDS.filter(kind => LOCAL_PLAN.resources[kind].length)) {
  test(`${kind}: both resource ID reuse and name reuse block foreign app bindings`, () => {
    for (const field of ['id', 'name']) {
      const fixture = inventory(), owned = LOCAL_PLAN.resources[kind][0];
      fixture.resources[kind][0][field] = owned[field];
      if (kind === 'environmentVariables' && field === 'name') fixture.resources[kind][0].workerId = owned.workerId;
      const errors = validate(LOCAL_PLAN, fixture);
      rejected(errors, `ISOLATION_RESOURCE_COLLISION:${kind}`);
    }
  });
}

test('missing, unreadable, malformed or partial inventories do not approve local isolation', () => {
  for (const value of [undefined, null, {}, [], 'PASS', {...inventory(), resources: []}, {...inventory(), categoriesComplete: {}}]) assert.ok(validate(LOCAL_PLAN, value).length);
  for (const change of [fixture => fixture.paginationComplete = false, fixture => fixture.categoriesComplete.unknown = true, fixture => fixture.resources.unknown = [], fixture => fixture.resources.kv = null, fixture => fixture.accountId = '', fixture => fixture.source = 'live-verified', fixture => fixture.token = 'REDACTED']) {
    const fixture = inventory(); change(fixture); assert.ok(validate(LOCAL_PLAN, fixture).length);
  }
});

test('stale, future and noncanonical timestamps fail closed at the freshness boundary', () => {
  assert.deepEqual(validate(LOCAL_PLAN, inventory({now: NOW - MAX_INVENTORY_AGE_MS})), []);
  for (const captured of [NOW - MAX_INVENTORY_AGE_MS - 1, NOW + 1]) assert.ok(validate(LOCAL_PLAN, inventory({now: captured})).includes('ISOLATION_INVENTORY_STALE_OR_FUTURE'));
  for (const date of ['2026-02-30T14:30:00.000Z', 'today', '2026-10-13T14:30:00Z', null]) {
    const fixture = inventory(); fixture.capturedAt = date; assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_STALE_OR_FUTURE'));
  }
  assert.ok(validateIsolation(LOCAL_PLAN, inventory(), {now: NaN}).length);
});

test('duplicates, ambiguous ownership, scoped variables and secret values fail closed', () => {
  for (const change of [fixture => fixture.resources.d1.push(clone(fixture.resources.d1[0])), fixture => fixture.resources.d1[0].owner = '', fixture => delete fixture.resources.secrets[0].workerId, fixture => fixture.resources.secrets[0].value = 'must-never-export', fixture => fixture.resources.permissions[0].scope = '*', fixture => fixture.resources.d1[0].name += ' ']) {
    const fixture = inventory(); change(fixture); assert.ok(validate(LOCAL_PLAN, fixture).length);
  }
});

test('direct API rejects inherited records, hidden values, symbols, getters, sparse arrays and cyclic data', () => {
  for (const change of [
    value => value.resources.d1[0] = Object.create(value.resources.d1[0]),
    value => value.resources.d1[0][Symbol('unknown')] = 'foreign',
    value => Object.defineProperty(value.resources.secrets[0], 'value', {value: 'hidden-secret'}),
    value => Object.defineProperty(value.resources.d1[0], 'name', {enumerable: true, get() { throw new Error('Getter must never execute'); }}),
    value => delete value.resources.d1[0],
    value => value.resources.d1.extra = 'foreign',
    value => { const array = Array(1); array['4294967295'] = 'foreign'; value.resources.permissions[0].targetIds = array; },
    value => value.resources.d1[0].cycle = value,
  ]) {
    const fixture = inventory(); change(fixture);
    assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_NON_JSON_DATA'));
  }
  const plan = clone(LOCAL_PLAN); Object.defineProperty(plan, 'hidden', {value: true}); assert.ok(validateLocalPlan(plan).length);
  const value = rollback(); value.steps[0][Symbol('foreign')] = 'foreign'; assert.ok(validateRollback(LOCAL_PLAN, inventory(), value, {now: NOW}).includes('ISOLATION_ROLLBACK_INVALID'));
});

test('foreign binding aliases and DO script references are rejected, including owned-looking IDs', () => {
  const fixture = inventory({owned: true});
  fixture.resources.d1.at(-1).binding = BINDINGS.metadata;
  fixture.resources.durableObjects.at(-1).scriptName = LOCAL_PLAN.resources.workers[0].name;
  rejected(validate(LOCAL_PLAN, fixture), 'ISOLATION_FOREIGN_BINDING:d1');
  rejected(validate(LOCAL_PLAN, fixture), 'ISOLATION_FOREIGN_WORKER_REFERENCE:durableObjects');
  const forged = inventory({owned: true}); forged.resources.d1[0].id = 'foreign-database-id';
  assert.ok(validate(LOCAL_PLAN, forged).some(error => error === 'ISOLATION_RESOURCE_COLLISION:d1' || error === 'ISOLATION_INVENTORY_REFERENCE_UNKNOWN:migrations'));
});

test('same variable names on another worker are separate; replacing scoped ownership blocks', () => {
  const fixture = inventory(); fixture.resources.environmentVariables[0].name = 'MODE';
  assert.deepEqual(validate(LOCAL_PLAN, fixture), []);
  fixture.resources.workers.push(clone(LOCAL_PLAN.resources.workers[0]));
  fixture.resources.environmentVariables[0].workerId = LOCAL_PLAN.resources.workers[0].id;
  rejected(validate(LOCAL_PLAN, fixture), 'ISOLATION_RESOURCE_COLLISION:environmentVariables');
});

test('foreign resources cannot reference an owned worker, storage, backup or permission target indirectly', () => {
  for (const kind of KINDS) for (const key of ['targetId', 'targetIds']) {
    const fixture = inventory({owned: true}), id = LOCAL_PLAN.resources.durableObjects[0].id;
    fixture.resources[kind].at(-1)[key] = key === 'targetIds' ? [id] : id;
    rejected(validate(LOCAL_PLAN, fixture), `ISOLATION_FOREIGN_RESOURCE_REFERENCE:${kind}`);
  }
  for (const kind of ['secrets', 'environmentVariables']) {
    const fixture = inventory({owned: true}); fixture.resources[kind].at(-1).workerId = LOCAL_PLAN.resources.workers[0].id;
    rejected(validate(LOCAL_PLAN, fixture), `ISOLATION_FOREIGN_RESOURCE_REFERENCE:${kind}`);
  }
  const fixture = inventory({owned: true}); fixture.resources.durableObjects.at(-1).owner = APP_ID; fixture.resources.durableObjects.at(-1).scriptName = LOCAL_PLAN.resources.workers[0].name;
  rejected(validate(LOCAL_PLAN, fixture), 'ISOLATION_FOREIGN_WORKER_REFERENCE:durableObjects');
});

test('complete inventory must resolve every supplied resource link and reject wildcard permission targets', () => {
  for (const change of [value => value.resources.secrets[0].workerId = 'missing-worker', value => value.resources.environmentVariables[0].workerId = 'missing-worker', value => value.resources.backups[0].targetId = 'missing-database', value => value.resources.permissions[0].targetIds = ['*'], value => value.resources.durableObjects[0].scriptName = 'missing-script']) {
    const fixture = inventory(); change(fixture); assert.ok(validate(LOCAL_PLAN, fixture).some(error => error.startsWith('ISOLATION_INVENTORY_')));
  }
});

test('wildcard identities fail even when permissions reference a wildcard resource present in inventory', () => {
  for (const id of ['*', 'prefix*', 'resource?']) {
    const fixture = inventory(); fixture.resources.workers[0].id = id;
    for (const kind of ['secrets', 'environmentVariables']) fixture.resources[kind][0].workerId = id;
    fixture.resources.permissions[0].targetIds = [id];
    assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_WILDCARD_IDENTIFIER:permissions'));
  }
});

test('generic references cannot resolve ambiguous IDs shared between different resource categories', () => {
  const fixture = inventory(); fixture.resources.d1[0].id = fixture.resources.workers[0].id;
  fixture.resources.permissions[0].targetIds = [fixture.resources.workers[0].id];
  assert.ok(validate(LOCAL_PLAN, fixture).includes('ISOLATION_INVENTORY_AMBIGUOUS_RESOURCE_ID'));
});

test('environment override, preview IDs, unknown bindings and broad permissions cannot relax immutable plan', () => {
  for (const change of [plan => plan.environment = 'production', plan => plan.execution = 'deployment', plan => plan.deploymentAuthorized = true, plan => plan.liveInventoryVerified = true, plan => plan.env = {preview: {}}, plan => plan.resources.d1[0].previewId = 'foreign-preview-id', plan => plan.bindings.push({name: 'OTHER', kind: 'kv', targetId: 'foreign-kv'}), plan => plan.resources.permissions.push({scope: '*'}), plan => plan.rollback.targetIds.push('*')]) {
    const plan = clone(LOCAL_PLAN); change(plan); assert.ok(validate(plan, inventory()).length);
  }
});

test('synthetic fixture PASS and a claimed read-only export both leave deployment blocked', () => {
  assert.deepEqual(validate(LOCAL_PLAN, inventory()), []);
  for (const source of ['synthetic', 'read-only-export']) {
    const fixture = inventory(); fixture.source = source;
    const errors = validateIsolation(LOCAL_PLAN, fixture, {mode: 'deployment', now: NOW});
    assert.ok(errors.includes('DEPLOYMENT_NOT_AUTHORIZED:local-only'));
    assert.ok(errors.includes('LIVE_RESOURCE_IDENTITIES_NOT_ATTESTED'));
  }
  assert.ok(validateIsolation(LOCAL_PLAN, inventory(), {mode: 'unknown', now: NOW}).includes('ISOLATION_UNKNOWN_MODE'));
});

test('rollback accepts exact owned targets and rejects foreign backups, targets and wildcard operations', () => {
  assert.deepEqual(validateRollback(LOCAL_PLAN, inventory(), rollback(), {now: NOW}), []);
  for (const change of [value => value.namespace = 'existing-app', value => value.steps[0].targetId = 'synthetic:existing-app:durableObjects', value => value.steps[0].backupId = 'synthetic:existing-app:backups', value => value.steps[1].targetId = '*', value => value.steps[1].action = 'delete', value => value.steps.push({action: 'restore-worker', targetId: 'synthetic:existing-app:workers'}), value => value.environment = 'production', value => value.steps.reverse()]) {
    const value = rollback(); change(value); assert.ok(validateRollback(LOCAL_PLAN, inventory(), value, {now: NOW}).length);
  }
});

test('rollback protection detects mutation, deletion and creation in every foreign resource category', () => {
  const before = inventory({owned: true}), after = clone(before);
  assert.deepEqual(compareProtectedResources(LOCAL_PLAN, before, after, {now: NOW}), []);
  for (const kind of KINDS) for (const action of ['mutate', 'delete', 'create']) {
    const changed = clone(after), rows = changed.resources[kind], index = rows.findIndex(row => row.owner !== APP_ID);
    if (action === 'mutate') rows[index].name += '-changed';
    if (action === 'delete') rows.splice(index, 1);
    if (action === 'create') rows.push({...rows[index], id: rows[index].id + '-extra', name: rows[index].name + '-extra'});
    assert.ok(compareProtectedResources(LOCAL_PLAN, before, changed, {now: NOW}).length > 0, `${kind}:${action}`);
  }
  assert.equal(fingerprint(before), fingerprint(clone(before)));
});

test('rollback cannot compare a different account, provenance or backwards capture time', () => {
  const before = inventory();
  for (const change of [value => value.accountId = 'different-account', value => value.source = 'read-only-export', value => value.capturedAt = new Date(NOW - 1).toISOString()]) {
    const after = clone(before); change(after);
    assert.ok(compareProtectedResources(LOCAL_PLAN, before, after, {now: NOW}).includes('ISOLATION_ROLLBACK_INVENTORY_CONTEXT_CHANGED'));
  }
});

test('deployment preflight CLI exits nonzero with no inventory, malformed inventory, foreign ID and valid fixture', t => {
  const dir = mkdtempSync(resolve(tmpdir(), 'pbx-isolation-cli-'));
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir(), 'pbx-isolation-cli-'))); rmSync(dir, {recursive: true, force: true}); });
  const path = resolve(dir, 'metadata.json'), fixture = inventory({now: Date.now()});
  assert.equal(preflight([]).status, 'BLOCKED');
  assert.equal(preflight(['--inventory', resolve(dir, 'missing.json')]).resourceActionsExecuted, 0);
  const cli = fileURLToPath(new URL('./cloudflare-preflight.mjs', import.meta.url));
  for (const input of ['{', JSON.stringify(fixture), JSON.stringify({...fixture, resources: {...fixture.resources, d1: [{...fixture.resources.d1[0], id: LOCAL_PLAN.resources.d1[0].id}]}})]) {
    writeFileSync(path, input);
    let failure; try { execFileSync(process.execPath, [cli, '--inventory', path], {encoding: 'utf8', cwd: dir}); } catch (error) { failure = error; }
    assert.ok(failure); assert.equal(failure.status, 1);
    const report = JSON.parse(failure.stdout); assert.equal(report.status, 'BLOCKED'); assert.equal(report.resourceActionsExecuted, 0); assert.equal(report.deploymentAuthorized, false);
  }
});
