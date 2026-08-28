# Platform application exit plan

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Working checkpoint:** `1431f48836`

**Goal:** delete `platform/app` after its UI, API, worker, configuration,
backend, tests, assets and deployment responsibilities have canonical owners.

This is the executable ledger for the whole exit. It replaces the earlier
historical narrative with ordered work, dependencies, deletion boundaries and
verification gates. The shorter operational restart notes remain in the
[core hand-off](core-application-feature-extraction-handoff.md) and
[API transport hand-off](api-transport-extraction-handoff.md).

## Authorities and invariants

- `packages/features/catalogue.json` is the authority for the 49 singular
  feature owners.
- Accepted repository ADRs and each feature ADR/spec define architecture and
  behaviour. This plan records execution order, not a second architecture.
- `apps/api`, `apps/worker` and `apps/ui` are physical process composition
  roots. `apps/server` is local/development orchestration only.
- A feature owns its contract, canonical server implementation and reusable
  web behaviour. API, worker and UI processes install those surfaces; they do
  not reimplement them.
- Move one vertical and delete the displaced production implementation. A
  package-only copy or a compatibility wrapper containing business logic does
  not count as progress.
- Preserve URLs, procedure names, OpenAPI shapes, response fields, auth,
  errors, ordering, pagination, time/money units, effects, retries and
  idempotency unless an explicit decision changes them.
- Do not copy `platform/app/src/server/app-layer`. Replace its global graph with
  explicit process composition and injected complete services.
- Packages do not read environment modules. Each process parses and validates
  configuration once through `packages/config` and injects typed semantic
  values.
- API and worker construct one process-owned logger/tracer graph from
  `@langwatch/observability/node`; UI uses only browser-safe observability.
- Generated Prisma stays private to strict Prisma repository adapters.
- Core never imports Enterprise implementations. Role-specific Enterprise
  composition stays under `packages/enterprise/composition/**`.
- Shared-worktree changes are never staged wholesale. Root stages exact paths
  or hunks after migration review and commits coherent slices.

## Definition of done

The exit is complete only when all of the following are true:

1. `apps/api` is the live HTTP/tRPC/REST process and owns request context,
   auth, authorisation, limits, error mapping, logging, tracing and graceful
   shutdown.
2. `apps/worker` is the live background process and owns queues, Eventing,
   projections, process managers, wakes, retry-safe intents, scheduled tasks,
   logging, tracing, liveness and graceful drain.
3. `apps/ui` boots the browser, owns all routing/page composition and installs
   reusable feature-web screens/surfaces without `platform/app` imports.
4. Every catalogue feature has one canonical contract/service/repository graph;
   its API, worker and UI callers use it.
5. No production code uses global `App`, `getApp`, `tryGetApp`, global Prisma,
   package-level env access or import-time registration.
6. Public REST, internal tRPC, SDK, MCP, webhook, ingestion and generated
   OpenAPI/client contracts have explicit parity proof.
7. Prisma/ClickHouse migrations, tasks, assets, E2E suites, scripts,
   instrumentation, CI and deployment definitions no longer assume
   `platform/app`.
8. `platform/app` and every workspace, build, CI, Docker, deployment, docs and
   test reference to it are deleted.

## Current checkpoint

### Committed foundations

| Commit       | Durable result                                                                   |
| ------------ | -------------------------------------------------------------------------------- |
| `5f7f2046dc` | Schema-first public REST framework with explicit access/version/error policy.    |
| `0b65dc696d` | Architecture lint for fluent REST handlers.                                      |
| `6d86932ce9` | Public REST and internal tRPC are separate transport surfaces.                   |
| `13a0805bf3` | Prompt boundary, initial UI shell, frontend lint and Design System integration.  |
| `410c5dc1eb` | Enforced two-scope feature-web layout and exact screen/surface boundaries.       |
| `3d1166d8cc` | Semantic OpenAPI 3 comparator with recursive reference handling and CI coverage. |
| `1431f48836` | Previous coordinated extraction checkpoint.                                      |

