# Handover: the parity drive with origin/main

Written 2026-09-12. Supersedes `handover-2026-09-11-merge-partial.md`, whose
subject — 754 unmerged paths — is **finished**: committed at `b5320f7103`,
`git ls-files -u` is empty, no MERGE_HEAD, dirty=0.

## The drive

Functional and visual parity with `origin/main`, measured rather than argued,
using the two tools built for it:

  .bin/apidiff/apidiff      live API behaviour, two refs in lockstep
  .bin/visualdiff/visualdiff 121 routes + 13 flows rendered on both refs

Branch is 2461 ahead of `origin/main`, 13 behind. Closing those 13 is the
coordinator's job, not a lane's, and has not been done.

## State of the machine (this was all absent; it is now set up)

- `haven` installed via `make haven install`; on PATH at `$(go env GOPATH)/bin`.
- `.bin/apidiff/apidiff` and `.bin/visualdiff/visualdiff` built from `./cmd/...`.
- `.env` **created from `.env.example`** — this checkout had none, which is fatal
  to both tools (`start:prepare:files` fails without it). It carries example
  placeholder secrets. `LANGWATCH_HAVEN_OBS=0` appended.
- colima started (haven-managed ClickHouse needs a runtime).
- Postgres/Redis are brew-installed but haven wants `postgresql@16` and the
  machine has `@14`; haven fell back to the `.env` URLs.

## The one thing a person must do

The portless CA is in the login keychain but **untrusted**
(`security verify-cert` → `CSSMERR_TP_NOT_TRUSTED`). Neither tool sets
`InsecureSkipVerify` or `ignoreHTTPSErrors`, so every HTTPS call into a haven
stack fails, and `haven up` hangs forever on the authorization prompt with no
TTY. One interactive command fixes it:

    security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.portless/ca.pem

`visualdiff -no-haven` is NOT a way around this: only `havenPrepare`
(`tools/visualdiff/haven.go:133`) copies `.env` into the fresh worktrees; the
port-based `prepare` (`run.go:507`) does not, so those stacks crash-loop.
`apidiff -no-haven` does work — it writes its own env overlay.

## What apidiff established before it could even probe

It failed in boot at `prepare branch (--filter langwatch build)`. The cause is
not the SDK. **Three files on this branch do not parse**, all broken by the
merge commit `b5320f7103`, each one fatal to every process importing its module:

  modules/scenario/server/src/services/scenario-execution-pool.service.ts:216
        `const next` declared twice; `startIdx` never declared
  modules/scenario/web/src/ui/sections/agent-testing/run/run-dialog.tsx:219
        Provider + Dialog.Body closed by a stray `</>`
  enterprise/modules/governance/server/src/services/openai-admin-puller.service.ts:955
        misplaced class brace; module-level declarations parse inside the class

Found with `./node_modules/.bin/oxlint modules enterprise apps packages` — the
whole tree has exactly these three and no others.

The scenario one is a dropped **feature**, not a typo. Main added a per-project
voice concurrency cap (`canStart` + `findIndex`/`splice` admission, so a voice
job blocked by its project cap does not starve a runnable job behind it). The
merge kept one orphan line of it and main's log string and dropped the policy.
The branch already has `modules/scenario/server/src/voice-concurrency-gate.ts`
and a fully bound spec, `__tests__/execution-pool-voice-cap.unit.test.ts`, which
cannot currently run. Reference: `git show
origin/main:platform/app/src/server/scenarios/execution/execution-pool.ts`.

## Shared file already repaired by the coordinator

`packages/architecture-enforcer/src/oxlint-baseline.json` was **invalid** — one
entry out of sort order at index 2331 — so every JS `defineRule` threw instead
of linting. Every architecture rule was silently enforcing nothing. Sorted in
place: 5671 entries in, 5671 out, no duplicates, all `measured` dates kept.
Uncommitted. **Commit this with the lane slices.**

## The REST comparison, and why it is not yet an answer

`origin/main`'s document is `platform/app/src/app/api/openapiLangWatch.json`
(199 paths). The branch's is `apps/api/src/features/discovery/openapi-document.json`
(369 paths). Normalising away `/api/v1`, `latest` and `2026-08-07`:

    183 of main's 199 paths served | 0 missing methods | 16 with no match

**Do not report those 16 as regressions.** The branch's document is frozen by
design — `apps/api/src/tasks/openapi-document/openapi-document.checker.ts` says
it NEVER writes it, and routes added since the freeze are absent from it. So it
under-describes what the branch serves. The 16 cluster as: trace REST
(search/{id}/share/unshare/transcript/track_event), langy control (6, and the
branch declares these at `/api/langy/control`, not `/api/v1/...`), analytics
dashboard-widgets (3, now tRPC-only on the branch — worth a real look), and `/`.

The authority is the generator, which needs no database:

    pnpm --filter @langwatch/platform-api task openapi-generate <out.json>

It is currently blocked by the parse errors above; it also needs
`pnpm --filter @langwatch/mcp-server build` first (done).

## Exact next action

1. Collect the two active lanes (see `.claude/coordinator/LANES.md`), verify each
   package's own checks yourself, commit by explicit pathspec **together with**
   the oxlint-baseline fix.
2. Re-run `./node_modules/.bin/oxlint modules enterprise apps packages` and
   confirm zero parse errors.
3. Run the OpenAPI generator and redo the path comparison against main's
   document. THAT is the functional-parity number; the 183/16 above is not.
4. Re-run `.bin/apidiff/apidiff run -no-haven -main-ref origin/main -json
   -report <file>`.
5. visualdiff only after the CA is trusted.

## Lane mortality

The previous drive lost 11 lanes in 13 spawns to 600s stalls. Keep lanes small,
tell them to verify each file as they finish it, and remember the salvage sweep:
a `UU` entry carrying no conflict markers is a dead lane's finished work.
