# Operations the branch documents but does not serve — re-measured 2026-09-16

Supersedes `dev/docs/plans/unserved-documented-operations-2026-09-14.md`.

> **Correction, 2026-09-16 (later the same day): the counts below are not
> evidence.** Every Sep-16 run — r4, r5 and r6 — exited 2 with `CREDENTIAL
> LOST`, and r5 is the run this document was written from. r4 lost the project
> key before the first probe; r5 and r6 lost the **organization key** partway
> through, on the base. apidiff's own verdict says what that means: "this run's
> counts are not comparable with any other run: probes made after the loss
> compared a dead credential, and their agreement is not evidence."
>
> The cause is found and fixed. Probe #216 issued
> `DELETE /api/scim/v2/Users/local-dev-admin-user`; the base answered 204, and
> the organization bearer hangs off that user. Every organization-door probe
> after it answered 401 **on the base** — teams, groups, webhooks and the
> organization family, eighteen operations — which reads as the branch having
> gained behaviour it has not. `self-protection.go` guarded the project, team
> and organization kinds; a user was not a kind at all. It is one now, with a
> sacrificial user for destructive probes to be retargeted at, so coverage is
> kept whole. **Re-run apidiff before trusting any number in this document.**
>
> Read `a` as the CANDIDATE (the branch) and `b` as the BASE (main):
> `cli.go` defines `-a` as "candidate (after)" and `-b` as "base (before)",
> and `ledger.go` writes `SideStatus` as `[base, candidate]` from `{B, A}`.
> Reading them the other way round inverts every finding.

**The method changed, and it is stronger.** The Sep-12 and Sep-14 measurements
diffed two OpenAPI *documents*. This one diffs two *running instances*: an
`apidiff run` booted `origin/main` (`7b5e10e7ae`) and the branch
(`395125a55e`) side by side and probed the union, so an operation counted
absent here was actually requested and actually not answered — a published
family that does not work can no longer read as served, and a served family
that nobody documented can no longer read as missing.

Artefacts: `.apidiff/report-20260916-r5.json`, `.apidiff/ledger-20260916-r5.json`.

## Status after the first two valid runs (r8, r9)

r7 died at `pnpm install --frozen-lockfile` on a lockfile that had been
committed without `@langwatch/api-client-web`. r8 and r9 are the first runs
since Sep 14 whose credentials all survived, so their counts are the first that
mean anything.

| | r6 (invalid) | r8 | r9 |
| --- | ---: | ---: | ---: |
| differing operations | 94 | 89 | **81** |
| distinct causes | 24 | 21 | 17 |

Closed, each confirmed by a run rather than by reading the code:

| cause | closed by |
| --- | --- |
| `status-class-mismatch:401-200` / `401-201` (5) | nothing — they were the dead organization credential, and vanished once the SCIM probe stopped deleting the user it hangs off |
| `permission-diff:404-500` (2) | scenarios throwing `ScenarioNotFoundError` instead of downgrading it |
| `not-found-as-500:404-500` (3), `status-class-mismatch:200-500` (1), `mutation-not-visible` (1) | `SuiteService.testSuiteToSuite` no longer handing a test-suite row to the strict suite schema |
| `handled-refusal-degraded:403-500` (2) | `AnalyticsApp` implementing `assertCustomChartPlaygroundEnabled` over the peer APIs it already held |

Two classes that are **not** defects, checked against the transcripts rather
than assumed:

- **`permission-leak` (4)** — no tenant data crosses. `model-providers`
  returns the caller's own catalogue on both sides; the branch adds an `id`
  (`system_anthropic`) on rows that are global catalogue entries, and
  apidiff's heuristic reads a newly-exposed id as a leak. `model-defaults`'
  id is an organization-scoped default read by a key inside that
  organization. `prompts/tags` is identical on both sides.
- **`permission-diff:200-403` / `200-404` (4)** — the direction is main 200 →
  branch 403/404 for a FOREIGN key. `GET /api/secrets` answering 200 to a key
  from another organization is a leak the branch closed.

### The one behavioural difference left, and why it is not a wiring fix

