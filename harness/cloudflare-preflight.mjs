import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateIsolation, fingerprint} from './cloudflare-isolation.mjs';

// Read metadata only. No network, account credentials, subprocess, resource creation or deployment.
export function preflight(args = [], {now = Date.now()} = {}) {
  let inventory;
  const errors = [];
  if (args.length !== 2 || args[0] !== '--inventory') errors.push('INVENTORY_REQUIRED: --inventory <metadata-json>');
  else try { inventory = JSON.parse(readFileSync(resolve(args[1]), 'utf8')); } catch { errors.push('INVENTORY_UNREADABLE'); }
  let plan;
  try { plan = JSON.parse(readFileSync(new URL('../cloudflare/isolation-plan.json', import.meta.url), 'utf8')); } catch { errors.push('PLAN_UNREADABLE'); }
  errors.push(...validateIsolation(plan, inventory, {mode: 'deployment', now}));
  return {status: 'BLOCKED', deploymentAuthorized: false, liveInventoryVerified: false, resourceActionsExecuted: 0, planSha256: plan ? fingerprint(plan) : null, inventorySha256: inventory ? fingerprint(inventory) : null, errors};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(preflight(process.argv.slice(2)), null, 2));
  process.exitCode = 1;
}
