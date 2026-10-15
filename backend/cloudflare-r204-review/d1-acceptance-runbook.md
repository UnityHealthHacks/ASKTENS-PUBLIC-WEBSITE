# Manual staging runbook for `d1-acceptance-worker.mjs` (review-only; nothing here has been run or deployed)

Scope: a **separate throwaway Worker** in the nonproduction account, bound only to the disposable D1 database (`tens-r212-disposable-test`). Never add this entrypoint to `tens-api`, never attach a route or custom domain, never bind `DB`, `TENS_PUBLIC_JOBS` or any protected database. The entrypoint refuses if a forbidden binding exists.

## Configuration (owner sets in the Cloudflare dashboard; no secret goes in git)
| Name | Kind | Meaning |
|---|---|---|
| `ACCEPTANCE_DB` | D1 binding | the disposable database only |
| `EXPECTED_D1_UUID` | var | its UUID; must equal `approval.databaseId` |
| `EXPECTED_ACCOUNT_ID` | var | 32-hex Cloudflare account id (recorded for the receipt; the Worker cannot verify it) |
| `PROTECTED_DB_UUIDS` | var | comma list of protected database UUIDs (`tens-research-jobs`, `tens-state`) |
| `APPROVAL_JSON` | var | `TENS_D1_ACCEPTANCE_APPROVAL_V1` object with a window of at most 4 hours |
| `ACCEPTANCE_AUTH_SHA256` | var | SHA-256 hex of a random bearer token the owner keeps privately |
| `ACCEPTANCE_MAX_MODE` | var | unset = preflight only; `readonly` allows `/readonly` |

## Calls (all POST, empty body, with an Authorization header using the ****** and your private token)
- `/preflight`: no D1 I/O. Returns `NOT_RUN_NO_REAL_D1_PROOF` plus configuration problems.
- `/readonly`: SELECT/PRAGMA classification only, after every configuration check passes.
- `/mutate`: always `403 MUTATION_DISABLED_IN_THIS_ENTRYPOINT`. Fixture mutation stays off until a separate reviewed change and an independent provider-side witness exist.

## Interpretation
Every response has `realD1Proof:false`. Matching UUIDs in `env` are configuration, not proof. Real evidence is Cloudflare-side: the dashboard database id, account audit and request logs, taken by the owner. Delete the Worker after use.

## Owner-local one-shot invocation (`tools/d1-acceptance-invoke.mjs`; review-only, not run)
Purpose: call `/preflight` or `/readonly` without the token ever appearing in argv, environment, git, logs or receipts. There is no mutate path in this tool; `/mutate` stays 403.

1. Write an owner config JSON outside git with: `accountId`, `observedAccountId` (read separately from the Cloudflare dashboard session, must equal `accountId`), `protectedAccountIds`, `databaseId`, `expectedDatabaseId`, `protectedDatabaseIds`, `workerName`, `workersDevSubdomain`, `consentExpiresAt` (at most 1 hour ahead) and `consent` = `INVOKE <mode> <workerName> <accountId>` for the single mode you intend.
2. Pipe the token from your own protected store on stdin only, for example on Windows: `<your DPAPI unprotect command> | node tools/d1-acceptance-invoke.mjs --token-stdin --mode readonly --config C:\private\cfg.json --receipt new-receipt.json`. The tool never reads a token from argv or env, refuses redirects, scrubs the token from replies and errors, and writes the receipt with exclusive-create.
3. Exit 0 means the Worker replied with an acceptable non-proof report. The receipt always says `realD1Proof:false` and `independentWitness:REQUIRED_NOT_PROVIDED`.

The tool compares owner-supplied pins with each other. It cannot verify the account or database; only the Cloudflare dashboard, audit log and request logs can. A real mutation-scenario proof needs a separately reviewed adapter and an independent provider-side witness, which this change does not provide.

## Later verified deployment status — October 14, 2026 (AG181)

This runbook originally described an unexecuted review-only staging plan. Subsequent machine evidence records that the **separate disposable** `tens-r212-d1-isolated-test-20261014` Worker was deployed with only `ACCEPTANCE_DB` bound to disposable D1 `tens-r212-disposable-test` (UUID `3fe4cf59-ccc9-4306-a3ad-4bcbd67a8a42`). The Worker was restored to the read-only version `222de455-28c4-459e-a4d7-4e28643573a0`; `/mutate` returned HTTP 403. The reported disposable database readback was 0 jobs, 0 nonces, 1 marker, and 0 spent runs. Machine receipt: `R212_AG181_CLOUDFLARE_ONE_TIME_HOLD_SAFE_RESTORE_20261014_A.json`, SHA-256 `704482744de68f1eff0c1af4da16c96c056374323d9f386e9abb6187909a7026`.

**Proof boundary:** 12/12 read-only HTTPS checks and 17 Cloudflare SQL-console steps were reported; 3/3 mutation candidate tests were offline only. No independently witnessed real Worker-side mutation/concurrency/rollback acceptance is established. Do not infer authorization to redeploy, attach a production route, modify credentials, invoke mutation, or change D1 bindings. The separate real-D1 acceptance gate remains **HOLD**. This is a historical status clarification, not a deployment instruction or a change to the fail-closed controls above.
