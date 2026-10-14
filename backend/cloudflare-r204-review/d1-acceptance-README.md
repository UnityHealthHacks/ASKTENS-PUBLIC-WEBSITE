# D1 acceptance harness (review-only, staging-only contract)

`d1-acceptance-harness.mjs` is **not executed anywhere against Cloudflare**. The offline test (`tests/d1-acceptance-harness.test.cjs`) uses a SQLite shim, which proves harness logic only and is never a real D1 roundtrip.

Modes: `preflight` (default, never touches a binding), `readonly` (SELECT/PRAGMA only), `mutate`.

## What the owner must provide separately (nothing is inferred from names)
1. A pre-existing, disposable, **empty-queue** nonproduction D1 database with the additive migration already applied by the owner. The harness never migrates.
2. In that database, one table `tens_acceptance_marker(database_id, environment, approval_nonce)` with exactly one row: the database id, `NONPRODUCTION_DISPOSABLE`, and the approval nonce.
3. An approval object (`TENS_D1_ACCEPTANCE_APPROVAL_V1`) with `databaseId`, `databaseName` (never `tens-research-jobs`), non-empty `productionDatabaseIds` denylist, `approvedBy`, `approvalNonce` (16+ chars), a window of at most 4 hours, and for `mutate`: `mutationsApproved:true`, `runId` (8 hex) and `approvalDigest` = SHA-256 of the canonical approval without the digest (`approvalDigest()`).
4. A throwaway Worker in a nonproduction Cloudflare account/project, bound to that database, that imports the harness and calls `run({mode,db:env.DB,config,runId})`. Do not add the binding to the live `tens-api` Worker.

## Result meaning
- `NOT_RUN_NO_REAL_D1_PROOF`: default. Nothing proven.
- `SCENARIOS_PASSED_BINDING_NOT_WITNESSED_AS_CLOUDFLARE`: scenarios passed on a supplied binding; this is **not** independently verified real Cloudflare D1 evidence, even when executed inside a Worker.
- **No internal success code proves genuine Cloudflare D1 tenancy, nonproduction identity, custody or owner authorization.** Browser-like `navigator.userAgent`, a SHA-256 over caller-supplied approval fields, and a marker row in a caller-supplied database can all be reproduced by a local SQLite shim. The original `PASS_REAL_D1_WITNESSED_NONPRODUCTION` result is intentionally removed because the old guard could be spoofed in unit tests. The harness always emits `realD1Proof:false`; an independently authenticated external Cloudflare-side witness, matching account/database identity and immutable provider run logs, is required for any later acceptance decision.
- Do not interpret the report SHA-256 or approval SHA-256 as a signature, independent owner approval, or source-byte proof.
- `REFUSED` / `HOLD` / `FAIL` never imply any queue property.

Mutating scenarios only write rows with ids `R203WEB_ACPT<runId>…` and nonces `acpt-<runId>-…`, using a synthetic clock, and delete exactly those ids afterwards. The harness refuses a database with any QUEUED/RUNNING row because `claim` is not namespaced. It does not call `expireStale` directly (claim does, with the synthetic clock). It does not change R212 admission or any source claim.
