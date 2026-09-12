# Drive: get `apidiff` to report no behavioural difference against `origin/main`

Written 2026-09-12, second apidiff session. **This supersedes
`handover-2026-09-12-apidiff.md`, whose step 2 is wrong and would delete
published API surface if followed.** That file is still the reference for the
gate ladder and for the three kinds of module-load breakage.

Branch `feat/strict-feature-layout-v0`. Tree has uncommitted work from this
session (see "What changed").

## Read this first: the previous plan was backwards

The last handover said the frozen OpenAPI document is **stale and behind the
branch**, so refreezing it from the generator would let the SDK build and open
gate 1. Measured this session, that is the opposite of the truth:

| document                                                  | paths | operations |
| --------------------------------------------------------- | ----- | ---------- |
| `origin/main:platform/app/src/app/api/openapiLangWatch.json` | 199   | 310        |
| branch frozen `apps/api/src/features/discovery/openapi-document.json` | 369 | 600 |
| what the branch's declarations actually generate **today** | ~170  | 170        |

The branch **serves 160 fewer routes than it documents**. Refreezing today
would rewrite the contract to match the loss — the exact regression this drive
exists to prevent. Concretely, `pnpm --filter @langwatch/platform-api task
openapi-check` reports:

    453 documented operation(s) are published by no declaration

Of those 453:

- **290 are dated/`latest` variants** and are NOT regressions. The old producer
  published all three addresses of a dated route; the new generator publishes
  one canonical address on purpose (`specs/api-reference/openapi-document-drift.feature`,
  rule "the document names one canonical address per declared route").
- **163 are real.** They match, to within 3, the 160 routes in the unregistered
  families listed below (28 core families plus scim's 19 build-tier routes).
  That correspondence is what closes the diagnosis.

**Do not refreeze until the generated document is a superset of the frozen
document's non-dated surface.** Refreezing is still a person's decision made
with `openapi-check` output in front of them — but today the answer is no.

## THE root cause, found: commit b383462d96

Everything below — the 70 unserved operations, the families that cannot be
registered, the unanswered Api tokens, the incomplete route sets — has one
source. On 2026-09-10:

    b383462d96  the api process boots on createProcess and 447 files go:
                api-production drops from 4,989 lines of hand wiring to 161
                over the generated module list, the doors table and every
                features composition, mount and types file are deleted, and
                apps/api/src falls from 586 files to 133

That commit deleted **184 composition and mount files** (84 `*.composition.ts`,
100 `*.mount.ts`). The hand-wiring in them was what supplied the capabilities
the REST families declare. The families survived; their providers did not.

The deleted set maps one-to-one onto the blocked work:

    api-experiment-run.composition.ts        763 lines  -> experiments (8 ops)
    api-gateway.composition.ts                         ]
    api-gateway-spend-pipeline.composition.ts          ]  gateway-internal,
    api-gateway-webhooks.composition.ts                ]  gateway-spend (8 ops)
    api-auth.composition.ts                            ]
    api-better-auth.composition.ts                     ]  auth, auth-cli
    features/auth/auth-rest.mount.ts                   ]  (12 routes)
    features/auth/auth-cli-device-flow-rest.mount.ts   ]
    api-trace-ingest.composition.ts                    ]  collector, otlp-*,
    api-trace-spool.composition.ts                     ]  tracked-event,
    api-trace-read-stack.composition.ts                ]  traces (4+ ops)
    features/dataset/dataset.composition.ts            -> dataset's missing
                                                          direct-upload routes

**This is the recovery source.** For any blocked family, the wiring it needs is
readable at `git show b383462d96^:<path>`. That is far better than designing a
composition from scratch: the original names every collaborator the handlers
expect. Porting it into the owning module (App member or bound provider) is the
work.

