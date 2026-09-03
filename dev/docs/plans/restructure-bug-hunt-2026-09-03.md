# Restructure bug hunt — 2026-09-03

Branch: `feat/strict-feature-layout-v0` vs `origin/main`. Read-only investigation;
no product code was edited, staged, or committed. Two parallel research agents
covered Part A (REST + tRPC surface vs. main) and Part B (boot both dev paths
and exercise the running stack).

## Severity-ranked summary

| Severity | Count | Class |
| --- | --- | --- |
| Critical | 45 | REST operations documented in the frozen OpenAPI spec, unmounted on this branch |
| Critical | 18 | tRPC procedures called by the web with no matching server procedure, incl. `agents`/`secrets` namespaces that mount only when their services resolve (corrected below) |
| High | 1 | `haven` binary must be rebuilt (`make haven install`) after this branch lands, or every dev/agent with a pre-existing binary hits a hard boot refusal |
| Medium | 1 | Concurrent-worktree interference (`packages/identity-eventing` mid-move) blocked live verification of api/worker boot — resolved during this investigation, not a branch bug itself, but the branch offered no isolation from it |
| Informational | several | Legacy `/api/agents` alias still mounted and works; UI/gateway/nlpgo lanes boot and serve cleanly; `langwatch-public-config` meta tag carries no secrets |

**Single most severe finding (corrected after verification by the orchestrator):**
the `/api/v1/agents*` REST family and the connected-agent long-poll gateway are
unmounted, and the eight scenario/suite/agent tRPC procedures below have no
server half. The `agents` and `secrets` tRPC namespaces ARE on the production
path: `apps/api/src/api.process.ts` builds `ApiApplication` and passes the
agents and secrets services `api-production.composition.ts` resolves
(`resolveAgents`, `resolveSecrets`), and the application mounts `AgentTrpcApi`
and `SecretTrpcApi` whenever those services are present. They are absent only
when the composition cannot resolve them: agents when the database or the agents
composition is missing, secrets when the database or the secret-encryption port
is missing. Each absence is a logged named absence, not a silent drop. A boot
with a real database and encryption key must still confirm both namespaces
answer; that probe did not run in this pass.

---

## Part A — REST surface vs. the frozen OpenAPI document

The repo already has an automated drift guard for exactly this question:
`apps/api/src/tasks/openapi-document/openapi-document.checker.ts`, exercised
by `apps/api/src/tasks/openapi-document/__tests__/openapi-document.unit.test.ts`.
It regenerates the live route surface from the actual
`createApiProcessRestFeatures` composition and diffs it against the frozen
`apps/api/src/features/discovery/openapi-document.json`.

**That test is red on this branch right now: 45 operations are unserved**
against an allow-listed baseline of only 3 pre-existing, deliberate gaps.

Repro for the whole class:

```
pnpm --filter @langwatch/platform-api test:unit run \
  src/tasks/openapi-document/__tests__/openapi-document.unit.test.ts
```