### Active, uncommitted slices

| Slice                 | Current fact                                                                                                                                                                                                      | Next gate                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Agent web/UI          | Two-scope layout, controlled browser port and real platform host are implemented. Agent web has 24 passing tests, UI 10 and host 6.                                                                               | Final exact-path migration review and commit. Retained legacy drawers move in later Agent UI verticals.                               |
| Trace full-read       | Package mapper preserves normalized spans, legacy events, metrics/errors, metadata, bounded payload recall and privacy markers. Contract has 212 tests and server 1,108.                                          | Review and commit as internal/all-visible. Public viewer protection/edit overlays remain a separate trust-boundary slice.             |
| Process observability | One Node process logger/tracer graph and idempotent shutdown exist with 123 tests.                                                                                                                                | Review/commit, then construct once in API and worker boot and flush after drain.                                                      |
| Secret REST           | Supports canonical `/api/v1/secret`, modern alias `/api/secret`, version omission/latest/header semantics and deployed `/api/secrets` REST compatibility. The invented public RPC is removed in the working tree. | Regenerate OpenAPI after the unrelated identity Eventing import blocker is fixed, prove semantic parity and commit.                   |
| API Secret/Agent      | `@langwatch/trpc` and AuthZ scope-lineage extraction exist; the real process root is being built.                                                                                                                 | Directly cut live Secret and complete Agent tRPC to `apps/api`, with auth/audit/error/log/trace parity and displaced router deletion. |
| Eventing server       | `@langwatch/eventing/server` now has private Prisma ProcessStore, injected ClickHouse EventStore/repository, retention and a production runtime factory.                                                          | Review/commit, wire the worker and retain old adapters only for named replay/ops/gateway/webhook callers.                             |
| Enterprise worker     | `@langwatch/enterprise-worker` now composes the managed-provider capability from explicit ports; focused tests/typecheck pass.                                                                                    | Review/commit and wire typed config/credentials into the worker model-provider graph.                                                 |
| Topic worker          | Topic registers only through `WorkerEventingRuntime`; Eventing owns commands/events, projections, process-manager wakes, intents and redelivery.                                                                  | Install production dependencies and the Trace `assignTopic` consumer, then delete live app Topic registry/runtime/task paths.         |

Nothing in the active table counts as application-exit progress until reviewed
and committed with its safe `platform/app` deletion boundary.

## Measured exit inventory

At the working checkpoint, `platform/app` contains 6,307 tracked files,
including 5,951 under `src`. Counts include tests unless identified as
production-only and will be refreshed after each committed wave.

### Source cohorts

| Path cohort               |                                Files | Exit owner                                                                  |
| ------------------------- | -----------------------------------: | --------------------------------------------------------------------------- |
| `src/server`              |    1,925 total; about 927 production | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages |
| `src/server/app-layer`    |      379 total; about 191 production | Deleted through explicit API/worker composition; never copied               |
| `src/features`            |                                1,290 | Feature web/server packages and `apps/ui` composition                       |
| `src/components`          |                                1,173 | Feature web packages, Design System or `apps/ui` global UI                  |
| `src/pages`               |                                  260 | `apps/ui` screens/routes or API compatibility entries                       |
| `src/runtime`             |                                  226 | `apps/api`, `apps/worker`, `apps/ui`, config/observability packages         |
| `src/app`                 | 224; about 124 production API routes | Feature REST adapters and `apps/api` route composition                      |
| `src/experiments-v3`      |                                  196 | Experiment/Evaluation feature web and server packages                       |
| `src/utils`               |                                  175 | Owning feature or shared package, never a miscellaneous dump                |
| `src/hooks`               |       137 total; about 85 production | Feature web behaviour or `apps/ui` browser adapters                         |
| `src/prompts`             |                                  136 | Prompt feature web/server packages                                          |
| `src/optimization_studio` |                                   70 | Agent/Workflow/Scenario/Evaluation web packages                             |
| `src/tasks`               |        24 total; about 15 production | Worker task registry or explicit migration/tool packages                    |