How a token is answered at runtime, since it decides what "port it" means:
`LocalFeatureApis` (`packages/runtime-composition/src/local-feature-api.ts`)
`declare`s a token, `bind`s it to an implementation, and hands out a proxy from
`reference`. `application.ts:502` performs the bind, once per registered
provider, and `ready()` calls `assertBound()` on every declared binding. So a
token needs either a member on the module's App or a provider bound to it. One
lane read this as "the token is type-only at runtime and a missing member 500s
on the first call"; the `bind`/`assertBound` path suggests an unbound declared
token can fail earlier, at boot. Both readings agree the family is broken —
establish which per family, because it changes whether the symptom is a 500 or
a refusal to start.

## The actual root cause

A REST family reaches the document only through its module's
`defineServerModule(...).withTransports(...)`: `declaredRestFamilies`
(`apps/api/src/tasks/openapi-document/openapi-document.declarations.ts`) reads
`module.transports` and nothing else.

**32 families are declared as files and reach the generator nowhere** — 28 core
families registered on no module, plus scim's 3, which ARE registered but are
not installed in a core build. They are not
merely undocumented — they are **not served at all**. Verified for `suite`:
`createTestSuitesRest` / `createRunPlansRest` / `createSuitesAliasRest` are
exported from `modules/suite/server/src/index.ts` and have **no consumer
anywhere in the tree** — no module registration, no app mount. `git log` on
`modules/suite/server/src/suite.server.ts` shows REST was never registered
there. Compare `modules/agent/server/src/agent.server.ts`, which both exports
its factory and passes `createAgentRest()` to `withTransports`.

Measured: **44 modules installed, 26 declare REST, 48 families, 186 routes
read.** 18 installed modules declare no REST at all while carrying
`*.rest.ts` files: `auth dataset evaluator hosted-mcp monitor scenario suite`
and others.