```
Route                                          | Method             | Mounted?                                                                                       | Auth matches main? | Shape drift | Behaviour vs main                            | Severity | Repro
------------------------------------------------+--------------------+-------------------------------------------------------------------------------------------------+---------------------+-------------+-----------------------------------------------+----------+--------------------------------------------
/api/v1/agents                                  | GET, POST          | NOT MOUNTED — no basePath "/api/v1/agents" anywhere in packages/features/agent/server           | N/A (404)           | N/A         | main served this; now 404                    | Critical | curl /api/v1/agents -> 404
/api/v1/agents/{id}                             | GET/PATCH/PUT/DEL  | NOT MOUNTED                                                                                      | N/A                 | N/A         | agent CRUD by id broken                      | Critical | curl /api/v1/agents/x -> 404
/api/v1/agents/{id}/call                        | POST               | NOT MOUNTED — only a client reference (serialized-connected-agent.adapter.ts:145) calling OUT   | N/A                 | N/A         | invoking an agent via API broken             | Critical | curl POST /api/v1/agents/x/call -> 404
/api/v1/agents/{id}/test                        | POST               | NOT MOUNTED                                                                                      | N/A                 | N/A         | test-run trigger broken                      | Critical | curl POST /api/v1/agents/x/test -> 404
/api/v1/agents/connect/register                 | POST               | NOT MOUNTED — ConnectedAgentRuntimeService exists but wired to no REST transport                 | N/A                 | N/A         | connected-agent onboarding broken            | Critical | curl POST /api/v1/agents/connect/register -> 404
/api/v1/agents/connect/poll                     | GET                | NOT MOUNTED (same runtime, no transport) — the long-poll gateway                                 | N/A                 | N/A         | agent long-poll gateway entirely absent      | Critical | curl GET /api/v1/agents/connect/poll -> 404
/api/v1/agents/connect/frames                   | POST               | NOT MOUNTED (same)                                                                               | N/A                 | N/A         | frame delivery broken                        | Critical | curl POST /api/v1/agents/connect/frames -> 404
/api/agents (legacy alias)                      | GET/POST/etc.      | MOUNTED — agent-legacy.api.ts:59, "agents" family in app-rest.packaged-families.ts               | matches             | none        | still works, distinct path from v1           | —        | informational only
/api/v1/run-plans                               | GET                | NOT MOUNTED — no run-plans family in ApiPackagedRestFamilyName, no server file at all             | N/A                 | N/A         | run-plan listing via API broken              | Critical | curl /api/v1/run-plans -> 404
/api/v1/run-plans/{id}                          | GET/DELETE         | NOT MOUNTED                                                                                      | N/A                 | N/A         | run-plan detail/delete broken                | Critical | curl /api/v1/run-plans/x -> 404
/api/v1/run-plans/run                           | POST               | NOT MOUNTED                                                                                      | N/A                 | N/A         | ad-hoc run-plan trigger broken               | Critical | curl POST /api/v1/run-plans/run -> 404
/api/v1/run-plans/{id}/run                      | POST               | NOT MOUNTED                                                                                      | N/A                 | N/A         | re-running saved plan broken                 | Critical | curl POST /api/v1/run-plans/x/run -> 404
/api/v1/test-suites                             | GET/POST           | NOT MOUNTED — suite.api.ts only mounts /api/suites, never /api/v1/test-suites                    | N/A                 | N/A         | v1 test-suite API absent (older path works)  | Critical | curl /api/v1/test-suites -> 404
/api/v1/test-suites/{id}                        | GET/PATCH/DELETE   | NOT MOUNTED                                                                                      | N/A                 | N/A         | v1 test-suite detail broken                  | Critical | curl /api/v1/test-suites/x -> 404
/api/v1/test-suites/{id}/run                    | POST               | NOT MOUNTED                                                                                      | N/A                 | N/A         | v1 test-suite run trigger broken             | Critical | curl POST /api/v1/test-suites/x/run -> 404
/api/organization (+invites/members/access, 9)  | GET/POST/PATCH/DEL | NOT MOUNTED — gated behind options.organizations, unsupplied at live composition                 | N/A                 | N/A         | org settings/invites/members via REST 404    | Critical | curl /api/organization -> 404
/api/role-bindings (+/{id}, 4)                  | GET/POST/PATCH/DEL | NOT MOUNTED — gated behind options.authzComposition, unsupplied                                  | N/A                 | N/A         | granting/revoking bindings via REST 404s     | Critical | curl /api/role-bindings -> 404
/api/roles (+/{id}, /permissions, 5)            | GET/POST/PATCH/DEL | NOT MOUNTED — gated behind options.productGroup, unsupplied                                      | N/A                 | N/A         | custom-role CRUD via REST 404s               | Critical | curl /api/roles -> 404
/api/scim-tokens (+/{id}, 3)                    | GET/POST/DELETE    | NOT MOUNTED — same orgGroup gate as scim                                                         | N/A                 | N/A         | SCIM token provisioning via REST 404s        | Critical | curl /api/scim-tokens -> 404
Remaining ~253 documented operations            | all                | MOUNTED (absent from the 45-item regression list; security-scheme diff also passed)              | not individually verified | not checked (checker only diffs presence + auth scheme) | presumed equivalent, unverified | — | n/a
```

