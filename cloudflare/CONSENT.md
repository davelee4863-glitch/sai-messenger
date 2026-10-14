# PM018 — local mutual confirmation

This feature runs only in the existing isolated Cloudflare emulator. It does not
authorize a deployment, account access, paid services or changes to existing apps.
Node BusinessStore and the public GitHub Pages demo remain unchanged.

## Direct conversations

A synthetic candidate asks **이대로 확정할까요?**. The proposer is not implicitly
approved. Either of the two authenticated participants may answer first. A first
approval returns `promise: null`; the second approval of the same proposal version
creates exactly one final promise. Repeated own approval never represents the
other participant. All transitions execute in the authoritative DO transaction.

Each candidate response includes `confirmationMode: mutual`, the participants,
explicit approval timestamps, version and `awaiting`, `negotiating`, `ignored`,
`mutually_confirmed` or `legacy_unverified` state. Missing responses stay missing.
Changing a pending candidate invalidates previous-version approvals. A partner's
`request-change` increments its version and enters negotiation; the proposer must
revise the candidate before either participant can approve it again.

Confirmed schedule changes keep the old jointly approved payload intact. The
proposer reviews and explicitly submits a separate change candidate, approving
only their own choice. `/change-confirm` requires the change ID, base schedule
version, change revision and `decision: CONFIRM`. Only the other participant's
explicit approval applies the new schedule. `/change-request` enters negotiation
and invalidates the old change revision. Replacing a change supersedes its ID;
late or repeated old requests cannot change a different or newer schedule.

The effective UI/list/projection status is `awaiting_confirmation` or
`negotiating` while a change is unresolved. The detail screen labels the old
confirmed schedule and the prospective change separately. Final confirmation
history records the actual actor, both participants and the accepted payload.
Existing explicit host-reviewed cancellation remains available and invalidates
any pending change. Cancellation does not require another person to agree to
attend or to confirm a replacement schedule.

## Groups and attendance

Group candidate confirmation remains a host action. It never changes any person's
attendance. Each attendee can choose only their own going/maybe/declined response;
no response remains pending. RSVP now requires the displayed schedule's
`expectedVersion`, checked before idempotent handling. A schedule change resets
RSVP to pending and preserves the old responses in history. Old-version or
versionless packets cannot approve the replacement schedule.

The shared UI sends this version only when the Cloudflare response declares a
confirmation mode; the existing Node API contract stays unchanged.

## Persistence and security

Five additive DO SQLite tables store proposal rounds/approvals, change requests,
change approvals and final per-version approvals. History is append-only. Unique
keys, optimistic versions, one active change per promise and synchronous DO
transactions cover duplicates, races and quota rollback. Actor identity always
comes from the authenticated session; strict body fields, membership, visibility
floors, CSRF and same-origin checks apply to the new routes too.

D1 remains an outbox-fed projection. It cannot grant membership, approve a
proposal, answer RSVP or authorize a change. Its projected status is derived from
the canonical DO consent state. A projection outage does not lose approvals.

Logical backups include all five consent tables; restore uses the existing owned
namespace/checksum/schema/FK/empty-target boundaries and revokes sessions and
ephemeral reviews. Durable pending changes and approvals survive. Exact old
owned v1 backups without any of the consent tables are supported, but old direct
promises with no pair approval evidence are exposed as `legacy_unverified` and
are never labelled confirmed. Partial or unknown table layouts fail closed.
Both users can explicitly accept a new change candidate to establish fresh proof.

## Verification scope

`cloudflare/tests/mutual-consent.test.mjs` adds 25 actual emulator cases covering
two-party approval, negotiation, exactly-once behavior, WebSocket notifications,
forged actors, D1 tampering/outages, quota rollback, restart, backup/legacy restore,
group attendance and stale RSVP.

The 417-case prior contract is retained. Two dependency-only byte-identity
assertions are adapted because an authorized feature changes the Worker bundle:
host-tool exclusion, pinned patch floors, unchanged Worker entry router, canonical
build identity and deterministic LF/CRLF builds remain checked. Existing
Cloudflare RSVP calls supply the new required version; their prior assertions
remain. New tests are discovered by the unchanged strict CI harness.

Real phones, public HTTPS/WSS, live account IAM/resource isolation and remote
deployment remain separate, unverified gates. Local test PASS never unblocks them.