`GET /api/simulation-runs` answers 503: the scenario module mounts
`createSimulationRunsRest()` while `simulations` is a collaborator no process
supplies, which `scenario.server.ts`'s own comment admits. Composing it
read-only (the chosen shape) needs a `SimulationWindowedRepository`, and no
production implementation exists — only test doubles that ignore `fallback`
entirely. The shared policy it is meant to adapt is `TraceWindowedReadService`,
which lives in **modules/trace**, and a module may reach a peer only through
the peer's `*Api` token. So the honest order of work is: extract the shared
partition-window read policy (ADR-067) into a package both modules import,
then adapt it for scenario, then compose the ClickHouse read repository and add
`clickhouse` to `ScenarioApp.reads`. Inventing a window policy here would
silently decide how much ClickHouse every simulation read scans.

## Totals

| | Sep 12 | Sep 14 | Sep 16 |
| --- | ---: | ---: | ---: |
| union operations | — | — | 340 |
| probed | — | — | 210 |
| genuinely unserved | 70 | 65 | **44 probed-and-absent** |

The Sep-16 number is not the same measurement as the earlier two and should not
be read as a burn-down against them: it counts operations the run actually
probed and found absent on the branch, not operations one document names and
another does not.

## Two open questions from Sep 14, now closed

- **The enterprise-tier generator works.** Sep 14 could not confirm whether
  `LANGWATCH_BUILD_TIER=enterprise node dev/scripts/generate-modules.mjs` still
  failed on `Cannot find package '@langwatch/enterprise-licensing-server'`
  (reported Sep 12). Re-run today on a clean worktree: it succeeds and emits
  `scimServer` into `modules/server-modules.generated.ts` (48 modules against
  the core build's 46). **SCIM's 18 operations are a build-tier artefact of
  comparing an OSS-tier branch against a monolith that had no tier split — not
  a regression.** ADR-144 §6 is the governing rule: enterprise entries are
  emitted only in the enterprise build, "so the OSS output has no enterprise
  import at all."
- **The api process boots.** Sep 14 recorded `pnpm dev:api` dead on
  `AuthzApi is not defined` (`gateway.app.ts:477`), which blocked every live
  check that session. The branch instance booted cleanly in today's run
  (`ready at http://127.0.0.1:62386`), so that failure is gone and live
  verification is possible again.

## Closed this session

- **`POST /api/events/track`** — Class C, fixed in `2722423f6f`. `TraceApp`
  gained the four members the declaration always named
  (`assertPredefinedEventPayload`, `generateEventId`, `reportError`,
  `recordTrackedEvent`) and `trace.server.ts` now declares `trackedEventRest`.
  Guarded by `transport/__tests__/tracked-event.rest.declaration.unit.test.ts`,
  which fails on removal of the declaration.

## Two blockers that are not per-module work

**1. No app can replay a request, so neither legacy alias can mount.**
`trackedEventLegacyPathRest` (`POST /api/track_event`) and
`experimentV3AliasRest` (`/api/evaluations/v3`) are both written, both exported,
and both undeclared, for the same reason: each needs an app member
`forward(request: Request): Promise<Response>` that dispatches back into the
mounted family, and **nothing in the repository implements one**. The spec is
explicit that the alias must replay rather than handle
(`specs/api-reference/tracked-event-validation.feature`: "two handlers over one
recorder drift the first time one of them gains a check the other does not"), so
a second handler is not an acceptable shortcut. One mechanism unblocks both.

**2. `withTransports(...)` cannot express a conditional registration.**
The pre-conversion mounts registered a route only where the process had the
collaborator behind it — `apps/api/src/features/trace/traces-rest.mount.ts` at
`b383462d96^`: the metadata amendment is "absent where this process registered
no command queue, and then `PATCH /:traceId/metadata` is not registered at all
rather than answering 200 to a write it dropped." `defineServerModule`'s
`withTransports(...transports)` takes a static list with no predicate, so the
new shape has nowhere to put that condition. This is why several Class D routes
were dropped rather than ported, and it is a framework gap, not a module one.

Note the interaction with the tracked-event fix above: `trackedEventRest` is now
declared unconditionally and `recordTrackedEvent` refuses at request time with
`TraceIngestionUnavailableError`, exactly as `recordCapturedSpan` does for the
collector. **But the transport's handler catches that throw, logs it, and still
answers `200 "Event tracked"`** — so on a process with no recorder the route
answers success to a dropped write, which is the failure the rule above exists
to prevent. Making that refusal loud is a one-line change in
`transport/tracked-event.rest.ts`, which is lane-owned at the time of writing.

## A knowable refusal reaching the customer as "unknown"

Four operations survive the correction above and are real. The branch answers
`500`/`503` with `{"code":"internal_error","message":"An unknown error
occurred"}` where main answered the code the caller can act on:

| operation | main | branch |
| --- | --- | --- |
| `GET /api/scenarios/{id}` | 404 | **500** |
| `GET /api/test-suites/{id}` | 404 | **500** |
| `DELETE /api/test-suites/{id}` | 200 | **500** |
| `GET /api/simulation-runs` | 200 | **503** |

The cause is the one `dev/docs/best_practices/error-handling.md` already names:
these routes throw plain `Error` subclasses — `ScenarioRestNotThereError
extends Error`, `SuiteAliasNotFoundError extends Error` — for causes we know
and the caller can act on. A plain `Error` correctly degrades to "unknown", so
the boundary is behaving exactly as designed; what is missing is the
`HandledError`.

**The fix is to throw a `HandledError` with a stable `code` where we know the
cause, and nothing else.** No new seam, no per-family renderer: throwing a
handled error is all that is needed to return an error properly, and the
canonical boundary already renders it with the code, meta and remediation
intact. Each new code needs its entry in `packages/handled-error/src/app-codes.ts`
and in the presentation registry, in the same change.

The eleven per-family REST error handlers the modules export
(`trackedEventRestErrorHandler`, `scenarioRestErrorHandler`,
`suitesAliasErrorHandler` and the rest) are bound by nothing but their own
tests. They predate that rule and answer bespoke `{ error }` bodies. They are
residue to delete once the refusals above are handled errors — not a gap to
wire up. An earlier draft of this document proposed adding a `withErrorHandler`
seam to carry them to the mount; that was rejected, and correctly: the platform
is deliberately consistent and simple, and this would have entrenched the shape
the house rule replaced.

## Reclassified

- **`GET /api/traces/{traceId}/transcript` is not a gap.** The pre-conversion
  mount names it a deliberate absence: "the coding-agent transcript join is not
  supplied because `composeApiTraceReadStack` refuses
  `LogService.getLogsByTraceId` by name, and deriving a transcript without it
  would answer an empty one for every trace." It was unserved before the
  conversion too. Exclude it from the count rather than porting it.
- **`GET /api/trace/{id}`, `POST /api/trace/search`** are alias consolidation,
  not removals: the branch serves `/api/traces/{traceId}` and
  `/api/traces/search`, and main served both spellings.
- **`{id}` → `{projectId}` on the projects family** remains a parameter rename,
  same URLs — as Sep 14 already corrected.
- **Root `GET /`, `POST /`** remain a monolith document artefact.

## Remaining, by class

Classes as defined in the Sep-14 document.

| module / family | count | class | note |
| --- | ---: | :---: | --- |
| scim | 18 | A | **not a gap** — emitted at enterprise tier (verified today). `scim.app.ts:175` already refuses `plan_not_entitled` per organization, which is the intended shape: mounted, and refused per-org. |
| governance | 7 | B | `governance.server.ts` exists but exports worker factories, not a `defineServerModule` installer, so the generator skips it at every tier. Its package also carries 3 unresolved imports (`@ee/event-sourcing/…` ×2, `~/generated/prisma/client`). Module conversion. |
| dataset direct-upload | 5 | D | recipe at `b383462d96^`. The branch adds `/api/stored-objects/storedObjects.*`; confirm whether the upload flow moved there deliberately before porting. |
| langy control | 4 | B/C | needs `withTransportFacts` bindings the process refuses to boot without; the branch adds `/api/langy/conversations`, so confirm this is not a deliberate redesign before porting. |
| scenario-events | 3 | C | Closer than Sep 14 recorded: `ScenarioApp` **already holds** `simulations`, `scenarioTabs` and `broadcast` (scenario.app.ts:105-127, wired from `setup.members`), and `platformUrl` is already `ScenarioApi`'s. Only `extractInlineMedia` is unaccounted for — and the walk it names lives in `modules/trace/server/src/services/content/trace-content-extraction.service.ts`, inside **trace**, while the transport's comment says it is "the stored-objects vertical's". Scenario depends on neither. Blocked on where that walk belongs, not on wiring. |
| gateway providers | 4 | — | **closed** (`60708e784f`). Main's four were tombstones: 410 `gateway_provider_bindings_gone` naming the model-provider address that replaced them. The code and its customer copy were already ported and thrown by nobody; the branch now declares the four routes and throws it. |
| `/api/track_event` | 1 | C | blocked on blocker 1. |
| teams | — | C | listed Sep 14 (9 operations); **not** among today's probed-and-absent set. Re-measure before acting. |

## Checks

- `apidiff run -no-haven -branch-dir <clean worktree>` — exit 2 on a credential
  loss, not on differences. `-no-haven` boots the branch side from
  `-branch-dir` itself, so point it at a clean worktree, never a dirty checkout.
- Credential health is in `credentialChecks` in the report, `[base, candidate]`.
  Read it before reading any count: a run whose project key died compares two
  refusals and its agreement means nothing.

## `GET /api/simulation-runs` — why the 503 is not a wiring change

The windowed-read seam that first blocked this is gone: the partition-window
policy now lives in `@langwatch/clickhouse-client` (`801acfe7fe`), and
`SimulationClickHouseRepository.create(resolveClient)` takes no collaborator.
The route still 503s, for a different and larger reason.

`ScenarioApp` reads `simulations` off `setup.members.simulations`. It is typed
non-optional and eighteen call sites use it unguarded, but **no process supplies
it**, so it is `undefined` everywhere — in the api and in the worker alike, whose
module-provided `ScenarioApp` is what `peers.bind(ScenarioApi, scenarios)`
hands the agent runtime. One call site,
`getRunDataForAllSuites`, guards with `ScenarioSimulationsUnavailableError`;
that is the 503. The other seventeen would `TypeError`.

There is no seam that can supply it:

- **Members are a closed platform registry.** `reads()` is typed
  `readonly MemberName[]` over fourteen names (`packages/infrastructure/src/members.ts:144`),
  and `createProcessMembers` accepts overrides only for those. `withMembers()`
  takes arbitrary strings but resolves through the same source. A feature
  service can never be a member, and `packages/infrastructure` importing
  `@langwatch/scenario-server` would invert the layering.
- **Repositories can carry the reads.** A bundle declares `requires` and is
  handed those members, so `requires = ["prisma", "clickhouse"]` builds the
  ClickHouse read repository. `SimulationRepository` is read-only —
  every one of its eighteen methods is a get/find/count. This half is
  unblocked and correct, and `ScenarioRepositories`' own comment already flags
  it ("Run state, results and configurations are ClickHouse-backed,
  unregistered here").
- **Repositories cannot carry the writes.** `SimulationExecutionRepository`
  dispatches through the `simulation_processing` pipeline's registered
  commands — the `apps/tasks` recipe at
  `stalled-runs-backfill.composition.ts:156`. A bundle doing that
  unconditionally would double-register: the worker already registers the same
  pipeline as a consumer, and `eventSourcing.register` refuses with
  `Pipeline "…" is already registered on this runtime.`
  (`packages/eventing/src/eventSourcing.ts:248`). `ProducerOnlySimulationExecution`
  is a stand-in inside the definition that refuses all ten writes, not a
  dispatcher.

So `simulations` cannot be split across two seams without an optional
collaborator, and cannot live wholly in either. Two ways forward, both
architectural:

1. **Convert scenario's eventing.** `defineServerModule` already has
   `.withEventing(...)`; scenario does not declare it. The module would own the
   `simulation_processing` definition in both registration modes, and the
   execution repository would come from the registration rather than from a
   process. Largest, and the one the code already calls "the module handover"
   (`worker-agent-apps.composition.ts`, `scenario.server.ts:12`).
2. **Give the builder a per-module infrastructure seam** — a typed way for a
   process to hand one module its bespoke collaborators, which is what
   `ScenarioAppInfrastructure` has always assumed and never had. Smaller, but
   it is new framework surface, and thirteen other members in that same bag
   would immediately want it.

Until one is chosen, `ScenarioSimulationsUnavailableError` stays: it is a
truthful refusal, and ADR-133 would retire it only once a process can actually
compose the thing.
