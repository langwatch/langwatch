# Restructure bug hunt — 2026-09-03

Branch: `feat/strict-feature-layout-v0` vs `origin/main`. Read-only
investigation recorded in `55285f16c4`; a verification-and-fix pass followed
the same night and its record is the second half of this file. **Audited
2026-09-03 against the working tree.** The original narrative (Part A's 45
unserved REST operations and 18 tRPC gaps, Part B's two boot attempts) is
superseded by the table below; what it found that is still true is kept here.

## Closed since the hunt

- **`/api/organization*`, `/api/role-bindings*`, `/api/roles*`,
  `/api/scim-tokens*`** — 21 of the 45 unserved operations. All four were
  gated behind optional constructor inputs nothing supplied at the live
  composition. `576930a775` ("Mount the packaged REST families from the
  composed halves") mounts them; all four family names are now in
  `app-rest.packaged-families.ts`.
- **`suites.runPlan`** — `suite.api.ts:170` (`f725772083`). Its remaining
  fixes are in `suite-restore-review.md`.
- **`agents.testRun` / `agents.testTurn`** — `agent.api.ts:307,324`
  (`f725772083`). Verification pass item 10.
- **The `agents` and `secrets` namespaces** were never a silent drop — the
  original entry corrected itself on verification. They are conditional on
  their services resolving, each absence logged by name. Step C of
  `trpc-flatten-review.md` makes them unconditional.
- **Six evening findings** were fixed or verified in the pass below: cost
  attribution's `hasRunDefiningEvent` guard (item 1), the
  `SuiteExecutionService.resolveParameters` target merge (item 4),
  `resolveDynamicRunMembership`'s lock predicate (item 5), Azure dataset
  storage in the worker (item 6), the dataset tRPC conflict errors (item 7)
  and the Langy `langy_ui_handler_failed` remediation (item 8).
- **`specs/ai-gateway/governance/admin-trace-access.feature`** now carries
  binding tags, so it is no longer vacuously green.

## Open — 22 REST operations still unserved

The frozen document
(`apps/api/src/features/discovery/openapi-document.json`) lists 14 paths /
22 operations no composition mounts. The drift guard is
`apps/api/src/tasks/openapi-document/openapi-document.checker.ts`, whose
allow-list is three entries (`GET /api/traces/{traceId}/transcript` and the two
document-root residue operations), so these 22 fail it.

```
pnpm --filter @langwatch/platform-api test:unit run \
  src/tasks/openapi-document/__tests__/openapi-document.unit.test.ts
```

| Family | Ops | Owner |
| --- | ---: | --- |
| `/api/v1/agents` (get, post), `/{id}` (get, patch, put, delete), `/{id}/test`, `/{id}/call`, `/connect/{register,poll,frames}` | 11 | `connected-agents-restore-plan.md` Slice 7, `apps/api` half. `createAgentV1RestApp` is built and exported; nothing calls it and there is no `"agents-v1"` family name. See verification item 9. |
| `/api/v1/run-plans` (get), `/run` (post), `/{id}` (get, delete), `/{id}/run` (post) | 5 | **Unowned.** No run-plans family, no server file. `POST /run` is also the route `suite-restore-review.md` fix 4 waits on — the CLI omits the plan name only there. |
| `/api/v1/test-suites` (get, post), `/{id}` (get, patch, delete), `/{id}/run` (post) | 6 | **Unowned.** `suite.api.ts` mounts `/api/suites` and never `/api/v1/test-suites`. |

The legacy `/api/agents` alias is mounted (`agent-legacy.api.ts`, family
`"agents"`) and works; it is a distinct path from v1.

## Open — the result-atoms subsystem, and five procedures that need it

Five `scenarios.*` procedures the web calls have no server half, and they share
one root cause: the **result-atoms query layer is absent repo-wide**
(`grep -rln "ResultsFilter\|result-atoms" packages/features/scenario/server apps/api apps/worker`
returns nothing). Porting it unblocks all five.

| Procedure | Web call site |
| --- | --- |
| `scenarios.getResultsOverview` | `scenario/web/src/ui/sections/agent-testing/results/use-result-groups.ts:221` |
| `scenarios.getResultAtoms` | `…/use-result-groups.ts:234` |
| `scenarios.getCodeScenarios` | `…/use-result-groups.ts:563` |
| `scenarios.getRunTargets` | `…/use-result-groups.ts:569` |
| `scenarios.getRunConfigurations` | `…/run/use-run-configuration-history.ts:54` |

Verification item 2 below carries the full hand-off for
`getRunConfigurations`, including the composition call site
(`api-trpc-collaborators.agent-group.composition.ts:514-526`) a
`RunConfigurationsService` has to be threaded through. Land the result-atoms
layer first.

## Open — the workbench Langy handoff

`useRegisterLangyActions` exists in langy-web and has zero consumers and no
entry-point export. Verification item 3 carries the full hand-off: publish the
two hooks and their types, port the action-manifest / narration /
run-identification / target-name modules from main, then wire both hooks back
into `workbench.screen.tsx`. Four other pages (me, automations, analytics,
evaluations) hit the same published-export wall.

## Operational, still true

**`haven` must be rebuilt (`make haven install`) after this branch lands.** A
binary built before the `platform/app` removal refuses with
`open .../platform/app/.env.portless: no such file or directory`.
`grep -rn "platform/app" tools/thuishaven --include=*.go` returns zero matches
— the stale assumption is baked into the compiled binary, not the source.
Anyone with a pre-existing `go install`ed haven hits a hard boot refusal.

## Residual unknowns, never disambiguated

- **Shape drift on the ~253 mounted REST operations.** The checker diffs path
  presence and auth scheme only, not request/response bodies.
- **Missing procedures inside otherwise-mounted tRPC namespaces.** Only
  whole-namespace gaps were swept exhaustively.
- **The haven `migrations failed: context canceled` result** — consistent with
  the investigation's own 90 s timeout wrapper firing mid-migration rather
  than a migration defect, but never disambiguated. Needs a re-run with a
  longer budget.
- **Live `/api/health`, `/api/auth/session` and served OpenAPI verification.**
  The api lane never stayed up during the investigation window (a concurrent
  `identity-eventing` move, since completed). Static route locations:
  `GET /api/health` → `apps/api/src/api-process.lifecycle.ts:73`;
  `GET /api/auth/session` → `packages/features/auth/server/src/transport/api-rest/auth.api.ts:137`;
  OpenAPI serving → `apps/api/src/features/discovery/openapi-serve.ts` with
  `discovery-locations.ts` (`WELL_KNOWN_OPENAPI_PATH=/.well-known/openapi`,
  `API_OPENAPI_PATH=/api/openapi.json`).
- **Worker job-processing behaviour** — enqueued-but-unprocessed jobs, absent
  capability warnings, unregistered projections. Never observed.

The `langwatch-public-config` meta tag was checked and carries no secrets (its
PostHog value is a client key, which is meant to be public). The UI, gateway
and nlpgo lanes booted and served cleanly throughout.

## Verification pass — 2026-09-03, later that night

Re-checked every finding above against current code (`git log --oneline -40` +
targeted greps first, to catch anything a later commit already closed) and
restored what was still open and reachable outside the active-lane areas
(`apps/api/src/app/**`, `apps/api/src/app-trpc/**`, `packages/features/agent/**`,
`packages/features/suite/server/src/services/connected-target.service.ts`,
`packages/features/langy/server/**`, `apps/tasks/**`). Tests run with
`pnpm --filter <pkg> test:unit run <file>`; `pnpm -s lint` run from the repo
root once at the end.

### 1. Cost attribution — `hasRunDefiningEvent` guard — fixed-now

Confirmed open: `grep -rn hasRunDefiningEvent` found nothing on the branch,
and `packages/features/scenario/server/src/adapters/simulation-eventing.adapter.ts`'s
`createFoldStore()` wrapped `RepositoryFoldStore` directly with no gate — a
cost-only metrics event (a redacted/misattributed `scenario.run_id`) would
mint a `simulation_runs` row with no name, scenario or end. The handler's own
comment in `simulation-run-state.projection.ts` already *referenced*
`hasRunDefiningEvent` as if it existed ("Copying it here would let a cost
figure alone create a run") — a stale comment describing behaviour the code
did not implement.

Fixed:
- `packages/features/scenario/server/src/projections/simulation-run-state.projection.ts` —
  exported `hasRunDefiningEvent(state)`, ported verbatim from
  `origin/main:platform/app/src/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection.ts`.
- `packages/features/scenario/server/src/adapters/simulation-eventing.adapter.ts` —
  added `GatedSimulationRunStateFoldStore` (wraps `RepositoryFoldStore`,
  declines `store`/`storeBatch` when `!hasRunDefiningEvent(state)`, logs a
  warning naming the tenant and run id), wired into
  `SimulationRunStateStoreAdapter.createFoldStore()`.

Test: `packages/features/scenario/server/src/adapters/__tests__/simulation-eventing.adapter.unit.test.ts`
gained the two scenarios the branch's test only had one of three for
(`@scenario "Cost metrics for an unknown run write no run row"` and
`@scenario "Cost that arrives before the run starts reaches the row"`); the
third (`"A run with a lifecycle event keeps writing its row"`) already
existed. `pnpm --filter @langwatch/scenario-server test:unit src/adapters/__tests__/simulation-eventing.adapter.unit.test.ts`
→ 3/3 pass, and the WARN log line fires exactly on the two "declined" cases —
observed proof the gate runs, not just that assertions pass.

### 2. `scenarios.getRunConfigurations` — handed off

Confirmed open: `packages/features/scenario/web/src/ui/sections/agent-testing/run/use-run-configuration-history.ts:54`
still calls `api.scenarios.getRunConfigurations.useQuery(...)`; no
`runConfigurations` router, service or repository exists anywhere under
`packages/features/scenario/server`.

Not a small lift. Main's implementation
(`platform/app/src/server/app-layer/simulations/run-configurations/{run-configuration.types.ts,run-configurations.service.ts (342 lines),run-configurations.clickhouse.repository.ts (192 lines)}`
+ `platform/app/src/server/api/routers/scenarios/run-configurations.router.ts`)
depends entirely on the **result-atoms subsystem** (`ResultsFilter`, the
ClickHouse row-folding query it drives) — and that subsystem is itself
absent from the branch: `grep -rln "ResultsFilter\|result-atoms" packages/features/scenario/server apps/api apps/worker`
returns nothing. This is the same root cause the original Part A tRPC table
above already named for `getResultsOverview` / `getResultAtoms` /
`getCodeScenarios` / `getRunTargets` — none of which are in this task's
finding list, but `getRunConfigurations` cannot be built without the same
infrastructure those four also need. Building it properly means porting the
whole result-atoms query layer first, then `run-configurations.service.ts` /
`.clickhouse.repository.ts` on top of it, then a new `run-configurations.api.ts`
sub-router merged into `packages/features/scenario/server/src/transport/api-trpc/scenario.api.ts`
(not restricted) — and then wiring the concrete ClickHouse-backed service into
the live process, which happens in `ScenarioApp.create(...)`'s call site,
`apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts:514-526`
(**restricted**: `apps/api/src/app/**`). That composition file is also where
`SimulationClickHouseAdapter`/`SimulationRunStateStoreAdapter` already get
built for the `simulations` service this new service would sit beside.

**Hand-off**: this is a multi-day feature restoration (result-atoms query
layer + run-configurations service/repository/router + composition wiring),
not a bug-hunt fix. Land the result-atoms subsystem first (it unblocks 4
other findings from Part A too), then `run-configurations.service.ts` reusing
it, then merge a new sub-router into `scenario.api.ts`, then thread a
`RunConfigurationsService` (built from a new ClickHouse-client resolver,
matching the pattern `SimulationClickHouseAdapter.create` already uses at
`api-trpc-collaborators.agent-group.composition.ts:514`) through
`ScenarioApp.create(...)`'s `scenarios`/`simulations` construction there.

### 3. Workbench Langy handoff — handed off

Confirmed open: `useRegisterLangyActions` exists and is exported from
`packages/features/langy/web/src/features/langy/ui/sections/langy-context.tsx:153`,
but has **zero consumers** anywhere in the repo (`grep -rln useRegisterLangyActions packages apps`
returns only its own definition file), and it is not published from
`packages/features/langy/web/src/index.ts` (`grep -n langy-context packages/features/langy/web/src/index.ts`
finds nothing). `packages/features/experiment/web/src/screens/experiments/workbench.screen.tsx:27-44`
carries a detailed, deliberate comment recording exactly this: the context
module "is NOT published from that package's entry... widening its exports
here would be editing someone else's package mid-flight."

This is a real, large feature loss, not a small wiring gap. Main's
equivalent page (`platform/app/src/pages/[project]/experiments/workbench/[slug].tsx`,
620 lines vs. the branch's 221) builds two things this branch has neither of:
proposal handlers (`evaluators.create`, `prompts.create`, `dataset.*`) via
`useRegisterLangyHandlers`, and the live UI-action table
(`specs/langy/langy-ui-actions.feature`) via `useRegisterLangyActions`,
built from `~/experiments-v3/actions/{manifest,narration,runScope}.ts`,
`~/experiments-v3/execution/runIdentification.ts`,
`~/experiments-v3/hooks/useTargetName.ts`,
`~/experiments-v3/utils/revealTargetColumn.ts` and
`~/features/langy/uiActions/{errors,types}.ts` — none of which have a
branch equivalent checked. The workbench's own comment additionally notes
four *other* pages (me, automations, analytics, evaluations) hit the same
published-export wall and were left with the same gap.

**Hand-off**: (1) publish `useRegisterLangyActions` and
`useRegisterLangyHandlers` (plus `LangyUiActionHandlers`/`ProposalHandlers`
types) from `packages/features/langy/web/src/index.ts` — small, additive,
not restricted (`packages/features/langy/web/**` is not in this task's
active-lane list, only `packages/features/langy/server/**` is) — coordinate
with whoever owns langy-web's current work before touching it, per the
workbench comment's own caution; (2) port the action-manifest/narration/
run-identification/target-name modules from main into
`packages/features/experiment/{web,server}` and `packages/features/langy/web`
as the strict layout dictates; (3) wire both hooks back into
`workbench.screen.tsx`. Full port, with tests — not attempted here; too large
for this pass alongside the other six findings.

### 4. `SuiteExecutionService.resolveParameters` target merge — fixed-now

Confirmed open: `resolveParameters` called
`this.scenarios.resolveRunParametersForScenarios({scenarios, values: input.parameters})`
once, ignoring `target.runParameters` entirely — a target's own parameter
overrides (`SuiteTarget.runParameters`, `packages/features/suite/contract/src/suite.ts:53`)
were silently dropped in favour of the run-level values for every target.
Main's `resolveParametersPerTarget` (`origin/main:platform/app/src/server/suites/suite.service.ts:200-260`)
resolves once per unique target key, merging `{...values, ...target.runParameters}`,
target winning.

Fixed: `packages/features/suite/server/src/services/suite-execution.service.ts` —
`resolveParameters` now loops `input.activeTargets`, deduping by
`targetKeyOf(target)` (`@langwatch/suite-contract`, already ported), merges
`{...input.parameters, ...target.runParameters}` per target, and returns
`Map<targetKey, Map<scenarioId, SuiteRunParameters>>`; `queueAll` looks up
`parameters.get(targetKeyOf(item.target))?.get(item.scenarioId)`. Secrets stay
run-level (first target's resolution wins), matching main's own comment on
why: "The secrets are run-level, so every target resolves the same ones."

**Not ported**: main's `assertNoSecretOverrides` (refusing a secret name in
`target.runParameters`) and the agent-declared `targetDefinitions`/
`targetLabel` merge (main's `resolveParametersPerTarget` also reads each
target's connected-agent's own declared parameters via `agentsById`). Neither
is in this task's finding list; the latter needs `agentsById`/target
parameter definitions threaded into `SuiteExecutionRequest`, which on this
branch's shape most plausibly belongs in
`packages/features/suite/server/src/services/connected-target.service.ts`
(**restricted**). Flagging as a residual gap, not fixed here.

Test: `packages/features/suite/server/src/ports/__tests__/suite-execution.service.unit.test.ts`
gained `@scenario "Each target receives its own parameters merged over the
run parameters"` (verbatim from `origin/main:platform/app/src/server/suites/__tests__/suite.service.unit.test.ts:358`),
using a `resolveRunParametersForScenarios` mock that echoes back the merged
`values` it received. `pnpm --filter @langwatch/suite-server test:unit src/ports/__tests__/suite-execution.service.unit.test.ts`
→ 6/6 pass; full package `pnpm --filter @langwatch/suite-server test:unit` →
70/70 pass.

### 5. `resolveDynamicRunMembership` lock predicate — fixed-now

Confirmed open, and confirmed **not** what the doc's "pre-existing" label
implied: `packages/features/suite/server/src/repositories/prisma/prisma.suite.repository.ts`'s
`resolveDynamicRunMembership` ran `SELECT id FROM "SimulationSuite" WHERE
id = ... AND "projectId" = ... AND kind = 'custom' AND "archivedAt" IS NULL
FOR UPDATE`, then read the same row with `kind: "run_plan"` — every plan row
is created with `kind: "run_plan"` (`prisma.suite.repository.ts:66`), so the
lock predicate matched zero rows and the `FOR UPDATE` never actually locked
anything. Checked `origin/main:platform/app/src/server/suites/scope-membership.ts:44` —
main's lock has **no `kind` and no `archivedAt` predicate at all**:
`WHERE id = ${suiteId} AND "projectId" = ${projectId} FOR UPDATE`. So the bug
is not a stale-but-once-correct predicate — the `kind = 'custom'` clause was
never right for a run-plan row; it does not correspond to anything in main.

Fixed: dropped the `kind`/`archivedAt` predicates from the raw lock query,
matching main exactly (id + projectId only) — the existence/archived checks
already happen in the `findFirst` read that follows the lock.

Test: new `packages/features/suite/server/src/repositories/prisma/__tests__/prisma.suite.repository.unit.test.ts`
(Prisma stubbed, no socket opened — the raw-SQL predicate is asserted as SQL,
concurrency itself is the integration lane's question) — captures the
tagged-template SQL sent to `$executeRaw`, asserts it contains `FOR UPDATE`,
asserts it does **not** match `/kind/i`, and asserts the two interpolated
values are exactly `[id, projectId]`. Added a new scenario to
`specs/suites/run-plan-dynamic-scopes.feature` (`@scenario "The row lock
matches the row the resolution reads"`, `@unit`) since main had no dedicated
scenario for this either — it was a code-reading find, not a spec gap.
`pnpm --filter @langwatch/suite-server test:unit src/repositories/prisma/__tests__/prisma.suite.repository.unit.test.ts` → 2/2 pass.

### 6. Azure dataset storage refuses in the worker — fixed-now

Confirmed open, and confirmed **deeper than dataset alone**: the worker's
general object-storage composition
(`apps/worker/src/app/worker-object-storage.composition.ts`) called
`WorkerStoredObjectStorageRuntimeFactory.create({config: {backend, ...}})`
with **no `azure` field at all** — for an `azure`-backend deployment this
throws at composition time ("Worker Azure storage requires a configured
Azure driver factory"), which is why the dataset-specific throw downstream
was `UNREACHABLE TODAY` per the worker-production.composition.ts comment
that already named this precisely as "a defect rather than a design." The
worker also read no `AZURE_BLOB_*` configuration at all
(`apps/worker/src/platform/config/worker.config.ts` had only
`azureSpoolRetentionConfirmed`, nothing else).

Fixed, reusing the exact `AzureBlobStoredObjectDriver` /
`resolveAzureCredentials` pattern `apps/api/src/app/api-trpc-collaborators.product-infra.composition.ts:310-315`
(read-only reference, not edited) already uses for the API's own Azure
object-storage path:
- `apps/worker/src/platform/config/worker.config.ts` — added the
  `AZURE_BLOB_*` + `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_FEDERATED_TOKEN_FILE`
  config block under `infrastructure.storage.azure`, mirroring
  `apps/api/src/platform/config/api.config.ts:668-702` field-for-field.
- `apps/worker/src/app/worker-object-storage.composition.ts` — added
  `createWorkerAzureBlobDriver(azure)` (builds `AzureBlobStoredObjectDriver`
  or `undefined` when unconfigured) and `WorkerAzureStorageAdapter`
  (implements `WorkerAzureStorageFactoryPort`, already declared but never
  implemented); wired into `createWorkerObjectStorage` only when
  `backend === "azure"`; `WorkerObjectStorage` gained an `azureConfig` field
  so dataset composition can build its own driver instance (needs `.head()`,
  deliberately outside `StoredObjectStorageDriver`).
- `apps/worker/src/app/worker-dataset-normalization.composition.ts` —
  `WorkerDatasetStorageResolver`'s `azure` branch now builds an
  `AzureDatasetStorageAdapter` (already existed in `@langwatch/dataset-server`,
  tested by `azure.dataset-storage.unit.test.ts`, just never composed here)
  via a new `WorkerDatasetAzureConfigResolver`, instead of throwing. Removed
  the now-dead `workerDatasetStorageBackendSupported` (always returned
  `false`, zero callers anywhere).
- `apps/worker/src/app/worker-production.composition.ts` — removed
  `WorkerTraceAbsenceReportPort.withoutDatasetStorage()` and its call site
  and `LoggedWorkerTraceAbsence` implementation: reporting "Azure dataset
  storage unsupported" on every `azure`-backend boot would now be **false**
  once it is supported, so the whole absence-report is gone rather than left
  to lie.

Tests: extended `apps/worker/src/platform/config/__tests__/worker.config.unit.test.ts`
(43/43 pass, was 41), new `apps/worker/src/app/__tests__/worker-object-storage.composition.unit.test.ts`
(2/2) and `apps/worker/src/app/__tests__/worker-dataset-normalization.composition.unit.test.ts`
(2/2, proves `forProject` returns `AzureDatasetStorageAdapter` — not a throw,
not `LocalDatasetStorageAdapter` — for an Azure-routed project, with and
without a fully-configured account). New spec:
`specs/datasets/dataset-normalization-azure-storage.feature`
(`@scenario "An Azure-routed project's dataset chunks resolve to the Azure
adapter"`, `@unit`).

### 7. Dataset tRPC conflict errors — verified-fixed

Already fixed by commit `4fe2f10c4b` ("Lift the authz, organization,
dataset, group-queue, eventing and analytics specs") — its own message says
so: "Porting the dataset error-handler test showed the tRPC boundary
building a raw TRPCError for a taken dataset name instead of the handled
error the file promised; it now throws DatasetNameTakenError and
DatasetStaleColumnsError." Confirmed current:
`packages/features/dataset/server/src/transport/api-trpc/dataset.api.ts:129-144`'s
`translateDatasetError` maps `DatasetConflictError` to
`DatasetStaleColumnsError`/`DatasetNameTakenError`. Test:
`packages/features/dataset/server/src/adapters/__tests__/dataset-error-handler.unit.test.ts`
(landed in the same commit). No action needed.

### 8. Langy `langy_ui_handler_failed` remediation — fixed-now (widened)

Confirmed open: `packages/features/langy/contract/src/langy.error-remediation.ts`'s
`tips` map had no `langy_ui_*` entries at all. Grepping every
`remediation("langy_ui_...")` call site in `langy.errors.ts` found **seven**
codes affected, not just the one named: `langy_ui_turn_inactive`,
`langy_ui_action_unknown`, `langy_ui_payload_invalid`, `langy_ui_no_browser`,
`langy_ui_experiment_required`, `langy_ui_timeout`, `langy_ui_handler_failed`
— all silently returning `{}` (no tips). This is a customer-vs-agent split,
not a duplicate of `packages/handled-error`'s registry:
`packages/handled-error/src/presentation.ts` already carries the human-facing
toast copy for `langy_ui_timeout`/`langy_ui_handler_failed`; `langy.error-remediation.ts`
feeds the separate `meta.tips` array the **agent** reads off the CLI
envelope, for all seven UI-action codes, not just the two that also reach a
human.

Fixed: `packages/features/langy/contract/src/langy.error-remediation.ts` —
added all seven `langy_ui_*` entries, tip text ported verbatim from
`origin/main:platform/app/src/server/app-layer/error-remediation.ts:563-608`.

Test: extended the existing
`packages/features/langy/contract/src/__tests__/langy-ui-handler-failed-remediation.unit.test.ts`
(already covered the inner-code-override case, which was passing) with a new
case asserting the base `langy_ui_handler_failed` tip appears when the page
named no code — `.tips` was `undefined` before this fix, now matches main's
text. `pnpm --filter @langwatch/langy-contract test:unit src/__tests__/langy-ui-handler-failed-remediation.unit.test.ts`
→ 4/4 pass; full package `pnpm --filter @langwatch/langy-contract test:unit`
→ 490/490 pass.

### 9. Connected agents (ADR-128) mounting — correction to "verified-fixed"

The package-level restoration is real (commits `a28ba0c995`, `c7384b57c8`,
`f725772083`, `e705f9c950`: `/api/v1/agents*` REST handlers, `ConnectGateway`,
`agents.testRun`/`testTurn` tRPC, connected-target resolution by name). But
`grep -rln "createAgentV1RestApp\|ConnectGateway\|agent-v1.api\|AgentsV1Deps" apps/api/src`
returns **nothing** — the REST family and the WebSocket/long-poll gateway are
fully implemented in `packages/features/agent/server` and mounted nowhere in
the live API process. `apps/api/src/app-rest/app-rest.packaged-families.ts`
mounts only `createAgentLegacyRestApp` (the `/api/agents` alias).

This is not a gap I'm fixing or handing off fresh: `dev/docs/plans/connected-agents-restore-plan.md`
(80KB, actively updated today through a "fourth pass," §12) already names
this exact gap precisely — "Not started — Slice 7 (apps/api half)...
mounting `createAgentV1RestApp`... blocked on `a8c54399437b5abf2` finishing
`api-production.composition.ts`" — and is coordinating with another
in-session agent by name to land it, in `apps/api/src/app/**` (restricted for
this pass). No action taken here; flagging only because the original doc's
"restore plan: see connected-agents-restore-plan.md" line could be misread
as already resolved.

### 10. `agents.testRun` / `agents.testTurn` — verified-fixed

`packages/features/agent/server/src/transport/api-trpc/agent.api.ts:307-333`
mounts both (`testTurn`, `testRun`, calling `ctx.app.agents.testTurn`/
`testRun`), restored by commit `f725772083` ("Restore agent testing, suite
run plans and the connected-agent domain half"). No action needed.

### Packages the root session should typecheck

Per this session's rules, `pnpm typecheck` was never run here. The root
session (or CI) should scope a check to the packages this pass touched:
`@langwatch/scenario-server`, `@langwatch/scenario-contract` (import-only,
untouched but consumed), `@langwatch/suite-server`, `@langwatch/suite-contract`
(import-only), `@langwatch/langy-contract`, `@langwatch/worker`,
`@langwatch/dataset-server` (import-only, consumed by the worker composition
changes), `@langwatch/stored-object-server` (import-only).

### Concurrent-worktree note

This session shares its working tree with other active agents (per the
system prompt's agent roster). Two observations for whoever reads this next:
mid-session, uncommitted edits to `packages/features/suite/server/src/services/suite-execution.service.ts`
and a new test file under `packages/features/suite/server/src/repositories/prisma/__tests__/`
were swept into another agent's commit (`e705f9c950`) — `git diff HEAD`
against those paths came back empty even though this pass had not committed
anything itself, confirmed by `git log --oneline` for those exact paths
landing in that commit. Content was verified correct and tests still pass;
noted as a known hazard (see `agent-bare-stash-sweeps-fleet` / `never-git-add-all-while-agents-edit`
precedent), not a defect in the work itself. Separately,
`apps/worker/src/app/worker-production.composition.ts` picked up an
unrelated concurrent addition (`installWorkerConnectedAgentRuntime`, imported
and called around line 454) mid-pass; the two pre-existing "monthly billing
roll-up" test failures in `worker-production.composition.unit.test.ts`
(`resolveClickHouseClient`/`checkpointFindUnique` call-count assertions) were
independently confirmed unrelated to any composition edit — including this
pass's — by `connected-agents-restore-plan.md` §12's own before/after revert
test, so they are not re-litigated here.
