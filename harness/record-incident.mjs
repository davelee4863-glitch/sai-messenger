import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validate, containsSecret} from './check.mjs';

const args = {};
const required = ['id', 'severity', 'occurred-at', 'symptom', 'cause', 'resolution', 'prevention', 'test', 'evidence'];
for (let index = 2; index < process.argv.length; index += 2) {
 const flag = process.argv[index];
 const key = flag?.replace(/^--/, '');
 if (![...required, 'record-type'].includes(key) || !flag?.startsWith('--') || !process.argv[index + 1]?.trim() || key in args) {
  console.error('Usage: unique --id --severity --occurred-at --symptom --cause --resolution --prevention --test --evidence [--record-type REAL|SYNTHETIC]');
  process.exit(2);
 }
 args[key] = process.argv[index + 1].trim();
}
if (required.some(key => !args[key])) { console.error('All incident fields required'); process.exit(2); }
if (containsSecret(Object.values(args).join('\n'))) { console.error('Potential secret; redact'); process.exit(2); }

const path = resolve(dirname(fileURLToPath(import.meta.url)), 'incidents.json');
try {
 const data = JSON.parse(readFileSync(path, 'utf8'));
 if (!Array.isArray(data?.incidents)) { console.error('Invalid incident inventory'); process.exit(1); }
 data.incidents.push({id: args.id, loggedAt: new Date().toISOString(), occurredAt: args['occurred-at'], recordType: args['record-type'] || 'REAL', severity: args.severity, status: 'OPEN', symptom: args.symptom, rootCause: args.cause, resolution: args.resolution, prevention: args.prevention, regressionTest: args.test, evidence: args.evidence});
 const errors = validate({schemaVersion: 1, risks: []}, data);
 if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
 writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
 console.log('Recorded ' + args.id);
} catch { console.error('Incident journal unreadable or write failed'); process.exit(1); }
