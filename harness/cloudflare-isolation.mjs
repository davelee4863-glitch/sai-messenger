import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {APP_ID, NAMESPACE, BINDINGS, WORKER_NAME, WORKSPACE_NAME, D1_ID, DO_CLASS} from '../cloudflare/isolation-identity.mjs';

export const KINDS = Object.freeze(['workers', 'd1', 'durableObjects', 'r2', 'kv', 'queues', 'secrets', 'routes', 'domains', 'environmentVariables', 'migrations', 'backups', 'logs', 'permissions']);
export const MAX_INVENTORY_AGE_MS = 15 * 60 * 1000;
const WORKER_ID = `local:${NAMESPACE}:worker`;
const DO_ID = `local:${NAMESPACE}:workspace`;
const BACKUP_ID = `local:${NAMESPACE}:backup`;
const settings = ['MODE', 'ORIGIN', 'PBX_CF_APP_ID', 'PBX_CF_NAMESPACE', 'REQUEST_BUDGET', 'READ_BUDGET', 'WRITE_BUDGET', 'SESSION_IDLE_MS', 'SESSION_ABSOLUTE_MS', 'QUOTA_PAUSED', 'D1_FAILURE'];
const owned = (id, name, extra = {}) => ({id, name, owner: APP_ID, namespace: NAMESPACE, ...extra});
const resources = Object.fromEntries(KINDS.map(kind => [kind, []]));
resources.workers = [owned(WORKER_ID, WORKER_NAME)];
resources.d1 = [owned(D1_ID, `${NAMESPACE}-meta`, {binding: BINDINGS.metadata})];
resources.durableObjects = [owned(DO_ID, WORKSPACE_NAME, {binding: BINDINGS.workspace, className: DO_CLASS, scriptName: WORKER_NAME})];
resources.environmentVariables = settings.map(name => owned(`local:${NAMESPACE}:var:${name}`, name, {workerId: WORKER_ID}));
resources.migrations = [owned(`local:${NAMESPACE}:migration:cf-v1`, `${NAMESPACE}-schema-cf-v1`, {targetId: DO_ID}), owned(`local:${NAMESPACE}:migration:projection`, `${NAMESPACE}-projection-v1`, {targetId: D1_ID})];
resources.backups = [owned(BACKUP_ID, `${NAMESPACE}-logical-backup`, {targetId: DO_ID})];
resources.logs = [owned(`local:${NAMESPACE}:logs`, `${NAMESPACE}-local-log`, {targetId: WORKER_ID})];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const LOCAL_PLAN = freeze({schemaVersion: 1, appId: APP_ID, namespace: NAMESPACE, environment: 'local', execution: 'local-only', deploymentAuthorized: false, liveInventoryVerified: false, resources,
  bindings: [{name: BINDINGS.workspace, kind: 'durableObjects', targetId: DO_ID}, {name: BINDINGS.metadata, kind: 'd1', targetId: D1_ID}, {name: BINDINGS.assets, kind: 'assets', targetId: WORKER_ID}],
  rollback: {targetIds: [DO_ID, D1_ID], actions: ['restore-backup', 'rebuild-projection']}});

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function jsonData(value, active = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) return false;
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || (array && (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= value.length || Number(key) >= 2 ** 32 - 1)) || !jsonData(descriptor.value, active)) return false;
  }
  if (array && Object.keys(value).length !== value.length) return false;
  active.delete(value);
  return true;
}
const strictData = value => { try { return jsonData(value); } catch { return false; } };
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\s\x00-\x1f\x7f]/.test(value);
const exactKeys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const allKeys = (value, expected) => exactKeys(value, expected) && expected.every(key => Object.hasOwn(value, key));
export const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// This allowlist is intentionally the current local candidate, not a general deploy configurator.
// Expanding it requires a separate reviewed implementation and cannot be achieved via JSON overrides.
export function validateLocalPlan(plan) {
  if (!object(plan) || !strictData(plan)) return ['ISOLATION_PLAN_MISSING_OR_NON_JSON_DATA'];
  const errors = [];
  for (const key of Object.keys(LOCAL_PLAN)) if (!isDeepStrictEqual(canonical(plan[key]), canonical(LOCAL_PLAN[key]))) errors.push(`ISOLATION_PLAN_IMMUTABLE:${key}`);
  for (const key of Object.keys(plan)) if (!Object.hasOwn(LOCAL_PLAN, key)) errors.push(`ISOLATION_PLAN_UNKNOWN_FIELD:${key}`);
  return errors;
}

