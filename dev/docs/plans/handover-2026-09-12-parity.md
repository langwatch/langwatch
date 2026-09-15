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

## What has landed (this session)

    1d758e09e0  governance puller parses; oxlint-baseline.json valid again
    70960d916f  scenario module parses, loads, admits voice runs under main's cap
    85f6595385  topic barrel points at where its interfaces went
    1afba5a3ba  pulled usage carries the provider's own currency again
    aaecc74349  interfaces imported as values become type imports (176 files)
    27edfffecf  the same rule across package and subpath boundaries (50 files)
    c233060756  this handover

Measured: scenario-server went from every file crashing at import to 1014
passing / 22 failing. governance openai-admin-puller 38/41 -> 41/41.

## The method that is actually finding parity gaps

Not apidiff, which has still never probed an operation. The branch's own test
suite. The merge kept tests (additive, they merge cleanly) and dropped
implementations (they conflict and get resolved one way), so **a test asserting
a field production code never mentions marks a lost feature.** That is how the
multi-currency money model was found. Run a package's suite and read the
failures by cause:

    pnpm --filter <pkg> test:unit 2>&1 | grep -E "ReferenceError|does not provide an export|is not a function|Cannot find module" | sort | uniq -c | sort -rn

**Caveat, learned the hard way:** a test file that cannot LOAD reports zero
tests, not failures, and binds nothing. `pulledUsageCurrency.unit.test.ts` and
`signedPulledMoney.unit.test.ts` are verbatim main ports importing an `@ee/...`
alias this branch lacks. Before citing a test as evidence, confirm it runs.

## Known remaining gaps, with evidence

- **governance server: 158 failures / 44 files**, all one class - symbols the
  merge dropped. By count: `createRestApiService` (22), `isDataverseEnvironmentOrigin`
  (15), `adapter.fetchAzureCostPages` (8), `createAppRestSecurity` (5),
  `resolveSourceNonBillable` (3), and missing modules `~/utils/ssrfProtection`,
  `src/services/pullerWorker`, `src/repositories/prisma/ingestionCredentials`.
- **scenario: 22 failures / 18 files**, six of them voice (`execution-pool-voice-cap`,
  `execution-pool-voice-filter`, `resolveVoiceTarget`, `voice-agent.adapter`,
  `voiceTargetSchema`, plus a ClickHouse filter expecting `ScenarioSetId != 'voice-calls'`).
  Main's voice-agent feature is substantially absent here. Causes: `beforeEach`
  and `makePrisma` not imported, `buildChildEnvironment` and
  `createRecordEvaluationsHandler` not exported.
- **`execution-pool-voice-cap.unit.test.ts` is mis-ported** - it imports its pool
  from `./execution-pool.unit.test.ts`, which exports nothing, and uses main's
  OLD constructor API. The behaviour IS implemented and was verified by driving
  the real service through all five scenarios. Fix the test to
  `ScenarioExecutionPoolService.create({...})` + `pool.connect({...})`.
- **The voice gate is not wired into the worker.** `apps/worker/src/app/worker-production.composition.ts:919`
  needs `voiceGate: new VoiceConcurrencyGate({ max: voiceRunsMaxConcurrent() })`,
  and `modules/scenario/server/src/index.ts` must export the gate. Coordinator-owned.
- **`pnpm lint` fails with 15,303 errors.** It was failing before too, with every
  file throwing a plugin crash; the baseline fix turned spurious crashes into
  real violations. Top rules: comment-block-size (6953), fallible-result-naming
  (1980), logical-statement-spacing (1374), package-boundaries (637).
- **pulled-usage-record: 9 failures** are ADR-128 `governanceProjectId` / ADR-129
  `rawActorId`, a DIFFERENT dropped feature from the currency one.

## Exact next action

1. **Finish the boot chain.** The objective is still the single highest-leverage
   command in the repo:
   `pnpm --filter @langwatch/platform-api task openapi-generate /tmp/out.json`
   It now clears topic, automation, coding-agent and data-privacy, and fails on
   CROSS-PACKAGE imports the sweep did not touch - first
   `@langwatch/dataset-contract` / `DatasetNormalizePayload`.

   The fault class, and why nothing catches it: an interface imported in VALUE
   position typechecks fine (the type system is satisfied) but at run time node
   asks the real module for an export that erasure removed, and you get
   `SyntaxError: does not provide an export named X`. `pnpm typecheck` will
   never find these. The sweep fixed every RELATIVE one inside module server
   packages; extend the same rule to `@langwatch/*` workspace imports by
   resolving each package's `src` and testing whether the symbol is declared
   `export interface` / `export type` there. `langwatch(type-only-value-import)`
   tracks the class: it went 495 -> 297.

   **That sweep is now DONE for every boundary** - relative, `@langwatch/*` and
   `#*` subpath (commits aaecc74349 and 27edfffecf). What blocks the generator
   now is a different and final class, enumerated below. The remaining 297 lint
   findings are in files the generator does not reach; they are debt, not this
   critical path.