All four families the task named as known-broken are confirmed unmounted —
no `basePath` for any of them exists anywhere under `packages/features/**` or
`apps/api/src/**`:

- `/api/v1/agents*`
- `/api/v1/run-plans*`
- `/api/v1/test-suites*`
- the connected-agent long-poll gateway (`/api/v1/agents/connect/*`)

The sweep also surfaced **three more unmounted families beyond what was
asked**, all traced to `api-packaged-rest.composition.ts` gating those
families behind optional constructor inputs that aren't supplied wherever the
live process actually composes it:

- `/api/organization*` — gated behind `options.organizations`
- `/api/role-bindings*` — gated behind `options.authzComposition`
- `/api/roles*` — gated behind `options.productGroup`
- `/api/scim-tokens*` — gated behind the same org group

Shape drift on the ~253 still-served routes was not individually spot-checked
(the automated checker only diffs path presence + auth scheme, not full
request/response shape) — out of budget for this pass; flagged as a residual
unknown.

---

## Part A — tRPC procedures called by the web with no server implementation

```
Namespace.Procedure                | Web call site (file:line)                                                                          | Server procedure exists? | Router composition file                                                                                                                                                | Severity | Repro
------------------------------------+-----------------------------------------------------------------------------------------------------+---------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------+---------------------------------------------------
suites.runPlan                     | packages/features/scenario/web/src/ui/sections/agent-testing/run/use-run-dialog-batch.ts:152      | NO — only `run`/`runAll` exist | packages/features/suite/server/src/transport/api-trpc/suite.api.ts                                                                                                    | Critical | Run-plan run dialog: mutateAsync throws NOT_FOUND
scenarios.getResultsOverview       | .../results/use-result-groups.ts:221                                                               | NO                        | packages/features/scenario/server/.../scenario.api.ts (5 sub-routers merged, no results-atom router)                                                                  | Critical | Results tab load throws NOT_FOUND
scenarios.getResultAtoms           | .../results/use-result-groups.ts:234                                                               | NO                        | same                                                                                                                                                                    | Critical | Result rows page never loads
scenarios.getCodeScenarios         | .../results/use-result-groups.ts:563                                                               | NO                        | same                                                                                                                                                                    | Critical | Code-scenario filter list empty/throws
scenarios.getRunTargets            | .../results/use-result-groups.ts:569                                                               | NO                        | same                                                                                                                                                                    | Critical | Run-target filter list empty/throws
scenarios.getRunConfigurations     | .../run/use-run-configuration-history.ts:54                                                        | NO                        | same (run-configurations router never merged in)                                                                                                                       | Critical | Run-config history panel throws NOT_FOUND
agents.testRun                     | packages/features/scenario/web/src/ui/sections/agents/use-agent-test-run.ts:18                     | NO — whole agents namespace absent | (none — see below)                                                                                                                                            | Critical | "Test agent" button throws NOT_FOUND
agents.testTurn                    | packages/features/scenario/web/src/ui/sections/agents/agent-test-panel.tsx:34                      | NO                        | (none)                                                                                                                                                                  | Critical | Agent conversation test panel throws NOT_FOUND
agents.{getAll,getById,create,update,delete,getCopies,copy,pushToCopies,syncFromSource,getHistory,getRelatedEntities,cascadeArchive} | packages/features/agent/web/src/screens/agent-management/agent-management.screen.tsx:247 (+others) | CONDITIONAL — mounted by `ApiApplication` when `resolveAgents` yields a service (needs database + agents composition); verify at boot | High | Agent Management screen: every query 404s, page is unusable
secrets.{list,create,update,delete} | packages/features/secret/web/src/screens/secret/secrets.screen.tsx:70,76-78                        | CONDITIONAL — mounted by `ApiApplication` when `resolveSecrets` yields a service (needs database + secret-encryption port); verify at boot | High | Secrets settings screen: every query/mutation 404s
```

Confirmed on `origin/main` for contrast: `platform/app/src/server/api/root.ts:97`
mounted `agents: agentsRouter` at root (with `testRun`/`testTurn` at lines
598/556 of `routers/agents.ts`); `scenarios/index.ts` flat-merged
`resultAtomsRouter` and `runConfigurationsRouter` alongside CRUD/events/etc;
`suites/suite.router.ts` had both `run` (line 144) and a distinct `runPlan`
(line 217). All of these were dropped or never re-merged during the
restructure.

