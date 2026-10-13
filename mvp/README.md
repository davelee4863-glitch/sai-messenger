# PROMISE BOX local core MVP — PM005

This is a separate synthetic-user application. The legacy `server.js`, `public/`, root package, Production Railway and static `docs/` Pages preview are unchanged. Only bind `127.0.0.1`; public binding and external APIs are rejected. No real user data, phone numbers, paid services or AI API calls are needed. Existing P0 risk records remain OPEN: these guards do not repair or certify the legacy product.

## Run on this PC

Use Node **22.23.2**. Its built-in SQLite API is experimental; this MVP is not an operating release. From this worktree:

```powershell
npm ci --prefix mvp --ignore-scripts --no-fund --no-audit
node mvp/provision.mjs --db ../pm005/data/core.sqlite --credentials ../pm005/private/test-credentials.json
$env:MVP_SQLITE_FILE = (Resolve-Path ../pm005/data/core.sqlite).Path
$env:MVP_PORT = '4174'
$env:MVP_HOST = '127.0.0.1'
$env:MVP_EXTERNAL_API = 'off'
node mvp/server.mjs
```

Open `http://127.0.0.1:4174/`. Provision once into a new database; the command refuses existing users and credential-file overwrites. Four random synthetic accounts (`tester-a` through `tester-d`) have immutable server UUIDs and display nicknames. Read their initial passwords privately from the separate credentials file; do not commit or publish it. The CLI never prints them. There is no registration, reset, deletion or external calendar endpoint.

For independent sessions use Chrome and the Codex in-app browser, plus `http://c.localhost:4174/` in Chrome. Cookies are host-only. Allowed local names are an explicit list, not arbitrary subdomains. Each request must match its own exact Host and Origin. This is not a LAN/mobile-device server. Real phones and an internet MVP need a separately approved isolated HTTPS environment.

## State and authorization

`schema.sql` uses SQLite strict tables and foreign keys: users; separate auth credentials and hashed sessions; rooms; active room memberships; messages and delivery receipts; synthetic proposals; confirmed promises; per-person attendees/RSVP; expiring approval reviews; append-only change/cancellation history. Canonical UUIDv4 IDs and a unique `(room, sender, client_message_id)` key prevent duplicate retransmissions. Nicknames and payloads never choose the authenticated actor.

The storage module is the domain boundary. `MVP_SQLITE_FILE` must explicitly select a local test file, with WAL, FULL durability and immediate write transactions. No operating database or environment is inferred. A future production adapter/migration is unimplemented and must have its own credentials, isolation and recovery review. Database copies contain password hashes and session digests; treat backups as private. Plaintext synthetic credentials live in a separate directory. POSIX modes are requested; Windows ACL enforcement and encryption at rest are NOT_RUN.

Passwords use salted scrypt (N=32768, r=8, p=1). Opaque random session tokens are hashed in SQLite, rotate at login, revoke on logout, expire after 15 idle minutes/8 hours and permit at most five active sessions per user. Cookies are HttpOnly/SameSite Strict. Secure cookies require HTTPS and are not used on this loopback HTTP application. Writes require same-origin JSON plus CSRF and revalidate sessions after streamed-body waits; membership is checked in transactions. WebSocket upgrades require the session, exact Origin and current room membership. A removed user loses HTTP/WS access; heartbeat also checks session expiry.

Default limits: 2,000 Unicode code points/message; 16 KiB JSON body; 8 KiB headers; 30 message requests/minute/user; 120 authenticated requests/minute/user; 5 login attempts/minute/local IP; four concurrent scrypt jobs; 10 upgrades/minute/user; three sockets/user and 24 total; 4 KiB frames; 10 incoming ping frames/minute. No arbitrary WebSocket writes are accepted. Authorized `room.changed` hints trigger REST resynchronization, cursor pagination and recipient acknowledgements. Delivery means an authenticated client acknowledged receipt, not that a person read the text. Refresh recovers the authoritative history; drafts remain in memory across room switches and clear on logout.

Groups require owner invitations/removals. Invited users can read past room history; the UI states this. Promise attendees are a snapshot at confirmation. Later invitees do not acquire an old attendee's RSVP, and removed people cannot access or respond. Re-inviting an original attendee restores access to their own previously recorded response.

Synthetic candidates are persisted separately from confirmed promises. The UI asks **“이대로 확정할까요?”**; only the authenticated host's explicit CONFIRM creates a promise. Modify/ignore does not create one. Everyone, including the host, begins with RSVP pending and may answer only for themselves. Change/cancel first creates a host-bound, versioned, five-minute review; only explicit single-use approval applies it. A change resets responses to pending and preserves previous responses in history. Cancellation preserves records. No AI can confirm or RSVP for anyone.

The client builds text nodes, with no HTML interpolation, eval, local/session storage or third-party resources. CSP restricts scripts/assets to this server and sockets to its checked local origin. Request failures log only an opaque request ID/code, never bodies or credentials.

## Verify and recover

```powershell
node --test mvp/tests/*.test.mjs
node harness/check.mjs
node --test harness/check.test.mjs tests/ui-state.test.mjs tests/ui-static.test.mjs tests/ui-qr.test.mjs tests/ui-build.test.mjs tests/ui-pages-environment.test.mjs
node harness/check.mjs --release
```

Release failure is expected while the five legacy P0 risks remain OPEN; a structural PASS does not approve release. Browser evidence is separate from Node tests. Tests use disposable synthetic databases outside source control, real HTTP/WebSockets, separate server processes, forced crash/restart and backup restoration. Initial failures, fixes and fresh review belong in the incident journal and PM005 evidence bundle.

```powershell
node mvp/backup.mjs --db ../pm005/data/core.sqlite --output ../pm005/backups/core-backup.sqlite
node mvp/restore.mjs --backup ../pm005/backups/core-backup.sqlite --output ../pm005/restored/core.sqlite
```

Backups use `VACUUM INTO`; restore checks integrity/schema, refuses overwrite, and revokes restored sessions while retaining accounts, messages, promises, RSVP and history. Stop the server before switching its explicitly configured database. Keep originals until the restored data is verified. No rollback/deletion API is exposed.

The new workflow runs tests only, with contents-read permissions and no deployment environment/secrets/artifacts. Existing Pages source branch and workflow stay unchanged. Publishing a real backend, adding TLS/access controls, storage quotas, disk encryption, Windows ACL checks, operational monitoring, paid infrastructure or physical-device testing are separate work requiring approval. Current incremental hosting/API cost is **0**.