### Non-source cohorts

| Path cohort |                                   Files | Exit requirement                                                                        |
| ----------- | --------------------------------------: | --------------------------------------------------------------------------------------- |
| `scripts`   |                                     136 | Re-home by owning feature/process/tool; remove app working-directory assumptions        |
| `public`    |                                      90 | Move browser assets to `apps/ui` or owning web package                                  |
| `e2e`       |                                      63 | Point at physical API/UI/worker processes without app imports                           |
| `specs`     |                                      30 | Move feature behaviour to owning feature; keep true application specs with physical app |
| `prisma`    | 3 plus generated/migration dependencies | `packages/prisma-client` and strict feature repositories                                |

The architecture baseline currently classifies 935 legacy fragments across 892
unique files: 558 page shells, 250 implementations, 99 transports, 26
composition files and two infrastructure adapters. Refresh the baseline rather
than using older forecast counts. Current source also has roughly 306
`getApp`/`tryGetApp` matches across 91 non-test files and roughly 745 direct
`prisma.` matches.

### Largest backend residuals

- global boot/config: `server.mts`, `start.ts`, `task.ts`, `runtime/config.ts`,
  `runtime/app/**`, instrumentation, shutdown and metrics;
- global application graph: `server/app-layer/app.ts`, presets and global
  accessors;
- internal API: `server/api/**`, including the root router and roughly 259
  router/test modules;
- public/internal HTTP: `server/api-router.ts` and `src/app/api/**`;
- Eventing: `server/event-sourcing/**`, worker runtime, registry, replay,
  ProcessStore and EventStore adapters;
- data/infrastructure: `server/clickhouse/**`, global Prisma/Redis, storage,
  mail, Stripe, Slack, AWS, WebSocket, NLP and model clients;
- feature residue: analytics, traces, gateway, stored objects, model providers,
  evaluations, workflows, Langy, governance and billing.

### Largest UI residuals

- 151 declared routes and 558 page-shell baseline entries;
- `components/settings` (101), `components/agent-testing` (126),
  `components/ops` (87), shared UI/icons (108), suites (60), gateway (47),
  scenarios (35), datasets (25), analytics (24), traces (21), evaluators (23),
  evaluations (19), agents (remaining drawers) and other domain folders;
- `features/traces-v2` (662), `features/langy` (224), onboarding (106),
  auth-front-door (56), navigation (54), command-bar (47), automations (45),
  analytics-query (40) and errors (24);
- the old main entry, providers, layouts, route table, redirect table, about 50
  drawer keys, global browser state and 198 browser files crossing into
  server/backend boundaries.

Only 24 catalogue features currently have a web package, and only Agent and
Prompt expose strict screen/surface boundaries. Create web surfaces only for
features that own reusable browser behaviour. The catalogue also lists `auth`
while `packages/features/auth` is absent; inventory and establish that owner
before migrating the Better Auth/session cohort rather than scattering it into
User or app composition.

## Resolved decisions

1. **Eventing adapters:** use a server-only `@langwatch/eventing/server` export.
   The existing package already owns queues, Redis, telemetry, stores and
   process-manager runtime; do not create another package or put adapters in
   Topic/worker.
2. **ClickHouse:** the managed tenant-aware resolver stays in
   `@langwatch/clickhouse-client`. Eventing and features consume it through
   injected typed dependencies.
3. **Queue payloads:** Group Queue owns shared payload offload, staging headers,
   cleanup, limits and retry/redelivery semantics.
4. **Enterprise model providers:** extend existing
   `@langwatch/enterprise-worker`; core worker consumes the portable service and
   never imports Enterprise implementations.
5. **Agent tRPC:** mount the complete thin compatibility router, preserving
   names/shapes over one Agent service graph.
6. **API activation:** perform a direct cutover after heavy parity/integration
   testing. Do not add a parallel deployment phase.