**Broader sweep for the same bug class:** every other
`*Api.<namespace>.<procedure>.use(...)` call-site family found in the web
packages (`modelProviderApi`, `navigationApi` → `ops`/`governance`/`limits`,
`dataRetentionApi`, `governanceApi`, `topicApi` → `topics`/`project`,
`automationApi` → `emailSuppression`/`automation`, `gatewayApi`, `projectApi`,
`promptApi`, `annotationApi`, etc.) was cross-checked against the full
namespace list mounted in `apps/api/src/app-trpc/app-trpc.features.ts`
(`traceGroup` (16) + `orgGroup` (9) + `agentGroup` (6) + `productInfra` (3) +
`gatewayGroup` (21) + ~24 standalone entries). Every one resolved to a real
mount point except `agents` and `secrets` above — no further undiscovered
whole-namespace gaps found within budget, though individual missing
procedures inside otherwise-mounted namespaces were not exhaustively checked
beyond the known list.

---

## Part B — boot both dev paths and exercise the running stack

`.env` exists at the repo root (contents not read or printed beyond variable
names).

### Boot 1: plain `pnpm dev`

Attempted 3 times, each torn down between attempts with the port-scoped
`bash dev/scripts/kill-dev-tree.sh 5560,6560,5561,5563,2999`.

**Blocker on every attempt (Medium, environmental, not a branch bug):**
api and worker lanes crash-looped with `ERR_MODULE_NOT_FOUND`:

```
Cannot find module '.../packages/identity-eventing/src/adapters/postgres.identity-pipeline.adapter'
imported from .../packages/identity-eventing/src/index.ts
```

`git status --porcelain -- packages/identity-eventing` showed 36–50 files
staged as pure deletions with zero matching additions at the time — a
concurrent agent mid-move on that whole package in the shared worktree, not a
committed state of this branch. By the time this investigation finished, the
same path showed clean renames (`R`/`RM`), i.e. the concurrent move had
completed and the interference had resolved. **Not counted as a
strict-feature-layout-v0 product bug**, but flagged because the branch/worktree
offered no isolation from it, and it fully blocked independent live
verification of api/worker boot during this pass.

Log error/warning classes observed (deduped):

| Class | Lane(s) | Note |
| --- | --- | --- |
| `ERR_MODULE_NOT_FOUND` (identity-eventing) | api, worker | see above — environmental |
| "otel collector unreachable" / "suppressing further export errors" (endpoint `http://localhost:4318`) | gateway, nlpgo | expected — no local OTel collector running |
| "failed to prepare provider sgl/ollama: base_url is required" | gateway | expected — no local sgl/ollama endpoint configured |
| `statusprobe_control_plane_unreachable` (repeating ~15s) | gateway | downstream consequence of api never staying up |
| transient `ECONNREFUSED` to ClickHouse `:8123` at worker startup (attempt 1 only) | worker | CH answered fine seconds later on manual curl — looked like a boot-order race, did not recur |

Probes that succeeded (ui/gateway/nlpgo stayed up through every attempt even
while api/worker crash-looped):

- `GET http://localhost:5560/` → **200**. `langwatch-public-config` meta tag
  present and decodes cleanly: `appBaseUrl=http://localhost:5560`,
  `gatewayBaseUrl=http://localhost:5563`, `deployment=saas`,
  `mode=development`, a PostHog client key (not a secret — client keys are
  meant to be public), `capabilities={email:true,nlp:true,langevals:true}`,
  `passkeys=false`, `identityFrontDoor=false`. **No secrets present.**
- `GET http://localhost:5563/` (gateway root, unauthed) → 404 (expected, no
  route mounted there).
