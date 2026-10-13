# PROMISE BOX UI preview rules

This is a public, synthetic-data-only static UI demo. The existing production app and the baseline harness remain separate. Rules are recorded in `harness/ui-preview-rules.json`; baseline rules in `harness/README.md` still apply.

## Publication boundary

- Publish only the `docs/` static artifact from the separate UI branch through the branch-restricted GitHub Pages Actions workflow. The isolated build directory may replace `version.json` and `release.mjs` metadata with the actual source SHA before artifact publication. Do not publish the repository root, server sources, journals, evidence archives or environment files.
- GitHub Pages may expose every published asset publicly. Use invented names, messages, appointments and invite payloads. Never add customer data or credentials.
- Keep Production, Railway, `main`, PR #1 and PR #2 unchanged. Inspect the actual Pages source and production deployment triggers before any branch publication.
- A paid plan requirement, missing Pages permission or unavailable free setup is a stop condition. Report it; do not create replacement paid infrastructure.

## Interaction boundary

The demo renders client-side state in memory. Refresh resets synthetic edits. It does not contact production or an AI provider, persist browser data, write a calendar, or register a service worker. An initial service worker is intentionally omitted so a previously cached demo cannot silently hide updates. Version and change history belong to the published static build. `LOCAL_PREVIEW` is permitted only as an explicit unpublished source marker; the published metadata must show the actual complete commit SHA and match both metadata files.

AI must display **“이대로 확정할까요?”**. Only the user's explicit confirmation creates an appointment. Editing or ignoring a suggestion creates none. A group organizer confirms the appointment; each participant independently accepts, declines or remains pending. Cancel and change actions require separate explicit confirmations. Switching chat rooms must preserve the current demo state for each room.

Invitation links and QR codes demonstrate the invite screen with synthetic payloads. They do not send invitations or grant production access. The install screen must accurately describe this initial demo's installation support; do not claim service-worker or offline support.

## Security and accessibility checks

`tests/ui-static.test.mjs` checks publication assets, CSP, executable assets and import paths, forbidden network/storage APIs, HTML injection sinks, potentially exposed credentials, version metadata, manifest paths, and palette contrast. It is a source policy check: it cannot authenticate data provenance or prove a browser's runtime behavior.

Use text nodes for all message, document and candidate values. Keep scripts and styles local; `connect-src 'none'` blocks network API calls. Avoid inline event handlers, inline executable scripts, `innerHTML`, `outerHTML`, HTML string insertion and executable URLs.

Use `--ink` for text on peach and apricot backgrounds. `--muted` is approved for paper and cream only. White text on `--deep` satisfies normal-text AA. A `--deep` focus indicator must contrast at least 3:1 with its surrounding background. Inspect rendered states, keyboard focus, accessible names, Korean line wrapping, minimum control size and reduced-motion behavior separately in the browser.

## Required execution evidence

```sh
node harness/check.mjs
node --test harness/check.test.mjs
node --test tests/ui-static.test.mjs
node --test tests/ui-state.test.mjs
node --test tests/ui-qr.test.mjs
node --test tests/ui-build.test.mjs
node harness/check.mjs --release
```

The release command is expected to fail while existing unresolved P0 risks remain. Record this as an intended release block and distinguish it from program errors. Do not change the risk list to make the command pass.

Record browser results for small and large phones, tablet and desktop; all ten required screens; confirm/edit/ignore; group RSVP; room switching; cancel/change; XSS text probes; console/network inspection; keyboard controls; contrast and version freshness. Mark checks that were not executed `NOT_RUN`. Review the final commit independently, compare changed paths with the permitted scope, and record the actual GitHub Pages URL only after deployment and a successful browser visit.

`tests/ui-browser-regression.test.mjs` is a browser-only suite, imported and called through the documented `cua_repl` tab API. Call `runUIRegression(tab, demoBaseUrl)` for 22 interaction assertions, and `checkScreenLayout(tab, demoBaseUrl, width, height)` after setting each viewport. It is deliberately excluded from the explicit Node CI command: a Node module load is not evidence of a browser test. Save its returned results and console observations separately. Browser checks require explicit dialog-close completion and evaluate visible/open dialog state rather than assuming closed elements disappear immediately. RSVP checks must read the actual state pill and exclusive aria-pressed value, rather than all action labels. Same-screen changes must retain keyboard focus so Tab continues from the selected action.

## Incident and rollback loop

Preserve redacted failing evidence before fixes. Record actual defects in the existing real incident journal, add a targeted regression test, rerun it, and obtain independent review. Test-only invented incidents must remain in temporary fixtures and must not pollute the real journal.

Rollback the static preview by republishing the prior reviewed UI commit through the same isolated Pages source. This requires no Production rollback. Verify the visible version after publication. Branch history is the rollback source; no application database or browser persistence is involved.

## Build isolation and QR attribution

`scripts/build-ui-preview.mjs` accepts a new or empty output directory outside the checkout. It rejects output overlap, path symlinks, stale files, unapproved publication types, sensitive filenames and recognizable credentials before copying assets. Use a fresh output path for every local build. The CI Pages workflow publishes the isolated runner-temp artifact only after the baseline harness and all UI regression suites pass. `tests/ui-build.test.mjs` verifies these failure modes with synthetic fixtures and proves that metadata files contain the exact CI source SHA while other UI asset bytes remain unchanged.

The QR matrix factory in `docs/vendor/qrcode.mjs` retains **Copyright (c) 2009 Kazuhiko Arase**, the upstream attribution to `http://www.d-project.com/`, and the complete MIT permission and warranty notice in the publicly distributed source. The local adapter creates passive SVG nodes from its matrix. `tests/ui-build.test.mjs` checks the published attribution and license notice; `tests/ui-qr.test.mjs` checks QR behavior. The copyright and permission notice must remain in all copies or substantial portions of this dependency. No upstream version is asserted here without separately preserved provenance.