7. **Secret REST:** support `/api/v1/secret` and `/api/secret`; missing path and
   header version selects latest, an explicit date/`latest` may be in the path,
   and `X-API-Version` is optional with conflict rejection. `main` OpenAPI proves
   deployed compatibility is five REST operations on `/api/secrets` and
   `/api/secrets/{id}`. There is no deployed public Secret RPC; remove the
   branch-invented `/api/secrets/{version}/secrets.*` family. Internal app tRPC
   is separate.
8. **Trace full-read:** keep canonical full-read internal and all-visible.
   Public actor/viewer protection is a separate service/trust boundary that
   composes canonical read, protection and edit overlays later.

## How to execute the plan

Use this loop continuously until the final gate passes:

1. Select the highest ready item whose dependencies are complete. Parallel
   lanes must own non-overlapping paths or coordinate a named interface.
2. Run `feature-inventory` for a broad/unclear slice and record old callers,
   response/effect parity, target owner and exact deletion boundary.
3. Run `feature-migration` for one vertical. Rewire all in-scope production
   callers and move equivalent tests before deleting displaced code.
4. Run `feature-migration-review`. Fix architectural honesty, behaviour,
   coverage, composition and residue findings before staging.
5. Run the slice checks, inspect exact staged paths/hunks and commit one coherent
   batch. Shared lockfile/baseline hunks must be attributed to that batch.
6. Update this plan with the commit hash, new measured counts, deliberate
   residuals and newly ready work.

Do not wait for the entire programme before committing. “One go” means this
ordered runbook can be driven continuously, not that all files belong in one
commit.

## Continuous execution order

Items in the same wave may run concurrently when their path ownership is
independent. A later wave may start for a feature whose explicit dependencies
are already green; it need not wait for unrelated features in an earlier wave.

### Wave 0: reconcile and commit current work

| ID     | Work                                                                                     | Exit gate                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `C-01` | Reconcile workspace links and `pnpm-lock.yaml` after all active manifest writers finish. | New workspace imports resolve; lock diff contains only required importers/resolutions.                               |
| `C-02` | Review and commit Agent UI.                                                              | Focused Agent/UI/host proof green; exact displaced page/card/history/copy/push code deleted; retained drawers named. |
| `C-03` | Review and commit Trace full-read.                                                       | Internal parity mapper proof green; no false public cutover claim.                                                   |
| `C-04` | Review and commit process observability.                                                 | API/worker-ready Node export, tests and no browser dependency leak.                                                  |
| `C-05` | Finish Secret REST correction.                                                           | Main REST retained, both modern prefixes/version modes proven, invented RPC removed, semantic OpenAPI accurate.      |
| `C-06` | Finish tRPC/AuthZ/API Secret+Agent direct cutover.                                       | One live API graph, complete routers, auth/audit/error/log/trace proof and old router deletion.                      |
| `C-07` | Finish Eventing server and Enterprise worker composition.                                | Production factories and typed ports green; shared legacy adapters retained only for named remaining callers.        |
| `C-08` | Finish Worker Topic cutover.                                                             | Durable queue/store composition plus Topic and Trace-assignment consumers green; live app Topic paths deleted.       |

### Wave 1: process foundations

#### Configuration and boot

- [ ] Make `packages/config` the only parser for private runtime configuration.
- [ ] Define separate typed API, worker, UI-public and local-orchestrator
      configuration projections.
- [ ] Move `runtime/config.ts`, public config, instrumentation configuration and
      process-role switches to their physical apps.
- [ ] Replace package `process.env` access with injected semantic values.
- [ ] Preserve credential-secret compatibility, queue settings, ClickHouse
      routing, Redis, storage, mail, external model, rate-limit and retention
      configuration.
- [ ] Delete old config modules only after API/worker/UI boot tests cover
      invalid, missing and role-specific configuration.

#### Process lifecycle and observability

- [ ] Construct Prisma, Redis, ClickHouse, Group Queue, storage and external
      clients once per owning process.
- [ ] Bind request/queue trace context and structured logger fields.
- [ ] Preserve readiness/liveness, metrics, profiling and handled-error capture.
- [ ] Drain HTTP/queues/features first, then flush tracing/logging and close
      database/network resources; retain the first shutdown failure while running
      every cleanup.