const RECORD_KEYS = ['id', 'name', 'owner', 'namespace', 'binding', 'workerId', 'targetId', 'targetIds', 'className', 'scriptName'];
const scoped = new Set(['secrets', 'environmentVariables']);
function inspectInventory(inventory, now) {
  const errors = [];
  if (!strictData(inventory)) return ['ISOLATION_INVENTORY_NON_JSON_DATA'];
  if (!allKeys(inventory, ['schemaVersion', 'accountId', 'capturedAt', 'source', 'paginationComplete', 'categoriesComplete', 'resources'])) return ['ISOLATION_INVENTORY_MISSING_OR_UNKNOWN_FIELDS'];
  if (inventory.schemaVersion !== 1 || !label(inventory.accountId)) errors.push('ISOLATION_INVENTORY_IDENTITY');
  if (!['synthetic', 'read-only-export'].includes(inventory.source)) errors.push('ISOLATION_INVENTORY_SOURCE');
  const captured = Date.parse(inventory.capturedAt);
  if (typeof inventory.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(inventory.capturedAt) || !Number.isFinite(captured) || new Date(captured).toISOString() !== inventory.capturedAt || !Number.isFinite(now) || captured > now || now - captured > MAX_INVENTORY_AGE_MS) errors.push('ISOLATION_INVENTORY_STALE_OR_FUTURE');
  if (inventory.paginationComplete !== true || !allKeys(inventory.categoriesComplete, KINDS) || KINDS.some(kind => inventory.categoriesComplete[kind] !== true)) errors.push('ISOLATION_INVENTORY_INCOMPLETE');
  if (!allKeys(inventory.resources, KINDS)) return [...errors, 'ISOLATION_INVENTORY_CATEGORIES'];
  for (const kind of KINDS) {
    const rows = inventory.resources[kind];
    if (!Array.isArray(rows)) { errors.push(`ISOLATION_INVENTORY_NOT_ARRAY:${kind}`); continue; }
    const ids = new Set(), names = new Set();
    for (const row of rows) {
      if (!exactKeys(row, RECORD_KEYS) || !['id', 'name', 'owner', 'namespace'].every(key => label(row[key])) || !Object.entries(row).every(([key, value]) => key === 'targetIds' ? Array.isArray(value) && value.length > 0 && value.every(label) && new Set(value).size === value.length : label(value))) { errors.push(`ISOLATION_INVENTORY_INVALID_RECORD:${kind}`); continue; }
      if (scoped.has(kind) && !label(row.workerId)) errors.push(`ISOLATION_INVENTORY_SCOPE_MISSING:${kind}`);
      const name = `${scoped.has(kind) ? row.workerId : ''}\0${row.name.toLowerCase()}`;
      if (ids.has(row.id) || names.has(name)) errors.push(`ISOLATION_INVENTORY_DUPLICATE:${kind}`);
      ids.add(row.id); names.add(name);
    }
  }
  if (!errors.length) {
    const ids = new Set(KINDS.flatMap(kind => inventory.resources[kind].map(row => row.id)));
    const workerIds = new Set(inventory.resources.workers.map(row => row.id));
    const workerNames = new Set(inventory.resources.workers.map(row => row.name));
    for (const kind of KINDS) for (const row of inventory.resources[kind]) {
      if ([row.targetId, ...(row.targetIds ?? [])].filter(Boolean).some(id => !ids.has(id))) errors.push(`ISOLATION_INVENTORY_REFERENCE_UNKNOWN:${kind}`);
      if (row.workerId && !workerIds.has(row.workerId)) errors.push(`ISOLATION_INVENTORY_WORKER_UNKNOWN:${kind}`);
      if (row.scriptName && !workerNames.has(row.scriptName)) errors.push(`ISOLATION_INVENTORY_SCRIPT_UNKNOWN:${kind}`);
    }
  }
  return errors;
}