### The work list — 28 core families, ~141 routes
(scim's 19 are a build flag, not wiring — see the enterprise section)

`[url]` marks a family whose factory takes a `PlatformUrlBuilder`
(`packages/api/src/rest/openapi.ts:506`), which nothing supplies. Those need
the **agent precedent** (commit `0a9f15f2ea`, "platformUrl on AgentApi with a
pure rules builder"): put `platformUrl(...)` on the module's Api and App, have
the routes call `app.platformUrl(...)`, and drop the injected parameter — then
the family registers with no argument. The others are plain consts and need
only the `withTransports` line.

    gateway/gateway-platform          gateway                 20r
    gateway/gateway-internal          gateway-internal        12r
    dataset/dataset                   dataset                  9r   [url]
    organization/team                 teams                    9r
    scenario/scenario                 scenarios                8r   [url]
    auth/auth-cli-device-flow         auth-cli                 7r
    suite/suites-alias                suites                   7r   [url]
    monitor/monitor                   monitors                 6r   [url]
    suite/test-suites                 test-suites              6r   [url]  <- gate 1
    auth/auth                         auth                     5r
    automation/automation             triggers                 5r   [url]
    evaluator/evaluator               evaluators               5r   [url]
    suite/run-plans                   run-plans                5r   [url]
    workflow/workflow                 workflows                5r   [url]
    gateway/gateway-spend             gateway-spend            4r
    scenario/simulation-run           simulation-runs          4r   [url]
    trace/traces                      traces                   4r   [url]
    langy/langy-internal              langy-internal           3r
    scenario/scenario-event           scenario-events          3r   [url]
    trace/otlp-ingest                 otel                     3r
    trace/tracked-event               events                   2r
    workflow/cron                     cron                     2r
    hosted-mcp/mcp-authorize          mcp-authorize            1r
    scenario/scenario-generate        scenario                 1r
    scenario/scenario-run-export      export/scenario-runs     1r
    trace/collector                   collector                1r
    trace/otlp-path-alias             otlp-path-alias          1r
    trace/trace-export                export-traces            1r

Regenerate this list with the `declaredRestFamilies` inventory rather than a
regex — a `withTransports(...)` block spanning lines defeats grep, and a naive
scan reports `agent` and `analytics` as unwired when they are not.

**The list above counts `*.rest.ts` only, so it UNDERCOUNTS any module still in
the older shape.** Three modules keep REST in `transport/api-rest/*.api.ts`:
`langy` (5 files, none registered — `langy.server.ts:15` registers
`langyTurnsRest` and nothing else), `governance` (3 files, see below) and
`gateway` (tests only). Sweep both spellings when you re-measure.

### Registration is NOT mechanical for most of them — measured

A lane worked the 14 plain-const families and registered **2**:
`gateway/gateway-platform` (20 routes) and `workflow/cron` (2). It stopped on
the other 12 for a reason that invalidates the "just add a `withTransports`
line" premise, and the reason is verified:

**Most of these families declare against their OWN narrow App interface**, via
a local `moduleApi<X>("<module>")` token — not the module's App class, which
does not implement it. Confirmed by reading
`modules/gateway/server/src/transport/gateway-internal.rest.ts`: line 738
declares `defineRestRouter(GatewayInternalApi)`, and `GatewayInternalApp`
(line 108) is a transport-level dependency bundle — a spend pipeline, a
command sender, a codex refresh — that `GatewayApp` has no member for. The
handlers call those members unconditionally, so registering the family against
the module's App would **500 at runtime** rather than merely be undocumented.
That is strictly worse than leaving it unpublished, which is why the lane
stopped.

The per-family gap and a suggested lane split are in
`.claude/handoffs/rest-register-plain.md` sections 11 and 12 — six numbered
decisions. Two shapes recur:

- the capability genuinely lives in what `apps/api/src/app/**` composes (the
  gateway control channel's JWT signer and spend pipeline; auth's Better Auth
  instance and CLI device-session store), so the module needs a real App-shape
  implementation or a shared-path change;
- the family needs `withTransportFacts` bindings before it can be registered at
  all — `langy-internal` binds three route middlewares and, per the
  framework's own doc comment, **the whole process refuses to boot** without
  them, not just that route.

`organization/team.rest.ts` is a third shape: a factory wanting transport-only
dependency tokens that `defineServerModule`'s App-centric builder cannot
supply — that escape hatch exists only on the lower-level `serverFeature()`
builder. Either migrate its registration or grow the two methods it needs onto
`OrganizationApi`.

**So do not budget the remaining ~119 routes as mechanical.** `gateway-platform`
and `cron` were mechanical because their module App already satisfied the
declared token; that was 2 of 14.

### Two blind spots worth knowing before trusting apidiff

- **apidiff probes DOCUMENTED operations, so it cannot see an unregistered
  undocumented route.** `modules/trace/server/src/transport/collector.rest.ts:353`
  declares `POST /api/collector` — the SDK trace-ingestion endpoint — and it is
  in neither main's document nor the frozen one, so it is not among the 163
  documented removals. It is registered nowhere and mounted nowhere: nothing in
  `apps/api/src/` imports it. An apidiff run reporting exit 0 would still not
  prove ingestion works. The same applies to the otlp families.
- **`apps/api/src/features/**` declares its own REST families that the generator
  never reads** — `image-proxy`, `health-probe`, `rum`, and three `discovery`
  ones. `declaredRestFamilies` reads `serverModules` only. Decide whether these
  belong in the document before reading any future `openapi-check` output as
  complete.

### The enterprise question — needs a decision, not a lane

The enterprise modules ARE in `modules/catalogue.json` (21 entries). They are
absent from `modules/server-modules.generated.ts` only because
`dev/scripts/generate-modules.mjs` emits the **core** tier by default and
appends the enterprise tier only under `LANGWATCH_BUILD_TIER=enterprise`
(`generate-modules.mjs:133,151`). `pnpm start:prepare:files` therefore
regenerated a core-only list.

Both main's 199-path document and the branch's frozen document publish scim, so
**the published document was generated from an enterprise build.** That settles
the decision: run the generator under `LANGWATCH_BUILD_TIER=enterprise` before
refreezing.

Three consequences, which are NOT the same problem:

- **scim — no code change needed.** `enterprise/modules/scim/server/src/scim.server.ts:26`
  already registers all three families (`scimTokenRest`, `scimProtocolRest`,
  `scimWebhookRest`) plus a transport fact. Its 19 routes return with the build
  flag alone. It was never an unwired family; do not "fix" it.
- **governance — a module conversion, not a rewire.** It has **no `.server.ts`
  at all**, so there is nothing to install, and its REST lives in the older
  `transport/api-rest/{governance,governance-ingest,governance-cli}.api.ts`
  shape. Its ~7 documented operations have no declaration the generator can
  read. Use the `module` skill's convert path; this is the second-biggest item
  after the wiring sweep.
- **billing — one route, no installer.** `billing-stripe-webhook.rest.ts` exists
  and `enterprise/modules/billing/server/src/` has no `*.server.ts`.

**Do not regenerate the installed-module list while wiring lanes are running.**
Their instructions pin the generator's baseline at 186 routes / 48 families and
tell them the count must rise monotonically; switching tiers mid-flight jumps
it and surfaces enterprise load errors they will read as their own breakage.

## The last handover's central claim is FALSE — measured

It said: "The SDK code is not wrong. `modules/suite/contract/src/suite-evaluators.ts:84,122`
declares `fields: SuiteFieldDefinition[]`, so the branch really does model what
the SDK expects. The frozen document is simply stale. Refreeze it; do not 'fix'
the SDK."

The suite families are now registered and published. The generated document
says:

    POST  /api/v1/test-suites        request body properties: name
    PATCH /api/v1/test-suites/{id}   request body properties: name

`fields` and `evaluators` are **not achievable by wiring**. The write path does
not exist: `SuiteApp` (`modules/suite/server/src/app/suite.app.ts`) offers
`createTestSuite`, `archiveTestSuite` and `renameTestSuite(input & { name })`
— rename is the only test-suite update. `suite-evaluators.ts` has **no
production importer at all**: only its own unit test, a doc-comment mention,
and one dangling monolith specifier
(`modules/scenario/contract/src/evaluations/runScenarioEvaluations.ts:26`
imports `~/server/suites/suite-evaluators`, which does not resolve). The
`testSuiteUpdateInputSchema` wire schema is likewise unused.

Main's document publishes `PATCH /api/v1/test-suites/{id}` with
`name, fields, evaluators`. So this is a **lost capability**, not a stale
document — and 27 of the SDK's 33 errors need the feature built, not a
refreeze. That is architecture-sized and is now the largest single item on
gate 1.

### The v1-versus-bare "mismatch" is NOT a regression — settled

Two lanes independently reported that the branch documents `/api/v1/suites*`,
`/api/v1/scenarios*` and `/api/v1/simulation-runs*` where main's document
publishes the bare `/api/suites*`, `/api/scenarios*`, `/api/simulation-runs*`.
An earlier version of this handover called that a moved address and a real
behavioural difference. **It is neither.** Read
`addressesOf` (`packages/api/src/rest/addressing.ts`): a `dated` family serves
THREE addresses per route — `/<version><suffix>`, `/latest<suffix>` and the
bare `<suffix>` — off `basePathOf` = `/api/<namespace>`, and
`middlewareScopesOf` adds the `/api/v1/...` twin of each when `v1Twin` is true.

So the bare address is still served. What changed is only which of the
addresses the DOCUMENT names, and the branch names the v1 twin **on purpose**
(`specs/api-reference/openapi-document-drift.feature`, rule "the document names
one canonical address per declared route": "The document names the bare address
at its `/api/v1` twin, which is the URL an integrator is told to call").

Consequence: do not "fix" these, and do not add `{ v1Twin: false }` to a family
to make its documented spelling match main. A client generated from the new
document calls `/api/v1/...`, which is served. The agent-legacy case earlier in
this session was different and did need the flag — there, TWO families claimed
one address and the generator refused outright.

This also means a large share of the remaining 125 "real" removals may be the
same canonicalization rather than lost surface. **Re-classify them before
treating them as work**: for each, check whether the branch documents the same
operation at its v1 twin. The gap that is unambiguously real is a family no
declaration publishes at any spelling.

## A published family is not a working one

Both lanes converged on the same shape independently, and it is the most
important thing to understand before trusting any future `openapi-check`
output.

A REST family declares its dependencies as a narrow token,
`moduleApi<SomeApi>("<module>")`. Registering the family publishes it. Nothing
in that act makes the module's App answer those members.

Verified concretely: `modules/analytics/server/src/transport/dashboard-widget.rest.ts:77`
declares `moduleApi<DashboardWidgetApi>("analytics")` with 7 members
(`listDashboardWidgets`, `getDashboardWidget`, `createDashboardWidget`,
`updateDashboardWidget`, `assignDashboardWidgetToDashboard`,
`deleteDashboardWidget`, `assertCustomChartPlaygroundEnabled`). `AnalyticsApp`
(`app/analytics.app.ts:117`) implements `AnalyticsApiContract` and declares
**none** of them. The three paths are published and would 500 on real traffic.
The sibling `SavedWorkbenchChartApi` has the same gap and it predates this
session. The gateway lane found the same thing from the other direction:
`GatewayInternalApp` (`transport/gateway-internal.rest.ts:108`) is a transport
dependency bundle `GatewayApp` has no member for, which is why 12 of 14
"mechanical" registrations were refused.

**Do not try to count this with a scan.** A `ModuleApiToken` is a runtime
identity resolved through the composition registry
(`packages/runtime-composition/src/application.ts:489,501`), so a token may be
provided by something other than the module's App class. A grep for
`implements` or for member names on the App cannot tell a genuinely unprovided
token from one provided elsewhere, and a naive version of this count claimed 23
of 26 tokens were unimplemented, which is not credible — `query`, `projects`
and `github` are published and were not reported broken. Determine it per
family by reading the composition, the way both lanes did.

**apidiff is the right instrument for exactly this.** It probes live instances,
so a documented operation whose App cannot answer shows up as a behavioural
difference. That is an argument for getting to a running apidiff sooner, not
for trusting the document.

## Gate 1 is NOT one refreeze away

`pnpm --filter langwatch build` fails with **33 errors in 15 files**, measured.
They are three causes, not one:

1. **27 errors** — `fields` / `evaluators` missing from suite and scenario
   bodies. Fixed by registering `suite/test-suites` (its declaration's schema
   already carries both) and regenerating the SDK client. **Not** fixed by a
   refreeze: the generated document has **zero** `test-suites` paths today.
2. **6 errors** — `/api/v1/projects/{projectId}/analytics/dashboard-widgets`
   (×3 paths) is absent from BOTH documents and has **no REST declaration
   anywhere in the new tree**. Main serves it from the monolith at
   `platform/app/src/app/api/analytics-sql/[[...route]]/app.dashboard-widgets.v1.ts`,
   and main's document publishes all three paths. This is a port, not a rewire.
   Only a trpc adapter survived (`modules/trace/server/src/transport/api-trpc/dashboardWidgets.ts`).
3. **1 error** — `langwatchFetch.unit.test.ts:630`, `client.GET("/api/annotations")`
   "Expected 2 arguments, but got 1". An openapi-fetch arity issue, unrelated to
   the document's contents. Smallest and last.

Note the SDK's generator target moved: main generated from
`platform/app/src/app/api/openapiLangWatch.json`; the branch generates from
`apps/api/src/features/discovery/openapi-document.json`
(`sdks/typescript/package.json` `generate:openapi-types`). `api-client.ts` is
committed, so after any document change it must be regenerated explicitly —
`build` is only `tsc --noEmit && tsup` and will not do it.

## What changed this session (uncommitted)

1. `pnpm install` + `pnpm start:prepare:files` — cleared the
   `@langwatch/prisma-client/src/generated/client.ts` module-not-found the last
   handover was stuck on. **It was codegen, not source.** Nothing was edited.
2. The whole `record_evaluations` path restored across five layers (a lane,
   manifest `.claude/manifests/scenario-record-evaluations-port.md`, handoff
   `.claude/handoffs/scenario-record-evaluations-port.md`). Bigger than the
   "one dropped function" the last handover described: the command data schema,
   the command's pipeline registration, and `recordEvaluations` on both the
   execution repository and `SimulationService` were all missing too.
   scenario-server went 1014 -> **1082 passing**, same 22 failures.
3. `modules/experiment/server/src/transport/experiment-workbench-run.rest.ts:32`
   — `import { type ExperimentV3RestApi, ... }` dropped its `type` modifier.
   `ExperimentV3RestApi` is a declaration-merged interface **and** const
   (`experiment-v3.rest.ts:84` and `:111`); importing only the type erased the
   value and `defineRestRouter(ExperimentV3RestApi)` threw a ReferenceError.
   **This is a fourth kind of breakage** to add to the handover's three: not a
   wrong module and not a rename, but a correct module with a `type`-only
   import of a merged name.
4. `modules/presence/server/src/repositories/presence-repositories.registry.ts`
   — tier key `redis:` renamed to `live:`. `defineRepositories` requires
   `live`/`memory`; all 30+ other registries use them; presence was the sole
   outlier, so `freezeProvider(undefined)` threw. **A fifth kind:** a typed
   call that is simply wrong, invisible because `pnpm typecheck` covers three
   applications and not the ~180 packages.
5. `modules/agent/server/src/transport/agent.rest.ts` gained
   `.withAddressing("v1-only")` and `agent-legacy.rest.ts` gained
   `.withAddressing("dated", { v1Twin: false })`. Both families declared
   namespace `agents` with default `dated` addressing, so both claimed
   `/api/agents` AND `/api/v1/agents` — `DuplicatePublishedAddressError`, and
   at runtime a mount-order coin flip between the rich and reduced field sets.
   The frozen document settles the split: `/api/agents` get,post +
   `/api/agents/{id}` get,patch,delete for legacy; `/api/v1/agents...` plus
   `/test` and `/call` for the current family; and **no dated agent paths at
   all**. `agent-legacy.rest.ts` does not exist on main — this branch added it.

The generator now **exits 0**: `Read 186 declared routes from 48 families /
Wrote 170 operations`.

## A fix that reveals breakage is progress — read test counts carefully

`presence-server` went from 15 failed / 42 passed (57 collected) to 20 failed /
42 passed (62 collected) when the `live:` tier key was fixed. **Passing stayed
at 42** — nothing regressed. The registry threw at import, so
`presence-installation.unit.test.ts` could not load and reported zero tests;
fixing the registry let 5 more tests run, and they fail. The two new real ones
say `createApp(...).withInfrastructure is not a function` — the next breakage
in presence, previously invisible. The three `BroadcastAdapter is not defined`
failures are the handover's third kind and predate this.

Always compare the PASSING count, not the failing one. A rising failure count
beside a flat passing count means a load error was cleared.

Also measured: `experiment-server` 5429 passed / 1 failed; `agent-server`
3 failed / 234 passed both with and without this session's addressing change
(verified by stashing it), so those three are pre-existing.

## The remaining gap, classified — 70 operations in FOUR classes

Measured after this session's wiring, with dated variants and v1-canonicalization
both excluded (see the section above on why those are not regressions):

    non-dated removals            83
      canonicalization            13   not regressions
      GENUINELY MISSING           70

    scim            15  ]
    scim-tokens      3  ]  class A - registered, not installed
    governance       7     class B - no installer at all
    teams            9  ]
    gateway          8  ]
    experiments      8  ]  class C - declared, registered nowhere
    scenario-events  3  ]
    traces           3  ]
    events           1  ]
    dataset          8  ]  class D - registered family, INCOMPLETE route set
    projects         5  ]