- [ ] Move `server.mts`, `start.ts`, `task.ts`, instrumentation and shutdown
      entry points to physical apps or local orchestration.

#### Persistence and infrastructure

- [ ] Keep Prisma generation/readiness/migrations in `packages/prisma-client`.
- [ ] Move each direct Prisma query into its singular feature’s private strict
      repository; no feature consumes another feature’s repository.
- [ ] Keep ClickHouse connection/resolution/migrations in
      `@langwatch/clickhouse-client`; move feature queries into feature adapters.
- [ ] Finish `@langwatch/eventing/server` ProcessStore/EventStore/retention
      composition.
- [ ] Move storage, mail, Stripe, Slack, AWS, WebSocket, NLP/Langevals and model
      client construction into explicit process adapters.

Gate: API and worker independently construct one explicit graph without global
App, package env reads or request/job-time service construction.

### Wave 2: identity, tenancy and access

Move these owners before broad product transport cutover:

- `auth`, Better Auth/session lifecycle and revocation;
- `user`, `organization`, `project`, `role`/role binding;
- `authz` scope lineage, grant decisions and cache;
- `api-key`, PAT/admin/project-key actor semantics;
- `entitlement` and Enterprise `licensing`, `sso`, `scim`, `saas` composition.

Required proof:

- actor extraction for browser session, project API key, PAT and admin;
- exact tenant/project target and `X-Project-Id` matching;
- permission denial/error status and error-shape parity;
- session revocation, invite/membership and personal-workspace invariants;
- core/Enterprise import direction;
- no product handler reads Prisma or `getApp` for access decisions.

Gate: every later API handler can rely only on `context.app`/`ctx.app`,
`actor()` and `authorize()`.

### Wave 3: API application and every transport

#### API process root

- [ ] Finish one Hono/tRPC server and listener in `apps/api`.
- [ ] Own request IDs, body limits, CORS, auth, authorisation, audit, rate limits,
      handled errors, response logging, trace context and shutdown.
- [ ] Compose each feature service/installer once at boot.
- [ ] Remove the live dependency on the universal app graph as routers move.

#### Public REST

- [ ] Inventory every `src/app/api/**` route, method, auth mode, response schema,
      ordering constraint and OpenAPI operation.
- [ ] Move feature routes to feature-server REST adapters and mount in
      `apps/api`; keep compatibility aliases thin and explicit.
- [ ] Preserve special ordering: concrete routes before catch-alls, auth CLI
      before Better Auth, gateway OpenAPI before parameter routes and experiments
      v3 before siblings.
- [ ] Cover ingestion/collector, OTEL/RUM, SSE, MCP, admin/ops/health/cron,
      uploads/exports, webhooks and internal control-plane routes, not only product
      CRUD.

#### Internal tRPC

- [ ] Replace each module under `server/api/routers/**` with an owning feature
      app-tRPC adapter over the canonical service.
- [ ] Keep exact procedure names, input/output shapes, transformer, errors,
      permissions, audit and trace behaviour.
- [ ] Move router integration/characterisation tests with each vertical.
- [ ] Delete each old router immediately after the live root mounts its package
      adapter; delete `server/api/root.ts` when the final router moves.

#### Other transports and clients

- [ ] Re-home MCP handlers, CLI bootstrap, webhooks, ingestion, cron and internal
      service endpoints by owner/trust boundary.
- [ ] Regenerate OpenAPI and TypeScript/Python/Go/MCP clients only from accepted
      transport changes.
- [ ] Use `openapidiff` against `main` for every public API batch.

Gate: `apps/api` serves the complete live route inventory and
`platform/app/src/server/api*`, `src/app/api`, `pages/api` and old API middleware
have no production responsibility.

### Wave 4: worker and Eventing application

- [ ] Compose `WorkerEventingRuntime` from production EventStore, ProcessStore,
      Group Queue, retention and execution targets.
