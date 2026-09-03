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

- **Connected agents (ADR-128) have no transport on this branch.** `platform/app/src/server/connected-agents/` on main (connect gateway, long-poll transport and process, parameter spec, call envelope, presence projection) and the agents UI section were never carried over; only the runtime service and four adapters moved. Restore plan: `dev/docs/plans/connected-agents-restore-plan.md`.
- **`agents.testRun` / `agents.testTurn`** are called by scenario/web and defined nowhere. Their dependencies (agent-test prefetcher, serialized-agent registry) exist in scenario/server; lift in progress.
- **Azure dataset storage refuses in the worker.** Main's `getDatasetStorage(projectId)` picked S3, Azure or local by destination; the branch inlines the choice per composition root and `WorkerDatasetStorageResolver` in `apps/worker/src/app/worker-dataset-normalization.composition.ts` throws for Azure. Self-hosted Azure deployments lose dataset normalisation.
- **Dataset tRPC conflict errors were raw `TRPCError`s** instead of the `DatasetNameTakenError` / `DatasetStaleColumnsError` handled errors; fixed in `packages/features/dataset/server/src/transport/api-trpc/dataset.api.ts` during the lift.
- **Langy `langy_ui_handler_failed` remediation** exists only in packages/handled-error's registry, not in langy/contract's own tips map.
- **Simulation run cost attribution lost its write-suppression guard.** Main's `hasRunDefiningEvent` check went with the old store class and was not reimplemented; two of the three scenarios in `simulation-run-cost-attribution.feature` cannot bind until it returns.
- **`scenarios.getRunConfigurations` has no service.** The ClickHouse run-configurations service and repository from main are absent repo-wide, and the web still calls the procedure.
- **Workbench Langy handoff is gone.** `useRegisterLangyActions` and the workbench's Langy UI-action registration existed on main; the branch's `workbench.screen.tsx` has neither, and the `UiActionBackendRunner` type in langy has no implementation wired. A spec-lift lane retired the tests; treat as a feature to restore.
- **`SuiteExecutionService.resolveParameters` does not merge target-level parameters** (found porting prompt/server tests).
- **`resolveDynamicRunMembership` locks `kind = 'custom'` then reads `kind: "run_plan"`**, so its `FOR UPDATE` matches nothing (suite/server, pre-existing).
