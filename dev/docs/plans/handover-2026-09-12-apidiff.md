# Drive: get `apidiff` to report no behavioural difference against `origin/main`

Written 2026-09-12, end of the parity session. This supersedes
`handover-2026-09-12-parity.md` as the ENTRY POINT; that file is still the
reference for what was found and how, and is linked from here.

Branch `feat/strict-feature-layout-v0`, HEAD `ff7b3be926`, 2474 ahead of
`origin/main` and 13 behind. Tree clean, no active lanes.

## The objective, stated as a command

    .bin/apidiff/apidiff run -no-haven -main-ref origin/main -json -report <file>

Exit 0 = no behavioural difference. Exit 1 = differences found (that is the
INTERESTING state and we have never reached it). Exit 2 = the run could not be
completed — **this is where we are, and where we have been all along.**

## Measured state, run at the end of the session

    boot: prepare branch (--filter langwatch build): exit status 1
    EXIT=2

Identical to the first run of the session. **Thirteen commits of real repair
moved this number not at all**, and that is the single most useful fact here:
everything fixed so far was upstream of a gate apidiff checks first.

## apidiff's gate ladder — nothing later matters until the earlier one passes

1. **`pnpm --filter langwatch build`** in the branch worktree.  <- STUCK HERE
2. the same for the `origin/main` worktree
3. both stacks migrate, seed and answer health
4. probe the union of documented operations on both, in lockstep
5. compare statuses, shapes, validation envelopes, mutation outcomes

## Why gate 1 fails, precisely

~30 TypeScript errors in `sdks/typescript`, every one of the same shape:
`Property 'fields' does not exist on type ...`, `Property 'evaluators' does not
exist ...`, across `src/cli/commands/{test-suites,scenarios,run-plans,dashboard-widgets}`
and `src/client-sdk/services/*`.

The chain, which is NOT obvious and cost this session a lot of time to
establish:

    sdks/typescript's package.json `generate:openapi-types` generates
    src/internal/generated/openapi/api-client.ts FROM
    apps/api/src/features/discovery/openapi-document.json
      -> that document is FROZEN (its checker "NEVER writes it", by design)
      -> it predates the branch's REST declarations
      -> so the generated client types lack `fields` / `evaluators`
      -> so the SDK's own CLI code, which uses them, does not compile
      -> so `--filter langwatch build` fails
      -> so apidiff cannot boot the branch

**The SDK code is not wrong.** `modules/suite/contract/src/suite-evaluators.ts:84,122`
declares `fields: SuiteFieldDefinition[]`, so the branch really does model what
the SDK expects. The frozen document is simply stale. **Refreeze it; do not
"fix" the SDK to stop using the fields.** Deleting those usages would make the
build pass and silently drop published API surface, which is the exact
regression this drive exists to prevent.

## The one command between here and a refreeze

    pnpm --filter @langwatch/platform-api task openapi-generate /tmp/out.json

It reads every installed module's declarations and needs no database. It is
currently blocked by module-load errors, which it reports ONE AT A TIME — fix,
re-run, read the next. Last observed:

    Cannot find module '.../modules/model-provider/server/node_modules/@langwatch/prisma-client/src/generated/client.ts'

Note that one is a workspace-link / codegen problem, not a source problem
(`packages/prisma-client/src/generated/client.ts` DOES exist). Try
`pnpm start:prepare:files`, and `pnpm install` at the ROOT, before editing
anything. An earlier observed failure in this same loop was
`createRecordEvaluationsHandler` (see below).

### The three kinds of breakage behind that loop

All three are invisible to `pnpm typecheck`: an interface imported in VALUE
position satisfies the type system, then at run time node asks the real module
for an export erasure removed. Worked examples of each are in the tree.

1. **REPOINT** — the symbol exists elsewhere and the importer names the wrong
   module. Example `17d0a92311`: the two `GOVERNANCE_*` constants live in
   `@langwatch/enterprise-governance-contract`. Always check for this first
   (`grep -rn` the name); a second declaration would drift.
2. **RENAME** — a port kept its stripped name in the barrel while the interface
   took a role name. Examples `27edfffecf` (`LangyNavigateResource` ->
   `LangyNavigateResourceLocator`) and `8e9a05f43a` (`LangyTitleModel` ->
   `LangyTitleModelResolver`).
3. **DROPPED WHOLE** — the expensive one. `createRecordEvaluationsHandler` is
   missing from `modules/scenario/server/src/intents/simulation-run-execution.intent.ts`
   while its three sibling handlers survive. Original:
   `0bcf01edb3:platform/app/src/server/event-sourcing/pipelines/simulation-processing/process-manager/simulationRunExecutionIntentHandlers.ts:164`.
   Porting means adapting monolith imports to the module's vocabulary. It is
   also one of scenario's 22 test failures, so it pays twice.

A head-start list of 11 further symbols is in
`handover-2026-09-12-parity.md`. **It is a head start, not a bound** — it was
built by scanning only `app/*.members.ts` and `app/*.app.ts`, and cannot see a
dropped function in an `intents/` file. The generator's own error is the
authority.

## After the generator runs — the refreeze is a person's decision

Diff the generated document against
`apps/api/src/features/discovery/openapi-document.json` and commit the new one
deliberately, with the diff in front of you. Three routes serve that artifact
and both SDKs generate clients from it. **No lane may write it.** Expect the
diff to be large (the frozen file is 199-path-era; the branch declares far
more) and read it for REMOVALS above all: a path or field present in the frozen
file and absent from the generated one is a real regression, not a delta.

Then, and only then, gate 1 should pass and apidiff can be run for real.

## Method that actually finds parity gaps, while the stack is down

The merge kept tests and dropped implementations — tests are additive and merge
cleanly, logic conflicts and is resolved one way. So the branch's own test suite
is the best map of what parity is missing:

    pnpm --filter <pkg> test:unit 2>&1 | grep -E "ReferenceError|does not provide an export|is not a function|Cannot find module" | sort | uniq -c | sort -rn

Caveat learned the hard way: a test file that cannot LOAD reports zero tests,
not failures, and binds nothing. Confirm a test runs before citing it.

## Known remaining gaps, measured

    scenario-server      1014 passed / 22 failed   (6 of the 18 files are voice)
    governance-server      748 passed / 157 failed (all dropped exports/modules)
    langy-server           738 passed / 16 failed  (all createAppRestSecurity)
    analytics-server      1051 passed / 3 failed
    organization-server    243 passed / 0 failed
    pnpm lint            15,303 errors (was failing before, with plugin crashes)

## What a person must do, once

visualdiff cannot run until the portless CA is trusted. The cert is in the
login keychain but untrusted; neither tool sets `InsecureSkipVerify` or
`ignoreHTTPSErrors`, and `haven up` hangs forever on the prompt with no TTY:

    security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.portless/ca.pem

`visualdiff -no-haven` is NOT a way around it: only `havenPrepare`
(`tools/visualdiff/haven.go:133`) copies `.env` into the fresh worktrees.

## Exact next action

1. `pnpm install` at the repo root, then `pnpm start:prepare:files`, then re-run
   the generator. Resolve whatever it names, one at a time, by the three kinds
   above. Lane this: `.claude/manifests/apidiff-gate-1.md`.
2. Refreeze `openapi-document.json` from the generated document. Coordinator only.
3. `pnpm --filter langwatch build` must then exit 0.
4. Run apidiff for real. Exit 1 with a findings report is SUCCESS for this step.
5. Work the reported behavioural differences down to exit 0.