- [ ] Register every feature pipeline before queue readiness.
- [ ] Install both producer-required command surfaces and worker consumers.
- [ ] Preserve deterministic projections/process managers and retry-safe,
      idempotent effect intents.
- [ ] Migrate pipeline groups in this order when dependencies permit:
  1. Topic plus Trace assignment;
  2. AuthZ grants, Metric and Log;
  3. Automation and GitHub maintenance;
  4. Trace processing and blob/process-manager maintenance;
  5. Evaluation, Scenario, Suite and Experiment;
  6. Coding Agent and Langy conversation/maintenance;
  7. Gateway spend;
  8. Enterprise Governance and Billing reporting;
  9. SSO/SCIM and remaining operational pipelines.
- [ ] Move manual tasks, schedules and child processes to worker-owned command
      dispatch; no task boots the universal App.
- [ ] Preserve replay/backfill, process-manager retention, wake scheduling,
      large-payload offload, delivery keys, metrics and shutdown ordering.

Gate: a fresh worker process consumes all queues and scheduled work without
`platform/app`, while API producers dispatch through the same Eventing
commands. Then delete old worker/runtime/event-sourcing/task registrations.

### Wave 5: UI application shell

#### Browser boot and providers

- [ ] Make `apps/ui` the actual browser entry instead of the legacy adapter.
- [ ] Move Design System system/theme creation, auth/session, public config,
      feature flags, PostHog/analytics, command bar, Langy, error boundaries,
      NProgress, chunk-reload and global feedback providers.
- [ ] Preserve the exact current provider order and
      `Suspense(fallback={null})`/`RouterProvider` behaviour.
- [ ] Keep Node/server packages outside recursive browser closure.

#### Routing and composition

- [ ] Move `routes.tsx`, redirects, layout routes, drawer/modal registry and
      route tests to `apps/ui`.
- [ ] Preserve every public/auth/settings/project/admin/ops/governance/gateway/
      share/MCP/onboarding URL, redirect and parameter.
- [ ] Represent page composition as owner-only feature screens plus narrow
      surfaces; transport hooks remain `apps/ui` adapters.
- [ ] Delete `LegacyUiShellAdapter` only after the final provider and route
      moves.

#### Global UI hierarchy

- [ ] Place portable global browser state under `apps/ui/src/model` or
      `behavior` and portable UI under `ui/{elements,blocks,sections}`.
- [ ] Place private feature composition under
      `apps/ui/src/features/<feature>/{model,behavior,ui}`.
- [ ] Move genuine reusable primitives/patterns to Design System; do not dump
      product components there.
- [ ] Eliminate browser imports of server/runtime implementation boundaries
      through narrow app-owned ports.

Gate: `apps/ui` owns boot/providers/routes and renders every legacy route with
no production import from the old UI shell.

### Wave 6: feature vertical programme

Each feature row means the complete remaining vertical: contract/service/
repositories, API transports, worker/Eventing, web screens/surfaces, app
composition, tests/spec/docs and displaced file deletion.

| Order | Feature owners                                                                                                     | Dependencies and emphasis                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `secret`, `stored-object`, `data-privacy`, `data-retention`, `feature-flag`, `notification`, `entitlement`         | Identity/config/storage; finish shared support capabilities used by later features.                                                                |
| 2     | `trace`, `log`, `metric`, `annotation`, `analytics`, `dashboard`, `share`, `topic`                                 | ClickHouse/Eventing/storage; preserve all trace fields and keep analytics/summaries/timeseries stores distinct.                                    |
| 3     | `model-provider`, `gateway`                                                                                        | Identity, secrets, credentials, ClickHouse/Redis, Enterprise managed provider; preserve virtual keys, budgets, guardrails, cache/routing/realtime. |
| 4     | `dataset`, `evaluator`, `evaluation`, `experiment`, `monitor`, `scenario`, `suite`                                 | Trace, model/gateway, storage and worker; preserve execution, retry, cancellation, cost and simulation semantics.                                  |
| 5     | `prompt`, `workflow`, `agent`                                                                                      | Model/gateway, datasets, traces and evaluation; move all authoring UI and complete Agent drawer/editor surfaces.                                   |
| 6     | `automation`, `coding-agent`, `github`, `langy`                                                                    | Eventing, model, trace, evaluation and external effects; preserve commands, process managers, MCP/CLI and browser flows.                           |
| 7     | `presence`, `ops` and remaining core composition                                                                   | Browser/worker/operational infrastructure; no miscellaneous service owner.                                                                         |
| 8     | Enterprise `audit-log`, `billing`, `governance`, `licensing`, `managed-provider`, `saas`, `scim`, `sso`, `webhook` | Role-specific Enterprise API/worker/web composition and licensing/tenant gates.                                                                    |