**Class A — registered but not installed (18).**
`enterprise/modules/scim/server/src/scim.server.ts:26` already registers all
three families correctly. But the build tier is not merely unset: it is
**broken at dependency resolution**. `LANGWATCH_BUILD_TIER=enterprise
node dev/scripts/generate-modules.mjs` writes imports for 48 modules, and then
the generator dies with

    Cannot find package '@langwatch/enterprise-licensing-server'
    imported from modules/server-modules.generated.ts

because `modules/package.json` (`@langwatch/installed-modules`) declares
exactly **44 dependencies, none of them enterprise**, while the package does
exist in the workspace under precisely that name. So an earlier claim in this
handover that scim needs "no code change, just the flag" was wrong: the
generator must also add the enterprise packages to `installed-modules`'s
dependencies under that tier. Tested and reverted this session; the tree is
back on the core tier.

**Class B — no installer (7).** `governance` has no `*.server.ts` and keeps its
REST in the older `transport/api-rest/*.api.ts` shape. Module conversion.

**Class C — declared, registered nowhere (32).** The remaining families from
the work list. Each needs a composition decision, NOT a registration line —
see "A published family is not a working one". `experiments` is the most
tractable of these: `experiment-v3.rest.ts` and `experiment-workbench-run.rest.ts`
both exist as plain consts in an already-registered module, and the missing
eight are theirs (`/api/v1/experiments/runs`, `/{slug}/versions`,
`/{slug}/workbench-state`, `/{slug}/run`, `/{slug}/versions/{version}/restore`).
Check whether `ExperimentApp` answers `ExperimentV3RestApi` before registering.