- `GET http://localhost:5561/` (nlpgo root) → 502.
- api/auth endpoints (`/api/health`, `/api/auth/session`,
  `/.well-known/openapi`, `/api/openapi.json`) → connection-refused every
  time, because api never stayed listening long enough. **Not independently
  verified live** — route locations identified via static grep only:
  - `GET /api/health` → `apps/api/src/api-process.lifecycle.ts:73`
  - `GET /api/auth/session` → `packages/features/auth/server/src/transport/api-rest/auth.api.ts:137`
  - OpenAPI doc serving → `apps/api/src/features/discovery/openapi-serve.ts`
    (`respondWithApiDocument`) + `apps/api/src/features/discovery/discovery-locations.ts`
    (`WELL_KNOWN_OPENAPI_PATH=/.well-known/openapi`,
    `API_OPENAPI_PATH=/api/openapi.json`)
- No LangWatch-specific dev API key variable found in `.env` (only
  third-party provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) —
  the `/api/collector` probe was skipped per the task's own instruction.
- Worker job-processing check (jobs enqueued but never processed, projection
  registration) — **not obtained**: worker never stayed up long enough to
  observe a job cycle.

Teardown confirmed clean after every attempt: `lsof -iTCP -sTCP:LISTEN -P |
grep -E ':(5560|6560|5561|5563|2999)\b'` empty; each `pnpm dev` root PID
(24281, 30649, 38563) confirmed gone via `ps -p`.

### Boot 2: `make haven up`

First attempt for this worktree **failed outright**:

```
haven: open /Users/afr/Source/github.com/langwatch/langwatch/platform/app/.env.portless: no such file or directory
```

Root-caused precisely: the installed binary at `/Users/afr/go/bin/haven` had
mtime **Aug 26 09:50**, while `tools/thuishaven/**` was last committed
**Sep 3 02:54 today** (part of this same platform/app-removal work). A full
`grep -rn "platform/app" tools/thuishaven --include=*.go` against current
source returns **zero matches** — the stale `platform/app` assumption is not
in any current `.go` file, it is baked into the **stale compiled binary**
predating the restructure.

**Finding (High): `haven` must be rebuilt (`make haven install`) after this
branch lands, or every developer/agent with a pre-existing `go install`ed
binary hits this exact hard refusal.** This is an onboarding/rollout gap for
the branch, not a code bug in the current layout — current source is already
correct.

After `make haven install` (rebuild from current source — an operational
step, not a code edit; binary mtime updated to Sep 3 16:48), the refusal was
gone and `make haven up` allocated a real per-worktree stack:

```
stack "feat-strict-feature-layout-v0" (redis db 13)
  app        https://app.feat-strict-feature-layout-v0.langwatch.localhost -> 127.0.0.1:60694
  api        .../api                                                       -> 127.0.0.1:60699
  gateway    https://gateway.feat-strict-feature-layout-v0.langwatch.localhost -> 127.0.0.1:60695
  nlp        https://nlp.feat-strict-feature-layout-v0.langwatch.localhost -> 127.0.0.1:60696
  idp        https://idp.feat-strict-feature-layout-v0.langwatch.localhost -> 127.0.0.1:60698
  postgres/redis reused shared instances
```

Codegen (`start:prepare:files`) then failed with `signal: killed` (consistent
with the investigation's 90s wrapper timing it out, not an obvious layout
bug), and the run then hit:

```
haven: migrations failed — nothing was dropped — fix the migration, or
run 'haven db reset': context canceled
```

`context canceled` is consistent with the wrapper's own timeout firing
mid-migration rather than a genuine migration defect — **not disambiguated**
within this investigation's time budget; flagged as a residual unknown rather
than a confirmed bug. HTTP probes against
`app.feat-strict-feature-layout-v0.langwatch.localhost` were **not reached**
because the stack never got past this step to a stable "up" state.

Teardown: `haven down` → `stack "feat-strict-feature-layout-v0" torn down
(databases kept)`. Confirmed after: all five ports empty via `lsof`; `ps aux`
showed no node/vite/tsx process rooted under this worktree's `apps/` or
`tools/` paths (other pre-existing worktrees' own stacks, e.g. `pr6900`,
`identity-slice1-auth`, were left untouched, as instructed).

### Final process state

No dev-stack process from this investigation is still running:

- `lsof -iTCP -sTCP:LISTEN -P | grep -E ':(5560|6560|5561|5563|2999)\b'` →
  empty.