Identity owners from Wave 2 (`auth`, `user`, `organization`, `project`, `role`,
`authz`, `api-key`) are also complete verticals; Wave 2 merely schedules them
early because nearly every other feature depends on them.

For every row:

- inventory every app path by domain noun, route, Prisma model, event and DTO;
- consolidate duplicate readers/writers into the canonical service graph;
- characterize old behavior before replacing mappers/queries;
- preserve effects, retries, caches, rate limits, audit and metrics;
- move meaningful tests and delete equivalent app suites only after they pass;
- record any remaining compatibility transport/composition adapter by exact
  file and caller.

Gate: the feature has no behavior scattered across app-layer, server, runtime,
features, components, hooks and package surfaces.

### Wave 7: old UI feature and page drain

Migrate UI by coherent product route, not by source folder alone:

1. complete Agent and Prompt authoring pilots;
2. Trace Explorer/`traces-v2`, analytics/workbench and dashboards;
3. Dataset, evaluator, evaluation, experiment, scenario and suite workflows;
4. Workflow/optimization studio, model-provider and gateway UI;
5. Langy, automation, coding-agent and GitHub UI;
6. project/settings screens for secrets, API keys, roles, members, teams,
   retention, privacy, model costs/providers, topic and integrations;
7. auth, onboarding, home, navigation, command bar, errors and shared layouts;
8. ops/admin and Enterprise governance, billing, audit, SSO/SCIM/licensing and
   webhook UI;
9. public share, invite, unsubscribe, MCP authorization and remaining routes.

Each route slice must preserve loading/empty/error states, permissions,
drawers/modals, URL state, keyboard/browser behavior, telemetry and visual
structure. Use browser/host integration tests for composition and feature-web
tests for reusable behaviour.

Gate: delete `src/pages`, `src/components`, `src/hooks`, `src/features`,
`src/prompts`, `src/experiments-v3`, `src/optimization_studio`, old styles and
runtime UI after residue and route-parity proof reaches zero.

### Wave 8: backend residue drain

After feature verticals move, drain remaining cross-cutting server cohorts:

- mail/notification delivery and templates;
- storage, export, upload and staged payload infrastructure;
- rate limiting, invites, onboarding checks and home aggregation;
- saved views/filters/LWQL shared query adapters by actual feature owner;
- broadcast/websocket/presence infrastructure;
- auth callbacks, internal service routes and operational endpoints;
- migrations, replay/backfill and maintenance orchestration;
- any remaining analytics/traces/gateway/model-provider compatibility modules.

No miscellaneous `server` or `utils` package is allowed. Assign each file to a
feature, physical process or named infrastructure package and delete the old
path in the same slice.

Gate: `src/server` and `src/runtime` contain no production implementation or
composition needed by a live process.

### Wave 9: tasks, migrations and generated artefacts

- [ ] Move worker tasks and scheduled commands to `apps/worker`; move one-off
      developer/ops migrations to an explicit tool package or `apps/server`.
- [ ] Re-home Prisma seeds and ClickHouse migrations with their owning
      persistence package while preserving execution order and deployment tooling.
- [ ] Move OpenAPI generation/serving into `apps/api` and keep semantic diff in
      CI.
- [ ] Move SDK/MCP/skill generation to repository tools that consume canonical
      artefacts, not app modules.