**Class D — incomplete route set in a REGISTERED family (13).** New class, not
in any previous handover. `dataset` IS published with 9 routes, and the frozen
document names 8 more that no declaration carries: the entire `direct-upload`
sub-family (`POST /dataset/direct-upload`, `.../{datasetId}/finalize`,
`.../{datasetId}/retry`, `PUT .../staging/{uploadId}`,
`DELETE .../{datasetId}`), plus `POST /api/v1/dataset/upload`,
`POST /api/v1/dataset/{slugOrId}/upload` and
`PATCH /api/v1/dataset/{slugOrId}/records/{recordId}`. `projects` has the same
shape for 5 operations. Registering the family will never surface these —
the ROUTES have to be ported into the declaration. Sweep every registered
family for this class rather than assuming registration completed it.

## After the refreeze — where gate 1 actually stands

The document was refrozen in `0a0f549cfd`. `openapi-check` now reports
**removed 0, added 0, changed 0**: the published contract and the module
declarations finally say the same thing.

Gate 1 is NOT passed. `pnpm --filter langwatch build` reports **74 errors in 17
files**, up from 33 — and the trade is worth understanding before anyone
reverts it:

- the 27 `fields`/`evaluators` errors are **gone**, fixed at source (4acd4167e5)
- the 6 dashboard-widgets errors are **gone** (7e85bd00ee)
- what replaced them was masked by the stale document all along

