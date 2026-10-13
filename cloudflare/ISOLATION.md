# PROMISE BOX Cloudflare app isolation

App owner: `davelee4863-glitch/sai-messenger:promise-box`.
Fixed namespace: `promise-box-sai-cf-dev-80f5fa37c2e8`.
Source baseline: `80f5fa37c2e8904e28715a31de603b0aede3ea67`.

## Invariant

An existing Cloudflare app is never shared with or changed by PROMISE BOX. This covers Workers, D1, Durable Objects, R2, KV, Queues, Secrets, Routes, Domains, environment variables, migrations, backups, logs and permissions. Sharing an account is allowed only as account context; it grants no right to another app's resources, values, bindings, data, logs or access scopes.

Every new resource must use the fixed namespace, carry the exact app owner and have a separate binding recorded in the plan. Existing resources must remain unchanged. Routes and domains may not overlap existing apps, including wildcard coverage. Environment variables and secrets may not import another app's values. Migration targets, backup destinations and restore sources, logging destinations, and permission resource sets must resolve exclusively to this app's explicitly owned resources. Unknown references, extra bindings and account-wide or other-app permission scopes block the operation.

The local emulator remains local-only. Its separate persistence directory and identities are checked locally; no deploy configuration or real cloud resource is introduced here.

## Deployment preflight

`harness/cloudflare-isolation.mjs` implements `validateLocalPlan(plan)` and `validateIsolation(plan, inventory, {mode: 'local' | 'deployment', now})`. `cloudflare/isolation-plan.json` is the machine-readable plan. `harness/cloudflare-preflight.mjs --inventory <metadata-json>` is a read-only metadata check and has no deploy or collection capability.

The inventory is metadata only: resource kinds, stable identifiers, names, exact app ownership, binding/resource relationships, routes/domains, environment variable and secret names/references, migration targets, backup/log destinations, and explicit permission resource sets. Never put secret values, tokens, user content or customer records in an inventory or evidence file. Do not collect another app's secret values or data to prove isolation.

Plan fields are `schemaVersion`, `appId`, `namespace`, `environment: "local"`, `execution: "local-only"`, `deploymentAuthorized: false`, `liveInventoryVerified: false`, `resources`, `bindings` (`name`, `kind`, `targetId`) and `rollback` (`targetIds`, `actions`). Resource categories are `workers`, `d1`, `durableObjects`, `r2`, `kv`, `queues`, `secrets`, `routes`, `domains`, `environmentVariables`, `migrations`, `backups`, `logs` and `permissions`. Every entry has `id`, `name`, `owner` and `namespace`; variable/secret metadata is scoped with `workerId` and never includes values. The local runtime fixes `MODE`, `ORIGIN`, `PBX_CF_APP_ID` and `PBX_CF_NAMESPACE` and rejects extra bindings beyond the explicit local safety settings.

Inventory fields are `schemaVersion: 1`, `accountId`, `capturedAt` (UTC ISO timestamp), `source` (`synthetic` for local fixtures or `read-only-export` for separately authorized metadata), `paginationComplete: true`, `categoriesComplete` (an explicit completeness boolean for every category), and `resources` (an array for every category, including an explicit empty array). All paginated categories must be complete; a partial list cannot prove there is no collision. Metadata entries use the same identity fields as the plan and resource link fields where applicable.

The validator accepts plain JSON data only. Supplied `workerId`, `scriptName`, `targetId` and `targetIds` must resolve against the complete inventory; missing targets and wildcard permission targets are rejected. A foreign entry may not reference any owned resource, even under a different name. Snapshots must be at most 15 minutes old and cannot be future-dated. Rollback comparisons require the same account and provenance and a nondecreasing capture time.

Before any future cloud action, a separately authorized process must supply a fresh, complete account inventory of all protected resource kinds, record its provenance and capture time, check the plan against every existing app, and confirm exact permission resource scopes. Missing, malformed, incomplete, stale, conflicting, ambiguous, unknown or foreign metadata fails closed. A permitted name by itself does not prove ownership. Synthetic/local provenance is invalid for deployment approval. Plan validation and local test PASS are never account verification or cloud permission.

Current approval is **harness/local validation only**. The plan explicitly denies cloud mutation and deployment. Real resource inventory and permission verification are **NOT_RUN**. No Workers/D1/DO/R2/KV/Queues/Secrets/Routes/Domains or other actual Cloudflare resource is changed by these checks.

## Rollback and recovery

A rollback plan is checked before any action and must target only exact resources owned by this app in the fixed namespace. It cannot delete or repoint foreign resources, widen permission scopes, import another app's bindings, or use another app's migrations/backups/logs. Validate rollback inventory and collision rules with the same strictness as forward actions.

Synthetic rollback tests preserve the existing app inventory and foreign state/log bytes, restore owned data into a new empty local store, and reject foreign targets. Rejected repeat restores preserve the owned pre-state. Snapshot ownership is checksummed metadata; it is not a cryptographic proof of cloud provenance. Local persistence rejects symlinks, junctions, hardlinks and overlapping marked storage roots. Nonempty unmarked legacy state is never automatically adopted. A passing synthetic rollback does not prove real cloud rollback or authorize it. Real cloud rollback remains **NOT_RUN**.

`validateRollback(plan, inventory, rollback, {mode, now})` validates targets and actions without applying them. `compareProtectedResources(plan, beforeInventory, afterInventory)` compares protected existing resources and returns errors when they change. Both return error arrays; they grant no mutation authority.

## Local verification

From the repository root:

```text
node harness/check.mjs
node --test harness/check.test.mjs harness/cloudflare-isolation.test.mjs
npm test --prefix cloudflare
node harness/cloudflare-preflight.mjs
```

The last command must block with a nonzero exit code because no real inventory or deployment approval is present. Positive local fixtures are paired with negative tests for every protected resource family, foreign bindings, names, references, inventories, permissions and rollback. No test contacts Cloudflare.

`.github/workflows/cloudflare-isolation.yml` is manual local validation only, with `contents: read`, no cloud credentials and no deploy command. This task does not dispatch it. Production/main/existing PRs and existing workflows remain unchanged.