- Every `pnpm dev` root PID from every attempt confirmed gone via `ps -p`.
- `haven down` confirmed the haven-managed stack for this worktree was torn
  down; no stray node process under this worktree's `apps/`/`tools/` paths
  remains.

---

## Residual unknowns (not confirmed either way, flagged for follow-up)

- Shape drift on the ~253 REST operations that ARE mounted — only path
  presence and auth scheme were automatically diff-checked, not full
  request/response body shape.
- Whether individual procedures are missing inside otherwise-mounted tRPC
  namespaces beyond the ones enumerated above (only whole-namespace gaps were
  exhaustively swept).
- Live verification of `/api/health`, `/api/auth/session`, and the served
  OpenAPI/discovery document — api never stayed up long enough in this
  worktree during the investigation window (see identity-eventing
  interference above). Static route locations are recorded above for a
  follow-up pass once the concurrent move has fully settled.
- Worker-lane job-processing behaviour (enqueued-but-unprocessed jobs,
  `absent(`/`Unavailable` capability warnings, unregistered projections) —
  not observed; worker never stayed up long enough.
- Whether the haven `migrations failed: context canceled` result is a real
  migration defect or purely an artifact of the investigation's own timeout
  wrapper — needs a re-run with a longer budget to disambiguate.

## Added 2026-09-03 evening, from the spec lift

- **[verified-fixed, commits `a28ba0c995`/`c7384b57c8`/`f725772083`/`e705f9c950`, mounting still open — see verification pass below] Connected agents (ADR-128) have no transport on this branch.** `platform/app/src/server/connected-agents/` on main (connect gateway, long-poll transport and process, parameter spec, call envelope, presence projection) and the agents UI section were never carried over; only the runtime service and four adapters moved. Restore plan: `dev/docs/plans/connected-agents-restore-plan.md`.
- **[verified-fixed, commit `f725772083`] `agents.testRun` / `agents.testTurn`** are called by scenario/web and defined nowhere. Their dependencies (agent-test prefetcher, serialized-agent registry) exist in scenario/server; lift in progress.
- **[fixed-now — see verification pass below] Azure dataset storage refuses in the worker.** Main's `getDatasetStorage(projectId)` picked S3, Azure or local by destination; the branch inlines the choice per composition root and `WorkerDatasetStorageResolver` in `apps/worker/src/app/worker-dataset-normalization.composition.ts` throws for Azure. Self-hosted Azure deployments lose dataset normalisation.
- **[verified-fixed, commit `4fe2f10c4b`] Dataset tRPC conflict errors were raw `TRPCError`s** instead of the `DatasetNameTakenError` / `DatasetStaleColumnsError` handled errors; fixed in `packages/features/dataset/server/src/transport/api-trpc/dataset.api.ts` during the lift.
- **[fixed-now — see verification pass below] Langy `langy_ui_handler_failed` remediation** exists only in packages/handled-error's registry, not in langy/contract's own tips map.
- **[fixed-now — see verification pass below] Simulation run cost attribution lost its write-suppression guard.** Main's `hasRunDefiningEvent` check went with the old store class and was not reimplemented; two of the three scenarios in `simulation-run-cost-attribution.feature` cannot bind until it returns.
- **[handed-off — see verification pass below] `scenarios.getRunConfigurations` has no service.** The ClickHouse run-configurations service and repository from main are absent repo-wide, and the web still calls the procedure.
- **[handed-off — see verification pass below] Workbench Langy handoff is gone.** `useRegisterLangyActions` and the workbench's Langy UI-action registration existed on main; the branch's `workbench.screen.tsx` has neither, and the `UiActionBackendRunner` type in langy has no implementation wired. A spec-lift lane retired the tests; treat as a feature to restore.
- **[fixed-now — see verification pass below] `SuiteExecutionService.resolveParameters` does not merge target-level parameters** (found porting prompt/server tests).
- **[fixed-now — see verification pass below] `resolveDynamicRunMembership` locks `kind = 'custom'` then reads `kind: "run_plan"`**, so its `FOR UPDATE` matches nothing (suite/server, pre-existing).

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