## The last boot-chain class: ports that folded into Infrastructure

24 symbols are imported from a module's `app/*.members.ts` or `app/*.app.ts` and
declared in neither. They are NOT renames and NOT type-import problems. Commit
`0611c343fe` records what happened - "nine ports and the four invite ports fold
into OrganizationInfrastructure" - so each became a FIELD on its module's
Infrastructure interface and its importers were never updated. Each is a small
design decision (reference the field's type, or restore the interface), which is
why this is lane work rather than a sweep.

    DONE in 17d0a92311: all ten organization symbols, restored verbatim from
        `git show '0611c343fe^:modules/organization/server/src/app/organization.infrastructure.ts'`
    DONE in 17d0a92311: both GOVERNANCE_* constants - they needed a REPOINT to
        @langwatch/enterprise-governance-contract, not a restore

    ALSO DONE: LangyTitleModel (a rename to LangyTitleModelResolver, 8e9a05f43a)
        and the aliased-import blind spot in scenario's cancellation repository.

    **The list below is NOT the whole remaining set.** It was built by scanning
    only `app/*.members.ts` and `app/*.app.ts`, and the generator has since
    surfaced a symbol outside it (`createRecordEvaluationsHandler`). Treat the
    generator's own error as the authority and this list as a head start.

    A THIRD kind has now appeared, and it is the expensive one. Not a repoint
    and not a one-line restore: a FUNCTION that was dropped whole.
    `createRecordEvaluationsHandler` is missing from
    `modules/scenario/server/src/intents/simulation-run-execution.intent.ts`,
    which still has the other three handlers. Its original:
        0bcf01edb3:platform/app/src/server/event-sourcing/pipelines/simulation-processing/process-manager/simulationRunExecutionIntentHandlers.ts:164
    Porting it means adapting monolith imports to the module's vocabulary. It is
    also one of scenario's 22 test failures, so it pays twice.

    STILL OPEN from the original scan (11):
    AutomationDispatchError, AutomationGraphNotifier, AutomationHeartbeat,
    AutomationLogger, AutomationSlackBotTokenDecryptor,
    AutomationNotificationDelivery
        modules/automation/server/src/app/automation.members.ts
    AutomationProjectIdentity, AutomationWebhookStoredParams
        modules/automation/server/src/app/automation.app.ts
    LangyTitleModel                  modules/langy/server/src/app/langy.members.ts
    CodingAgentTraceProcessing       modules/coding-agent/server/src/app/coding-agent.members.ts
    ModelProviderCaller              modules/model-provider/server/src/app/model-provider.app.ts
    TenantClickHouseClientResolver   modules/data-retention/server/src/app/data-retention.app.ts

Regenerate the list: for each `import {...} from ".../app/*.members.ts"`, check
each name against the target's own `export` declarations. Low false-positive,
because members files never `export *`. (A wider scan over ALL relative imports
reports ~317 and is mostly noise - it cannot follow `export *` or barrel chains.
Trust the narrow one.)

The generator currently dies on `LangyTitleModel` and will name these one at a
time; the list above is the whole set, so fix them in one pass.

Worked example, already landed in `27edfffecf`: langy's `LangyNavigateResource`
was `export abstract class LangyNavigateResourcePort` before `f054ab2baf`, became
the interface `LangyNavigateResourceLocator`, and its barrel, its fallback
service and the API adapter were never told - the adapter still said `extends` a
thing that had become an interface, while the module's own test already said
`implements`, which is what settled the intended shape.
2. When that command exits 0, **refreeze the document**: diff the generated file
   against `apps/api/src/features/discovery/openapi-document.json` and commit
   the new one deliberately. That is a person's decision, never a lane's.
3. The refreeze unblocks a chain: SDK client types stop missing
   `fields`/`evaluators` -> `sdks/typescript` builds -> `packages/observability`
   resolves the `langwatch` types -> every `pnpm typecheck:one` stops failing
   upstream -> apidiff can boot.
4. THEN redo the path comparison against main's document. The 183/16 figure in
   the section above is measured against the FROZEN artifact and is not an
   answer.
5. `.bin/apidiff/apidiff run -no-haven -main-ref origin/main -json -report <f>`.
6. visualdiff only after the CA is trusted (see the section above).

## Lane mortality

The previous drive lost 11 lanes in 13 spawns to 600s stalls. Keep lanes small,
tell them to verify each file as they finish it, and remember the salvage sweep:
a `UU` entry carrying no conflict markers is a dead lane's finished work.