Split by where the errors are:

    20  shipped source
    54  test fixtures  (39 of them in prompts.facade.unit.test.ts alone)

**The prompts cluster is not a regression.** Main's document carries no inline
schema at all for `GET /api/v1/prompts`; the branch declares 25 properties with
14 required, including `platformUrl`. The branch is the STRICTER side, and the
SDK's fixtures — written against main's loose shape — do not satisfy it. That
is under-specified test data meeting a real contract. Update the fixtures; do
not loosen the declaration to match a document that described nothing.

**The experiments cluster IS a real gap, and it is ours.** The eight operations
published in `21d4639b9d` declare no response content:

    GET /api/v1/experiments/runs/{runId}   200: NO CONTENT, 401: NO CONTENT, 404: NO CONTENT

so `openapi-typescript` types every 200 body `undefined` and
`experiments-api.service.ts:51` and four siblings fail on
`["content"]["application/json"]`. Those routes need `.withOutput(...)`. Note
all three paths are **absent from main's document entirely**, so there is no
prior shape to copy — the declaration is the only source of truth for them, and
whoever writes it is deciding the contract.

Remaining to open gate 1: the 20 source errors (5 traces, 5 experiments, 2
prompts, 2 experiment-cli, 2 experiments-facade, and four singletons) and the
54 fixture updates. None of them needs the document touched again.

