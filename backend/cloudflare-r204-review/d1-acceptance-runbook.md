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