export function validateIsolation(plan, inventory, {mode = 'local', now = Date.now()} = {}) {
  const errors = [...validateLocalPlan(plan), ...inspectInventory(inventory, now)];
  if (!['local', 'deployment'].includes(mode)) errors.push('ISOLATION_UNKNOWN_MODE');
  if (mode === 'deployment') {
    // The human approval scope for this candidate is harness/local verification only.
    errors.push('DEPLOYMENT_NOT_AUTHORIZED:local-only');
    if (!strictData(inventory) || inventory?.source !== 'read-only-export') errors.push('LIVE_INVENTORY_NOT_VERIFIED:synthetic-or-missing');
    errors.push('LIVE_RESOURCE_IDENTITIES_NOT_ATTESTED');
  }
  if (errors.some(error => error.startsWith('ISOLATION_PLAN_') || error.startsWith('ISOLATION_INVENTORY_'))) return errors;
  const ownedIds = new Set(KINDS.flatMap(type => plan.resources[type].map(resource => resource.id)));
  for (const kind of KINDS) {
    const planned = plan.resources[kind];
    for (const existing of inventory.resources[kind]) {
      const matching = planned.find(resource => resource.id === existing.id || (resource.name.toLowerCase() === existing.name.toLowerCase() && (!scoped.has(kind) || resource.workerId === existing.workerId)));
      if (matching && !isDeepStrictEqual(canonical(existing), canonical(matching))) errors.push(`ISOLATION_RESOURCE_COLLISION:${kind}`);
      if (existing.namespace === NAMESPACE && existing.owner !== APP_ID) errors.push(`ISOLATION_FOREIGN_NAMESPACE:${kind}`);
      if (existing.namespace === NAMESPACE && existing.owner === APP_ID && !planned.some(resource => isDeepStrictEqual(canonical(resource), canonical(existing)))) errors.push(`ISOLATION_UNPLANNED_OWNED_RESOURCE:${kind}`);
      if (existing.binding && Object.values(BINDINGS).includes(existing.binding) && existing.namespace !== NAMESPACE) errors.push(`ISOLATION_FOREIGN_BINDING:${kind}`);
      const foreign = existing.owner !== APP_ID || existing.namespace !== NAMESPACE;
      if (foreign && [existing.workerId, existing.targetId, ...(existing.targetIds ?? [])].some(id => ownedIds.has(id))) errors.push(`ISOLATION_FOREIGN_RESOURCE_REFERENCE:${kind}`);
      if (existing.scriptName === WORKER_NAME && foreign) errors.push(`ISOLATION_FOREIGN_WORKER_REFERENCE:${kind}`);
    }
  }
  return errors;
}

export function validateRollback(plan, inventory, rollback, options = {}) {
  const errors = validateIsolation(plan, inventory, options);
  if (!strictData(rollback) || !allKeys(rollback, ['schemaVersion', 'appId', 'namespace', 'environment', 'steps']) || rollback.schemaVersion !== 1 || rollback.appId !== APP_ID || rollback.namespace !== NAMESPACE || rollback.environment !== 'local' || !Array.isArray(rollback.steps) || rollback.steps.length !== 2) return [...errors, 'ISOLATION_ROLLBACK_INVALID'];
  const expected = [{action: 'restore-backup', targetId: DO_ID, backupId: BACKUP_ID}, {action: 'rebuild-projection', targetId: D1_ID}];
  if (!isDeepStrictEqual(canonical(rollback.steps), canonical(expected))) errors.push('ISOLATION_ROLLBACK_FOREIGN_OR_UNSUPPORTED_TARGET');
  return errors;
}

export function compareProtectedResources(plan, before, after, {now = Date.now()} = {}) {
  const errors = [...validateIsolation(plan, before, {now}), ...validateIsolation(plan, after, {now})];
  if (errors.length) return errors;
  if (before.accountId !== after.accountId || before.source !== after.source || Date.parse(after.capturedAt) < Date.parse(before.capturedAt)) errors.push('ISOLATION_ROLLBACK_INVENTORY_CONTEXT_CHANGED');
  const protectedRows = inventory => Object.fromEntries(KINDS.map(kind => [kind, inventory.resources[kind].filter(row => row.owner !== APP_ID || row.namespace !== NAMESPACE).map(canonical).sort((a, b) => a.id.localeCompare(b.id))]));
  if (fingerprint(protectedRows(before)) !== fingerprint(protectedRows(after))) errors.push('ISOLATION_ROLLBACK_PROTECTED_RESOURCES_CHANGED');
  return errors;
}