## Exact next action

1. Lane `suite` first — 3 families, 18 routes, needs the agent platformUrl
   precedent. It is the only item on the gate-1 critical path that is a rewire.
2. Lane `gateway` (3 families, 36 routes, plain consts — biggest win per unit
   of work) and `trace` (6 families) and `scenario` (5 families) in parallel;
   they share no files.
3. Port dashboard-widgets REST from main's monolith app. Own lane, needs a
   decision about which module owns it (analytics, by namespace).
4. Settle the enterprise question above.
5. Re-run `openapi-check`. When `regressions` is empty or every remaining
   removal is a deliberate, baselined decision, **then** refreeze, then
   `pnpm --filter langwatch generate:openapi-types`, then
   `pnpm --filter langwatch build`.
6. Then `apidiff run -no-haven -main-ref origin/main -json -report <file>`.
   Exit 1 with findings is success for that step.

## Two things the last handover got right, and one it did not need to worry about

- The three kinds of load breakage are real and the loop method (fix one,
  re-run, read the next) worked exactly as described.
- `openapi-document.json` is genuinely frozen and must never be written by a
  lane.
- **apidiff needs no person and no trusted CA.** With `-no-haven` and no
  `-pg-url/-ch-url/-redis-url` it brings up its own compose stack from
  `dev/compose.dev.yml` under the `apidiff` project, and Docker is available on
  this machine. The `security add-trusted-cert` step in the last handover is a
  **visualdiff** prerequisite only. Gates 1-3 need nobody.

