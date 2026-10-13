import {readFileSync, existsSync, statSync, realpathSync} from 'node:fs';
import {resolve, dirname, isAbsolute, sep, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {execFileSync} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const concrete = value => text(value) && !/^(PENDING|NOT_RUN|UNVERIFIED|UNCONFIRMED|UNKNOWN|N\/A|NONE|TODO|PASS|FAIL)$/i.test(value.trim());
const timestamp = value => text(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identity = value => typeof value === 'string' ? value.trim().normalize('NFKC').toLowerCase() : '';

// Shared by the journal CLI and preflight, including manually edited JSON.
export const containsSecret = value => {
 if (Array.isArray(value)) return value.some(containsSecret);
 if (object(value)) return Object.entries(value).some(([key, item]) => containsSecret(item) || containsSecret(key + '=' + (typeof item === 'string' ? item : JSON.stringify(item))));
 const serialized = typeof value === 'string' ? value.replaceAll('\\"', '"') : '';
 if (!serialized) return false;
 return /sk-[a-z0-9_-]{12,}|(?:gh[pousr]_|github_pat_)[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{12,}|AKIA[A-Z0-9]{16}|AIza[a-z0-9_-]{30,}|\b(?:Bearer|Basic)\s+[a-z0-9+\/._=-]+|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|[a-z][a-z0-9+.-]*:\/\/[^\s/:"\\]+:[^\s/@"\\]+@/i.test(serialized)
  || /(?:api[_ -]?key|password|passwd|(?:access[_ -]?|refresh[_ -]?)token|client[_ -]?secret|secret|private[_ -]?key)["']?\s*[:=]\s*["']?(?!\[REDACTED\]|REDACTED\b|<REDACTED>|PENDING\b)[^\s"',}]+/i.test(serialized);
};

export const sensitivePath = path => {
 const name = basename(path.replaceAll('\\', '/')).toLowerCase();
 if (/^\.env\.(example|sample)$/.test(name)) return false;
 return /^\.env(?:\..*)?$|^credentials(?:[._-].*)?\.json$|^service[-_]?account(?:[._-].*)?\.json$|^.*firebase-adminsdk.*\.json$|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?$|\.(?:pem|key|p12|pfx|keystore|jks)$/.test(name);
};

const testFile = (path, root) => {
 if (!text(path) || isAbsolute(path) || /^[a-z]:/i.test(path) || path.includes('\\') || !/(?:\.test|\.spec)\.(?:js|mjs|cjs|ts)$/.test(path)) return false;
 try {
  const base = realpathSync(root);
  const target = realpathSync(resolve(root, path));
  return target.startsWith(base + sep) && statSync(target).isFile() && readFileSync(target, 'utf8').trim().length > 0;
 } catch { return false; }
};

const completionErrors = (record, label, root, errors) => {
 if (!testFile(record.regressionTest, root)) errors.push(label + ' requires a repository test file');
 if (record.regressionResult !== 'PASS' || !concrete(record.regressionEvidence)) errors.push(label + ' requires executed regression PASS evidence');
 if (!concrete(record.resolvedBy) || !concrete(record.reviewedBy) || identity(record.resolvedBy) === identity(record.reviewedBy)) errors.push(label + ' requires an independent reviewer');
 if (!concrete(record.verificationEvidence) || !timestamp(record.verifiedAt) || typeof record.verificationCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(record.verificationCommit)) errors.push(label + ' requires review evidence, timestamp and commit');
};

export const validate = (risks, incidents, {root = ROOT} = {}) => {
 const errors = [], ids = new Set();
 if (containsSecret(risks) || containsSecret(incidents)) errors.push('Potential credential in inventory; redact before recording');
 if (!object(risks) || risks.schemaVersion !== 1 || !Array.isArray(risks.risks)) errors.push('Invalid risk inventory');
 else for (const [index, record] of risks.risks.entries()) {
  if (!object(record)) { errors.push('Invalid risk record #' + index); continue; }
  const label = typeof record.id === 'string' && /^SAI-R[0-9]{3,}$/.test(record.id) ? record.id : 'risk #' + index;
  if (label !== record.id || ids.has(record.id)) errors.push('Bad or duplicate risk ID: ' + label);
  ids.add(record.id);
  if (!['P0', 'P1', 'P2'].includes(record.priority) || !['OPEN', 'MITIGATING', 'VERIFIED'].includes(record.status)) errors.push(label + ' invalid status or priority');
  for (const key of ['title', 'evidence', 'prevention', 'regressionTest']) if (!text(record[key])) errors.push(label + ' missing ' + key);
  if (record.status === 'VERIFIED') completionErrors(record, label, root, errors);
 }
 ids.clear();
 if (!object(incidents) || incidents.schemaVersion !== 1 || !Array.isArray(incidents.incidents)) errors.push('Invalid incident inventory');
 else for (const [index, record] of incidents.incidents.entries()) {
  if (!object(record)) { errors.push('Invalid incident record #' + index); continue; }
  const label = typeof record.id === 'string' && /^SAI-INC-[0-9]{8}-[0-9]{2,}$/.test(record.id) ? record.id : 'incident #' + index;
  if (label !== record.id || ids.has(record.id)) errors.push('Bad or duplicate incident ID: ' + label);
  ids.add(record.id);
  if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(record.severity) || !['OPEN', 'MITIGATING', 'VERIFIED'].includes(record.status)) errors.push(label + ' invalid status or severity');
  for (const key of ['loggedAt', 'occurredAt', 'symptom', 'rootCause', 'resolution', 'prevention', 'regressionTest', 'evidence']) if (!text(record[key])) errors.push(label + ' missing ' + key);
  if (!timestamp(record.loggedAt) || !timestamp(record.occurredAt)) errors.push(label + ' invalid incident timestamp');
  if (!['REAL', 'SYNTHETIC'].includes(record.recordType)) errors.push(label + ' missing recordType REAL/SYNTHETIC');
  if (record.status === 'VERIFIED') {
   if (!concrete(record.rootCause) || !concrete(record.resolution)) errors.push(label + ' requires confirmed cause and resolution');
   completionErrors(record, label, root, errors);
  }
 }
 return errors;
};

export const blockers = (risks, incidents, options) => [
 ...validate(risks, incidents, options).map(error => 'INVALID RECORD: ' + error),
 ...(Array.isArray(risks?.risks) ? risks.risks : []).filter(x => x?.priority === 'P0' && x.status !== 'VERIFIED').map(x => typeof x.id === 'string' && /^SAI-R[0-9]{3,}$/.test(x.id) ? x.id : 'INVALID RISK ID'),
 ...(Array.isArray(incidents?.incidents) ? incidents.incidents : []).filter(x => ['CRITICAL', 'HIGH'].includes(x?.severity) && x.status !== 'VERIFIED').map(x => typeof x.id === 'string' && /^SAI-INC-[0-9]{8}-[0-9]{2,}$/.test(x.id) ? x.id : 'INVALID INCIDENT ID')
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const errors = [];
 let risks, incidents;
 try {
  risks = JSON.parse(readFileSync(resolve(ROOT, 'harness/known-risks.json'), 'utf8'));
  incidents = JSON.parse(readFileSync(resolve(ROOT, 'harness/incidents.json'), 'utf8'));
  errors.push(...validate(risks, incidents));
 } catch { errors.push('Inventory JSON unreadable or malformed'); }
 for (const path of ['harness/README.md', 'harness/known-risks.json', 'harness/incidents.json', 'harness/check.mjs', 'harness/check.test.mjs', 'harness/record-incident.mjs', '.github/workflows/harness.yml']) {
  if (!existsSync(resolve(ROOT, path)) || !statSync(resolve(ROOT, path)).isFile()) errors.push('Missing harness file: ' + path);
 }
 // Activate the Cloudflare invariant only for a checkout containing the adapter.
 // Existing harness fixtures without cloudflare/ keep their original contract.
 if (existsSync(resolve(ROOT, 'cloudflare'))) {
  for (const path of ['harness/cloudflare-rules.json', 'harness/cloudflare-isolation.mjs', 'harness/cloudflare-isolation.test.mjs', 'harness/cloudflare-preflight.mjs', 'cloudflare/isolation-plan.json', 'cloudflare/ISOLATION.md', '.github/workflows/cloudflare-isolation.yml']) {
   if (!existsSync(resolve(ROOT, path)) || !statSync(resolve(ROOT, path)).isFile()) errors.push('Missing Cloudflare isolation file: ' + path);
  }
  try {
   const {validateLocalPlan} = await import('./cloudflare-isolation.mjs');
   const plan = JSON.parse(readFileSync(resolve(ROOT, 'cloudflare/isolation-plan.json'), 'utf8'));
   errors.push(...validateLocalPlan(plan).map(error => 'Cloudflare isolation: ' + error));
   const rules = JSON.parse(readFileSync(resolve(ROOT, 'harness/cloudflare-rules.json'), 'utf8'));
   if (!object(rules) || rules.schemaVersion !== 1 || !Array.isArray(rules.rules)) errors.push('Invalid Cloudflare invariant rule inventory');
   else {
    const ids = new Set();
    for (const rule of rules.rules) {
     if (!object(rule) || !text(rule.id) || ids.has(rule.id) || !text(rule.rule) || !testFile(rule.test, ROOT)) errors.push('Invalid Cloudflare invariant rule or regression path');
     ids.add(rule?.id);
    }
    for (const id of ['CF-ISOLATION', 'CF-APP-ISOLATION', 'CF-RESOURCE-PREFLIGHT', 'CF-ROLLBACK-ISOLATION']) if (!ids.has(id)) errors.push('Missing Cloudflare invariant rule: ' + id);
   }
  } catch { errors.push('Cloudflare isolation plan/rules unreadable, malformed or validator unavailable'); }
 }
 try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  if (pkg.scripts?.start !== 'node server.js') errors.push('Start contract changed');
  new Script(readFileSync(resolve(ROOT, 'server.js'), 'utf8'), {filename: 'server.js'});
  const html = readFileSync(resolve(ROOT, 'public/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if (!scripts.length) errors.push('No inline browser JS');
  for (const script of scripts) new Script(script[1], {filename: 'public/index.html'});
 } catch { errors.push('Syntax/config check failed'); }
 try {
  const paths = execFileSync('git', ['ls-files', '-z'], {cwd: ROOT, encoding: 'utf8'}).split('\0').filter(Boolean);
  const secrets = paths.filter(sensitivePath);
  if (secrets.length) errors.push('Tracked sensitive filename(s): ' + secrets.join(', '));
  for (const path of paths.filter(path => /\.(?:mjs|cjs|js)$/i.test(path))) {
   try { execFileSync(process.execPath, ['--check', resolve(ROOT, path)], {stdio: 'pipe'}); }
   catch { errors.push('JavaScript syntax check failed: ' + path); }
  }
 } catch { errors.push('Git filename/syntax check NOT_RUN'); }
 const open = blockers(risks, incidents).filter(item => !item.startsWith('INVALID RECORD: '));
 if (process.argv.includes('--release')) errors.push(...open.map(id => 'RELEASE BLOCKED: ' + id));
 else console.log('Release blockers remaining: ' + open.length + ' (preflight does not approve release)');
 for (const error of errors) console.error('FAIL ' + error);
 console.log('SAI HARNESS ' + (errors.length ? 'FAIL' : 'PASS') + ' (structural only; browser/production NOT_RUN)');
 if (errors.length) process.exitCode = 1;
}
