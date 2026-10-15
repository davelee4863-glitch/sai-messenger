# PROMISE BOX UI V2 candidate

Base: `2c3653d2a490ed7666723ba42c96e3c0236f64d6` (PR #8).
Branch: `ui/promise-box-emotional-v2-20261015`.

The separate `preview-v2/` contains only a static synthetic demo. The public
V1 `docs/`, its publishing workflow, Node MVP and Cloudflare runtime are preserved.
Exactly three main destinations remain: 채팅, 약속함, 일정.

Official slogan: **일정은 잊지 않게, 마음도 잃지 않게.**
The two family illustrations are the owner's existing approved PNG originals.
Their hashes and dimensions are in `preview-v2/brand-assets.json`.
Provenance chunks remain; the images were not regenerated or edited.

Both simulated roles must explicitly confirm the same 1:1 proposal revision.
One confirmation remains waiting and does not create a final promise.
Changing a final schedule holds the previous payload until renewed agreement;
negotiation invalidates prior confirmation. Group host confirmation is separate
from each role's going, declined and unanswered RSVP. Every role control is
labeled as a demo. Reload resets synthetic examples; there is no server save.

## Validation and publication boundary

`node harness/ui-v2-ci.mjs` runs the existing discovery runner and separately
enforces all465 original cases, all33 original test files and exact baseline
sources. New V2 cases are counted separately. Browser and actual mobile/cloud
checks are reported independently; they cannot be inferred from Node PASS.

`scripts/build-ui-v2.mjs` creates a separate artifact of exactly14 reviewed
static files, validates image hashes and stamps its source SHA. Backend files,
DB files, external requests, unsafe HTML and unreviewed files are rejected.
The source metadata says LOCAL_PREVIEW until an artifact is stamped.

The new CI has read-only repository permission and prepares a generic candidate
artifact. It has no Pages or Cloudflare deployment step, cloud credentials or
write permission. No production settings or resources are changed.

Publication is **BLOCKED pending explicit owner approval after independent
review** (PM020 section4). A later approved Pages-only operation must validate
the exact candidate SHA and the github-pages environment branch restrictions,
then publish only the reviewed artifact at the existing URL. Preserve the
V1 source commit for a separately approved rollback. No main or existing PR
merge is required. Cloudflare deployment remains separately BLOCKED.

Actual Android/iPhone tests and public V2 HTTPS checks remain NOT_RUN until
performed. Existing live Cloudflare inventory/IAM remains UNVERIFIED. The
five legacy Railway P0 risks and incident14 remain unchanged and OPEN.

Initial failure evidence and browser captures stay outside the public repository
under the local PM020 evidence directory. No raw account inventory, database,
private source path or secrets are included in this candidate.