- [ ] Regenerate TypeScript, Python, Go and MCP clients and compile/test them.
- [ ] Move API-reference generation, `llms` output and feature-map ownership to
      canonical routes.

Gate: fresh generation produces no unexplained diff and no task/tool imports or
boots `platform/app`.

### Wave 10: assets, tests and developer tooling

- [ ] Move public assets, fonts, images and browser manifests to `apps/ui` or
      owning web packages.
- [ ] Re-home E2E, browser, component, integration, Prisma, ClickHouse, stress,
      Stripe and MCP test configuration by physical app/package.
- [ ] Move test fixtures/helpers with their owner and delete duplicate bodies.
- [ ] Update local start/dev orchestration, Vite, TS configs and package scripts.
- [ ] Remove legacy Biome/Prettier assumptions; retain Oxfmt/Oxc.

Gate: all canonical tests run without setting `platform/app` as a package or
working directory.

### Wave 11: CI, packaging and deployment cutover

- [ ] Build separate UI, API and worker artefacts/images.
- [ ] Update root scripts, pnpm filters, Dockerfiles/Compose, Helm/Kubernetes,
      release workflows, cache keys, Semgrep paths and deployment health checks.
- [ ] Preserve database migration ordering, API readiness and worker graceful
      drain during rollout.
- [ ] Point production routing directly at the new API/UI and deploy the worker
      process. The API decision is direct cutover, not a parallel shadow service.
- [ ] Run full smoke/E2E against the built artefacts.

Gate: production-equivalent build and startup use only `apps/api`,
`apps/worker`, `apps/ui` and required packages.

### Wave 12: delete `platform/app`

- [ ] Prove zero production imports of `platform/app` and `@langwatch/web`.
- [ ] Prove zero workspace, lockfile, CI, Docker, deployment, script, docs,
      generated-client, test and asset references that require it.
- [ ] Prove zero global App access and package env reads.
- [ ] Prove generated Prisma is private to strict adapters.
- [ ] Remove architecture baseline entries for deleted paths; do not replace
      them with new baselines.
- [ ] Delete `platform/app` and its workspace/package aliases.
- [ ] Regenerate lockfile and generated artefacts from a clean checkout.
- [ ] Merge/rebase current `origin/main`, resolve semantically, and run the full
      verification matrix.

Gate: `git ls-files platform/app` returns nothing and every physical process
builds, starts, serves/consumes and shuts down independently.

## Verification matrix

Every coherent slice runs the relevant subset; every wave runs all applicable
rows. A red unrelated workspace check is reported exactly and never called
green.

| Area                | Required proof                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Contract/server/web | Package typechecks, unit/integration tests and declared scenarios                                  |
| API                 | Real caller/request tests, auth/permission/error parity, route inventory and OpenAPI semantic diff |
| Worker              | Queue/Eventing/process-manager/intent/replay/idempotency, liveness and shutdown tests              |
| UI                  | Feature-web tests, app adapter/host tests, browser route/interaction/visual parity                 |
| Persistence         | Prisma/ClickHouse integration where available, migrations and query/response characterization      |
| Clients/docs        | TypeScript/Python/Go/MCP generation and compile/tests; API-reference generation                    |
| Architecture        | Architecture lint with no new baseline, residue search and dependency-direction proof              |
| Hygiene             | Oxfmt, Oxc, `review:test-quality`, `review:comment-blocks`, `git diff --check`                     |
| Deployment          | Built-artifact smoke, readiness, graceful shutdown and clean-start test                            |

## Progress accounting

Only committed deletions count. After each migration commit, record the hash in
the active table, remove the completed item, name any residual and refresh:

```sh
git ls-tree -r --name-only HEAD platform/app | wc -l
git ls-tree -r --name-only HEAD platform/app/src | wc -l
rg -n "\b(getApp|tryGetApp|initializeApp|resetApp)\b" platform/app packages apps
rg -n "process\.env" packages apps
rg -n "platform/app|@langwatch/web" apps packages infra .github package.json pnpm-workspace.yaml
```

The end state is zero old application files, not a lower forecast.