## Measured state

    generator      exits 0, 266 operations from 63 families / 284 routes
                   (was 170 / 48 / 186 when this session started)
    openapi-check  removed 0, added 0, changed 0 — the document is generated
                   from the declarations as of 0a0f549cfd. The 70 operations
                   the branch still does not serve are recorded in
                   dev/docs/plans/unserved-documented-operations-2026-09-12.md
    SDK build      74 errors in 17 files (20 source, 54 fixtures); was 33
                   before the refreeze, and the original 33 are fixed
    published now  suite's 11 paths (test-suites, run-plans, suites),
                   gateway 20 routes, workflow/cron 2, dashboard-widgets 3
                   paths / 6 operations with the create body's `queries` array
    openapi-check  453 removed (290 dated variants, 163 real), 23 added, 9 security changed
    SDK build      33 errors in 15 files (27 suite fields, 6 dashboard-widgets, 1 unrelated)
    apidiff        still exit 2, blocked at gate 1
    scenario-server  1082 passed / 22 failed  (was 1014 / 22)
    langy-server     16 failures, ALL `createAppRestSecurity` — a TEST-ONLY
                     helper imported from `@langwatch/api/rest` and declared
                     nowhere; `AppRestSecurity` is now `AppRestSecurityMembers`
                     (`packages/api/src/rest/security.ts:107`). It cannot block
                     the generator, which reads production code only.
