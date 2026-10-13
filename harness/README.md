# SAI Messenger — anti-rework harness V1

Scope: this repository only. Not DDAKARI or golf translation.

## Non-negotiable rules
1. No edits or destructive calls to Production, Railway, customer DB, customer data or live API tokens without explicit approval.
2. No direct `main` changes. Work on a branch, create a draft PR, verify, independently review, and obtain deployment approval.
3. Test with synthetic identities and isolated environments. Protect pre-existing device localStorage and server messages before migrating.
4. An unrun check is NOT_RUN, not PASS. Source review is not a browser integration test.
5. Every real failure is written to `harness/incidents.json` with symptom, evidence, confirmed cause or UNCONFIRMED, prevention and regression test path or PENDING.
6. A resolved issue requires a regression test and independent reviewer evidence. Never self-certify.
7. Existing known vulnerabilities stay in `harness/known-risks.json` until independently verified.
8. Reproduce FAIL before patch, then PASS afterward. Record commit references and rollback.
9. New AI features must specify rate, concurrency, message-size and spending caps before release.

## Commands (Node 22+)
- `node harness/check.mjs` — non-destructive source syntax, JSON schema, known-risk and tracked-secret filename checks. PASS does NOT mean safe to release.
- `node --test harness/check.test.mjs` — harness guard unit tests.
- `node harness/check.mjs --release` — FAIL for unresolved P0 risks or HIGH/CRITICAL incidents. Browser, auth, data restore and staging tests are **NOT_RUN** by this command.
- `node harness/record-incident.mjs --id SAI-INC-20261013-01 --severity HIGH --symptom "example" --cause UNCONFIRMED --prevention "add regression" --test PENDING --evidence "synthetic reproduction reference"` (example only, not yet recorded).

## Incident loop
Stop and preserve evidence → register actual failure → find minimal synthetic reproduction → determine cause → implement regression + fix → independent reviewer checks evidence → mark VERIFIED → seek release approval.

## Current baseline
Main SHA `10aef073da73193c0e43d298537795b22b06d6af` (2026-10-13). PR #1 is a separate draft. No browser test and no Railway deployment verification. Existing main branch is not GitHub-protected. This harness cannot enforce admin-side branch protection and cannot attest to live storage.

DoD: requirement/risk ID, synthetic failing case, regression pass, independent review, rollback, release approval.
