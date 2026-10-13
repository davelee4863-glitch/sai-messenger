# SAI Messenger — anti-rework harness V1

Scope: this repository only. Not DDAKARI or golf translation.

## Non-negotiable rules
1. No edits or destructive calls to Production, Railway, customer DB, customer data or live API tokens without explicit approval.
2. No direct `main` changes. Work on a branch, create a draft PR, verify, independently review, and obtain deployment approval.
3. Test with synthetic identities and isolated environments. Protect pre-existing device localStorage and server messages before migrating.
4. An unrun check is NOT_RUN, not PASS. Source review is not a browser integration test.
5. Every real failure is written to `harness/incidents.json` with ID, occurrence/log timestamps, symptom, evidence, confirmed cause or UNCONFIRMED, resolution or PENDING, prevention and regression test path or PENDING.
6. A resolved issue requires executed regression PASS evidence and independent reviewer evidence. Never self-certify.
7. Existing known vulnerabilities stay in `harness/known-risks.json` until independently verified.
8. Reproduce FAIL before patch, then PASS afterward. Record commit references and rollback.
9. New AI features must specify rate, concurrency, message-size and spending caps before release.
10. Do not put credentials in arguments, journal text or evidence. Redact first. Secret pattern and filename checks are defense in depth; they cannot detect every encoded or arbitrarily named secret.
11. **Cloudflare app isolation is an invariant.** PROMISE BOX must never share or change any existing app's Workers, D1, Durable Objects, R2, KV, Queues, Secrets, Routes, Domains, environment variables, migrations, backups, logs or permissions. The same account may host multiple apps, but every PROMISE BOX resource and binding must have its own recorded owner and namespace. Missing ownership, unknown references, overlapping names or permissions, and another app's binding fail closed.

## Commands (Node 22+)
- `node harness/check.mjs` — non-destructive source/ tracked JavaScript syntax, required harness file, JSON schema, known-risk and tracked-secret filename checks. PASS does NOT mean safe to release.
- `node --test harness/check.test.mjs` — harness guard and isolated synthetic Git/CLI regression tests. Fixtures never start the product server.
- `node harness/check.mjs --release` — FAIL for invalid records, unresolved P0 risks or HIGH/CRITICAL incidents. Browser, auth, data restore and staging tests are **NOT_RUN** by this command.
- If `cloudflare/` exists, `node harness/check.mjs` also validates the local isolation plan and requires the Cloudflare policy, preflight, regression and manual local-validation workflow files. Repositories/fixtures without `cloudflare/` retain the existing harness contract. This structural check does not inspect a Cloudflare account.
- `node --test harness/cloudflare-isolation.test.mjs` — synthetic resource inventory, foreign binding, collision, fail-closed and rollback regression tests. Local fixtures never count as a real resource inventory or deployment approval.
- `npm --prefix cloudflare run test:isolation` — the same isolation regression suite.
- `node harness/cloudflare-preflight.mjs --inventory <metadata-json>` (or `npm --prefix cloudflare run preflight:deployment -- --inventory <metadata-json>`) — metadata-only deployment gate. Missing, stale or incomplete inventory blocks. It performs no deployment, collection or mutation. The current local-only plan blocks cloud operation even with a passing synthetic fixture.
- Example only; not a real incident:
```bash
node harness/record-incident.mjs --id SAI-INC-20261013-99 --severity HIGH --occurred-at 2026-10-13T00:00:00.000Z --record-type SYNTHETIC --symptom "example" --cause UNCONFIRMED --resolution PENDING --prevention "add regression" --test PENDING --evidence "synthetic reproduction reference"
```

## Incident loop and schema
Stop and preserve redacted evidence → register actual failure → find minimal synthetic reproduction → determine cause → implement regression + fix → independent reviewer checks evidence → mark VERIFIED → seek release approval.

Every incident has `recordType: REAL|SYNTHETIC`. REAL means an actual observed defect, even when reproduced with synthetic inputs. SYNTHETIC means an invented test incident. Use test incidents only in isolated fixture journals; preserve real incidents in the repository journal. The CLI defaults to REAL and never marks an incident VERIFIED. Timestamps use UTC ISO format with milliseconds, such as `2026-10-13T00:00:00.000Z`; occurredAt records the event time and loggedAt records registration.

VERIFIED risks and incidents require:
- `regressionTest`: a nonempty repository-contained regular `*.test.js|mjs|cjs|ts` or `*.spec.js|mjs|cjs|ts` file; README, directory and outside paths are rejected.
- `regressionResult: PASS` and concrete `regressionEvidence` with command, result and log reference.
- `resolvedBy` and a different `reviewedBy`, concrete `verificationEvidence`, UTC `verifiedAt` and a 40-character `verificationCommit`.
- Incidents additionally require confirmed `rootCause` and concrete `resolution`.

Blank or placeholder evidence (including NOT_RUN/PENDING/UNVERIFIED) is rejected. These are structural evidence requirements: the checker cannot authenticate reviewer identity, prove a log is truthful, or stop an administrator from modifying the checker. Independent review must inspect the referenced commit and rerun tests. Do not treat invented evidence as validation.

## Current baseline and rollout
Main SHA `10aef073da73193c0e43d298537795b22b06d6af` (2026-10-13). PR #1 is a separate draft. No browser test and no Railway deployment verification. Existing main branch is not GitHub-protected. This harness cannot enforce admin-side branch protection and cannot attest to live storage.

Harness validation changes are local on `chore/saitalk-harness-v1-20261013`. Confirm Railway's tracked branch and deploy triggers before pushing; this validation task does not authorize production changes. PR #2 must remain unmerged. Rollback only the harness validation commits; leave PR #1, runtime sources, baseline risks and real incident evidence intact.

DoD: requirement/risk ID, synthetic failing case, regression pass, independent review, rollback, release approval.

## Cloudflare policy and current authority

The fixed app ID is `davelee4863-glitch/sai-messenger:promise-box`; the namespace is `promise-box-sai-cf-dev-80f5fa37c2e8`. The declarative policy in `cloudflare/isolation-plan.json`, invariant rules in `harness/cloudflare-rules.json` and executable validator in `harness/cloudflare-isolation.mjs` must agree. [Cloudflare isolation contract](../cloudflare/ISOLATION.md) defines the inventory and rollback limits.

PM010 authorizes minimal harness correction, local tests, independent review, a safe new development branch push and remote test CI. It does not authorize Cloudflare account inventory collection, resource changes or deployment. Production/main/PR#1–#6 and existing Cloudflare apps remain outside the mutation scope. Real inventory and effective IAM remain **UNVERIFIED**; cloud rollback, hosted HTTPS/WSS and physical phone tests remain **NOT_RUN**.

The corrected `.github/workflows/cloudflare-isolation.yml` runs test-only CI on the explicitly approved new development branch push. It has read-only repository permission, no Cloudflare credentials and no deployment path. `node harness/cloudflare-ci.mjs` discovers new tests, requires the 27 existing Node test files/348 cases and reports failures, execution errors and skipped cases without hiding them. One unchanged, source-fingerprinted browser-only procedure is reported separately as **NOT_RUN**. Existing production/Pages workflows are preserved.
