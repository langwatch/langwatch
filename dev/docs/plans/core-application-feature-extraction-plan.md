# Platform application exit plan

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Working checkpoint:** `6b9ca49158`

**Current execution wave:** Wave 1, process foundations

Complete the current wave gate before starting work from a later wave. Parallel
work is allowed only between independent items inside the current wave.

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
| `2d5066fcd7` | Moved the Agent management screen and reusable behaviour into its web package.   |
| `555ec3fe07` | Added production Eventing server adapters and runtime composition.               |
| `8e57032744` | Composed Enterprise managed-provider worker capability from explicit ports.      |
| `bcf05be631` | Added process-owned Node logging, tracing and shutdown primitives.               |
| `7cca0848fb` | Added internal Trace full-read and Topic-assignment ports without route cutover. |
| `0322204dea` | Added reusable path/header/latest REST version selection.                        |
| `faf6db77e1` | Exposed Secret through the four direct REST prefixes and retained main parity.   |
| `02457aaebd` | Moved Agent and Secret tRPC behaviour into package-owned app adapters.           |
| `39f1de6dff` | Routed Topic clustering through Eventing and composed a producer-safe worker.    |
| `0d877db1d7` | Drained Eventing and feature handles before worker infrastructure/observability. |
| `589a251194` | Hardened semantic OpenAPI comparison for path and reference edge cases.          |
| `eab4d6fd6e` | Moved chunk recovery out of `platform/app` into global UI behaviour.             |
| `f1baea7011` | Added the standalone API listener, request policy, config and graceful drain.    |
| `f9dbf94c8a` | Mounted package-owned Secret REST on all four bases in the API process.          |
| `cd28835a7b` | Moved Trace processing and Dataset auxiliary jobs into an Eventing installer.    |
| `1956fe0c06` | Enforced the global/private UI hierarchy and removed `apps/ui/src/app`.          |
| `1acf62c524` | Unified Eventing with the workspace SDK and added ordered telemetry flushers.    |
| `a33224992f` | Preserved worker drain ordering when Eventing readiness or transport boot fails. |
| `6071fe0fb8` | Added typed process-owned ClickHouse routing, connections and shutdown.          |
| `e1e7cefb6a` | Moved the strict browser-safe public config schema and codec into UI ownership.  |
| `f49f214927` | Injected Eventing runtime policy and made durable store selection fail closed.   |
| `13f6138060` | Moved logger environment compatibility into typed process configuration.         |
| `de540cf12e` | Enforced injected configuration across production reusable-package source.       |
| `25d7f809ed` | Added the injectable API process runtime and ordered shutdown boundary.          |
| `26d0711478` | Injected Gateway virtual-key cryptography through process composition.           |
| `ad1707fffc` | Composed canonical User avatar storage and removed the displaced User module.    |
| `02eae20840` | Added the injectable Worker process foundation with fail-safe startup cleanup.   |
| `67797154c1` | Fixed legacy App resource ownership and removed a process-scope self-wait.       |
| `2e43807329` | Corrected the Gateway virtual-key process projection boundary.                   |
| `2088ac9e67` | Parsed and injected the complete Group Queue process policy once.                |
| `12785bd78f` | Composed process-owned AWS transport policy and retired its duplicate app code.   |
| `e3d2551c6f` | Made Eventing process storage fail closed with explicit test/local factories.     |
| `6b9ca49158` | Added target-aware, lease-safe Dataset S3 client lifecycle ownership.             |

### Active, uncommitted slices

| Slice                          | Current fact                                                                                                                                                                                                                                                                                                                                                                                                                                 | Next gate                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API physical activation        | `apps/api` owns an injectable typed boot/process boundary, a real Node/Hono listener, request policy, graceful drain, Agent/Secret tRPC and all four Secret REST bases. It remains a library without a physical launcher or concrete production session/API-key adapters; the platform route graph remains live.                                                                                                                             | Compose the concrete auth/session/API-key/audit adapters and executable boot, then migrate the remaining REST/tRPC route graph by vertical before deleting compatibility routers.               |
| Worker physical activation     | `apps/worker` owns an injectable typed boot/process boundary, structural `ResourceScope` borrowing, signals and fail-safe startup cleanup. Topic commands and Trace/Dataset registrations are package-owned, but consumers are false-only because the shared queue still contains every other legacy pipeline. There is no fake executable or incomplete durable graph.                                                                      | Move the remaining registry groups and concrete PostgreSQL/Redis/ClickHouse/Group Queue dependencies, then enable the one complete shared-queue consumer and delete displaced registrations.    |
| UI physical activation         | Chunk recovery, runtime behaviour, shell sections, browser-safe public config and Agent browser transport now follow the enforced global/private hierarchy. `apps/ui/src/app`, `platform` and `testing` are invalid roots and contain no production files. The private source projection remains in `platform/app` as a compatibility boundary.                                                                                              | Move the actual browser entry, providers, source projection, router, overlays and route families out of `platform/app`, retaining the legacy shell adapter until URL/provider parity is proven. |
| Configuration ownership        | UI owns the strict public schema and inert base64url codec. Eventing, logger, Gateway virtual-key and all five Group Queue values are parsed at process composition and injected. Production reusable-package source has no executable ambient env read, and the architecture rule governs every `packages/**/src` production module. The combined boot schema, telemetry boot and private public-config source projection remain in `platform/app`. | Correct and commit the authoritative, idempotent telemetry projection, then separate API/worker executable install order and delete legacy config only after invalid/missing/role-specific boot parity. |
| OpenAPI ownership              | The comparator is hardened, but checked-in artefacts are stale and generation still imports the platform route graph. The generator currently fails before route composition because environment config is not initialised.                                                                                                                                                                                                                  | Move generator/serving ownership with the API route graph, initialise task config explicitly, regenerate, and explain every semantic difference from `main`.                                    |
| Process observability adoption | API and Worker own injectable typed logger/tracer boot and ordered telemetry flush. Legacy web scope ownership no longer self-waits. The live local-orchestrator instrumentation still parses metrics/profiling and tracing values from ambient configuration, and physical API/worker launchers remain absent.                                                                                                                              | Finish the typed telemetry boot projection while preserving disabled/no-key, metrics, profiling and drain-before-flush behaviour.                                                               |
| Persistence foundations        | Prisma owns explicit connection/readiness/migration/shutdown services, but 58 production platform files still mention the global `server/db` proxy. Eventing registration now rejects process managers without an explicitly injected ProcessStore; four live platform ProcessStore constructions and the full registry remain. ClickHouse package connections are process-owned, while the corrected live runtime cutover still awaits review. | Commit the ClickHouse runtime, then introduce process-owned Prisma and Redis compatibility seams before replacing the four live Eventing persistence graphs. Keep consumers disabled until the complete registry moves. |
| Infrastructure clients         | Shared AWS credential/proxy/handler policy and Dataset S3 client lifetime are process-owned. Dataset target changes retire clients only after active I/O releases, and app/task shutdown closes them. Direct legacy S3, Lambda and CloudWatch constructors remain explicit residuals.                                                                                                                                        | Move the remaining direct storage/migration and Lambda/CloudWatch construction behind named process adapters without mixing feature Stored Object ownership into this tranche.                  |
| Workspace reconciliation       | Reviewed API, Worker/Trace and UI hunks are committed. Unrelated Evaluation, Identity, generated-artefact, Secret, SDK, baseline and formatting changes still share the tree.                                                                                                                                                                                                                                                                | Attribute every later lockfile/baseline hunk to its owning slice, stage exact paths or hunks and leave unrelated work untouched.                                                                |

Only reviewed and committed deletions count as application-exit progress. The
active table names the remaining shared-tree batches and their next safe
deletion boundaries.

### Recorded follow-ups

These findings stay visible but do not block the active extraction batches. Pick
them up as dependency-closed work when their owning wave reaches the affected
surface. A failing check remains reported as failing even when its repair is
deferred.

| ID            | Finding and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Owning wave               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `F-API-01`    | The checked-in branch OpenAPI artefacts are stale. Against `main`, `openapidiff` reports 129 changed operations, 30 added and five removed. The public-doc and platform artefacts also differ from each other by 235 semantic operation changes. Both omit the deployed direct `/api/secret`, `/api/secrets` and `/api/v1/secrets` aliases even though runtime tests cover all four bases. Source/runtime parity is green; artefact parity is not.                                                                                                                                                                                                  | Wave 3 and Wave 9         |
| `F-API-03`    | The global authz declaration sweep currently stops before discovery on an undefined analytics `lwqlTimeWindowSchema`. Agent/Secret focused policy tests are green, but the global sweep has not proved the new package mounts.                                                                                                                                                                                                                                                                                                                                                                                                                      | Wave 2 and Wave 3         |
| `F-API-04`    | OpenAPI generation constructs `signInDomainRoutingPort` before the generation task initialises environment/configuration, so the task fails before Secret route composition. Fix this in the OpenAPI ownership move rather than coupling Secret back to app boot.                                                                                                                                                                                                                                                                                                                                                                                   | Wave 3 and Wave 9         |
| `F-API-06`    | `apps/api` now owns a callable listener and injected runtime bootstrap that parses typed config and logger/telemetry projections once, retains one scope, and drains listener → graph → telemetry. It deliberately has no `process.env` launcher/package start command: concrete session/project-key/PAT/admin authentication, API-key ceiling/mark-used, rate-limit and audit adapters remain outside the migrated graph, so a physical launcher would create an incomplete second API process. The existing split deployment vocabulary is `LANGWATCH_API_PORT`; `API_PORT` then `PORT` are deterministic future-bootstrap compatibility aliases. | Wave 1, Wave 2 and Wave 3 |
| `F-AUTHZ-01`  | The compatibility permission decision path does not always preserve the legacy `denialReason`; access remains denied, but specialised membership-disabled and lite-member errors can lose their exact client-visible cause. Characterise this before the universal root is retired.                                                                                                                                                                                                                                                                                                                                                                 | Wave 2 and Wave 3         |
| `F-AUTHZ-02`  | Two existing app AuthZ middleware tests import `BlankScopeIdError`, which is not exported by the AuthZ contract. This predates the Agent/Secret adapter commit and remains an exact known failing diagnostic.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Wave 2                    |
| `F-SECRET-01` | TypeScript Secret CLI commands do not forward the resolved project ID when building auth headers for the modern REST calls. Add multi-project/user-key header characterisation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Wave 3 clients            |
| `F-SECRET-02` | The standalone API proves all 20 CRUD operations across the four bases, but its `/api/secrets` alias uses the modern validated `projectId` and canonical error response. The live legacy route derives project from the credential and retains legacy payload/error/deprecation semantics; characterise and choose compatibility before retiring it.                                                                                                                                                                                                                                                                                                | Wave 3 compatibility      |
| `F-SECRET-03` | The standalone API listener proves the four bases, omitted/latest/header selection, conflicts and response headers. The still-live platform `createApiRouter` lacks an equivalent all-mount regression, so its mount/order protection remains a recorded compatibility test gap.                                                                                                                                                                                                                                                                                                                                                                    | Wave 3 compatibility      |
| `F-TRACE-01`  | The extracted full-read path trusts a stale storage-anchor hint, can return an empty span set, and does not yet preserve every legacy field/nullability case, including earliest start, topic IDs and reserved metrics. It has no production caller yet.                                                                                                                                                                                                                                                                                                                                                                                            | Trace vertical in Wave 6  |
| `F-EVENT-01`  | Eventing process registration now preflights an explicitly injected ProcessStore before mutating catalogues, definitions or pipelines (`e3d2551c6f`), and memory stores are available only through named test/local factories. The full suite still has four pre-existing `StateProjectionStore.load`/`tryLoad` failures, one memory-store expectation that omits the returned `idempotencyKey`, and the corresponding existing test type errors. | Wave 1 Eventing cleanup   |
| `F-EVENT-02`  | Physical Eventing persistence cutover still has four live platform `ProcessStore` constructions plus platform-only Prisma/ClickHouse integration harnesses. Package server adapters are injectable; worker consumers remain disabled until this persistence graph and the complete registry move together.                                                                                                                                                                                                                                                                                                                                          | Wave 1 and Wave 4         |
| `F-CONFIG-01` | The current non-test source sweep finds 64 production files importing `env.mjs` and 93 production files mentioning `process.env`, with overlap. Import-time telemetry, scenario-child and evaluation-concurrency reads move first; SSO is Wave 2. Preserve database empty fallback, credential/auth-secret chains, privileged internal-route secrets, mail unsubscribe differences and storage unsafe/test gates before deleting the compatibility proxy. | Wave 1                    |
| `F-PRISMA-01` | `@langwatch/prisma-client` has explicit connection/readiness/shutdown services, but `server/db.ts` still owns an env-derived `globalThis` proxy mentioned by 58 production files. The legacy scope deadlock is fixed; process-owned adoption must inject one connection, remove App-level Prisma shutdown and retain only a construction-free compatibility binding until callers move. | Wave 1                    |
| `F-OBS-02`    | Preserve legacy instrumentation, disabled/no-key behaviour, metrics/profiling and drain-before-flush ordering when API and worker adopt process observability. Add process-level boot/shutdown proof.                                                                                                                                                                                                                                                                                                                                                                                                                                               | Wave 1                    |
| `F-WORKER-01` | The shared `event-sourcing/jobs` queue contains every pipeline. Trace `assignTopic`, deferred origin, Dataset normalize and Topic are now package-owned, but a partial worker would still reject/redeliver every other legacy job. The worker now has an injectable typed boot/process boundary and borrowed `ResourceScope` semantics, but no physical executable or concrete PostgreSQL/Redis/ClickHouse/Group Queue composition. Keep consumers disabled and the default launcher deferred until the complete registry and durable graph are mounted.                                                                                            | Wave 1 and Wave 4         |
| `F-UI-01`     | `apps/ui` hierarchy and primitives are ready, but `LegacyUiShellAdapter`, `_app.tsx`, `routes.tsx`, `AppProviders` and the provider/overlay/page closure remain live in `platform/app`. Preserve the adapter until boot, provider order, URL and overlay parity are proven.                                                                                                                                                                                                                                                                                                                                                                         | Wave 5 and Wave 7         |
| `F-UI-02`     | The public-config move preserves existing validation, but projection coverage does not yet assert every PostHog, NLP, Langevals, licence, sample-ratio and email-provider mapping, and URL fields remain intentionally permissive strings. Keep the private source projection until its physical-app move adds full mapping and invalid-codec coverage.                                                                                                                                                                                                                                                                                             | Wave 1 and Wave 5         |
| `F-USER-01`   | The committed User package still has strict-layout/ADR residuals: generated Prisma is imported outside a private Prisma repository adapter, the avatar codec sits outside layout v0, `getLastHomePath` returns absence without a `try*` name, and legacy `credential-user` behaviour remains in the app. The avatar/Stored Object slice must not worsen these, but their owning User migration must clear them before the feature is called complete.                                                                                                                                                                                               | Wave 2 and Wave 6         |
| `F-STORED-01` | The Stored Object server root currently exports private store/port implementation surfaces used by app composition. Keep this visible as a package-surface residual; do not reintroduce request-time construction while its later strict-layout cleanup provides an honest composition boundary.                                                                                                                                                                                                                                                                                                                                                    | Wave 1 and Wave 6         |
| `F-STORED-02` | `@langwatch/stored-object-server` tests pass, but its package typecheck is red because `ClickHouseImportStoredObjectMigration` lacks the now-required `SystemMigration.enrolledAutomatically`. This predates the avatar composition and remains an explicit package diagnostic rather than being mixed into that commit.                                                                                                                                                                                                                                                                                                                            | Wave 1 and Wave 6         |
| `F-DATASET-01` | Dataset S3 operation/stream leases and target reassignment are covered and committed in `6b9ca49158`. The standalone backfill task still has a pre-existing generated-Prisma to `DatasetMigrationDatabasePort` aggregate promise mismatch in the broad platform typecheck; this was not caused by the client-lifecycle cut. | Wave 1 and Wave 6         |
| `F-AWS-01`    | `@langwatch/aws-client` owns shared credential/proxy/handler policy, but non-Dataset `createS3Client` callers, `s3-driver.ts`, `s3/stagePayload.ts` and remaining Lambda/CloudWatch constructors still create direct clients. Preserve storage unsafe/test gates and task-local closure while moving them behind named process adapters. | Wave 1                    |
| `F-AGENT-01`  | `specs/agents/AUDIT_MANIFEST.md` still points at deleted management UI paths and does not bind the moved scenario tests. Refresh it when the next Agent vertical updates feature documentation.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Wave 6 and Wave 7         |
| `F-AGENT-02`  | Agent management replacement coverage does not directly assert every former dialog success/close/toast/invalidation and error outcome. The legacy host remains a named temporary app adapter until UI owns those platform ports.                                                                                                                                                                                                                                                                                                                                                                                                                    | Wave 6 and Wave 7         |

Resolved during the Secret REST batch: aliases now have unique operation IDs,
the documented alias set is fixed to the four prefixes above and generator
prune coverage recognises all four. Whole-document operation-ID uniqueness
remains a general generation gate in Wave 9.

Resolved during process activation: `F-API-05` is superseded by the real
listener and bounded HTTP drain in `f1baea7011`. The worker drain ordering and
first-error retention proof is covered by `0d877db1d7`; remaining executable
composition work is represented by `F-API-06`, `F-WORKER-01` and the active
process rows rather than keeping obsolete findings open.

Resolved during Wave 1 configuration: `F-OBS-01` is closed by `13f6138060`.
The Observability package no longer reads environment values; legacy names are
parsed by process composition before graph imports. Remaining physical
API/worker adoption stays under `F-OBS-02`.

Resolved during Wave 1 queue composition: `F-QUEUE-01` is closed by
`2088ac9e67`. All five queue policy values are parsed once and injected into
the sole live platform Group Queue factory. This does not enable the partial
Worker consumer; that gate remains under `F-WORKER-01`.

## Measured exit inventory

At the working checkpoint, `platform/app` contains 6,323 tracked files,
including 5,966 under `src`. Counts include tests unless identified as
production-only and will be refreshed after each committed wave. The temporary
increase reflects explicit compatibility composition and coverage added before
safe deletion; only reviewed production deletion counts as exit progress.

### Source cohorts

| Path cohort               |                                Files | Exit owner                                                                  |
| ------------------------- | -----------------------------------: | --------------------------------------------------------------------------- |
| `src/server`              |    1,925 total; about 927 production | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages |
| `src/server/app-layer`    |      380 total; about 191 production | Deleted through explicit API/worker composition; never copied               |
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
7. **Secret REST:** accept singular and plural resources with and without the
   explicit version prefix: `/api/v1/secret`, `/api/v1/secrets`, `/api/secret`
   and `/api/secrets`, plus their item paths. Unversioned paths select the latest
   version; `X-API-Version` may select `v1`, and path/header disagreement is
   rejected. `main` OpenAPI proves deployed compatibility is five REST
   operations on `/api/secrets` and `/api/secrets/{id}`. There is no deployed
   public Secret RPC; remove the branch-invented
   `/api/secrets/{version}/secrets.*` family. Internal app tRPC is separate.
8. **Trace full-read:** keep canonical full-read internal and all-visible.
   Public actor/viewer protection is a separate service/trust boundary that
   composes canonical read, protection and edit overlays later.
9. **Worker activation:** keep the new worker producer-only while the legacy
   registry remains the sole consumer of the shared Eventing queue. Mount the
   complete package-composed registry, including Trace `assignTopic`, then make
   one tested consumer switch; never run a Topic-only consumer on that queue.

## Decisions approaching

These decisions are not blockers for the active migration lanes, but their
answers will be needed before the named later boundary can close:

1. **Secret compatibility retirement:** whether legacy project-key write actor
   handling and duplicate-error text must remain byte-for-byte compatible, or
   may converge on the canonical Secret service when `/api/secrets` is retired.
2. **Observability SDK ownership:** which single LangWatch SDK/OTel entry owns
   API, worker and Eventing instrumentation before process activation.
3. **Auth package owner:** whether the absent catalogue `auth` package owns the
   Better Auth/session cohort or whether the catalogue entry needs an explicit
   correction before Wave 2.
4. **UI platform ports:** the stable small ports for routing, overlays, session,
   notifications and transport hooks that let `apps/ui` delete temporary
   feature host adapters without creating another global context bag.

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

Items in the current wave may run concurrently when their path ownership is
independent. Do not start a later wave until the current wave gate is complete.

### Wave 0: reconcile and commit current work

| ID     | Work                                                                                     | Exit gate                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C-01` | Reconcile workspace links and `pnpm-lock.yaml` after all active manifest writers finish. | **Committed for API and Worker/Topic.** Continue exact-hunk attribution for later shared-tree slices.                                                                                                       |
| `C-02` | Review and commit Agent UI.                                                              | **Committed `2d5066fcd7`.** Retained drawers and coverage/documentation follow-ups are recorded above.                                                                                                      |
| `C-03` | Review and commit Trace full-read.                                                       | **Committed `7cca0848fb` as preparation, not cutover.** The internal/all-visible boundary has no production caller; `F-TRACE-01` remains.                                                                   |
| `C-04` | Review and commit process observability.                                                 | **Committed `bcf05be631`.** Process adoption and the two observability follow-ups remain in Wave 1 and the active API/worker slices.                                                                        |
| `C-05` | Finish Secret REST correction.                                                           | **Committed `faf6db77e1`.** All four direct prefixes are present; deferred generated-artefact, client and compatibility findings are recorded above.                                                        |
| `C-06` | Finish tRPC/AuthZ/API Secret+Agent direct cutover.                                       | **Wave 0 complete.** Package adapters are committed in `02457aaebd`; listener/policy foundations are committed in `f1baea7011`. Physical API activation and compatibility-router deletion remain in Wave 3. |
| `C-07` | Finish Eventing server and Enterprise worker composition.                                | **Committed `555ec3fe07` and `8e57032744`.** Production factories are ready for the active Worker Topic composition batch.                                                                                  |
| `C-08` | Finish Worker Topic cutover.                                                             | **Wave 0 complete.** Eventing-only Topic dispatch is committed in `39f1de6dff`; Trace registration follows in `cd28835a7b`. Full shared-registry activation remains in Wave 4.                              |

### Wave 1: process foundations

Current Wave 1 progress at `6b9ca49158`:

- [x] Enforce injected configuration in reusable production packages.
- [x] Add injectable API and Worker process/lifecycle foundations.
- [x] Parse and inject Eventing, logging, Gateway cryptography and Group Queue
      policy.
- [x] Compose shared AWS transport policy and lease-safe Dataset S3 clients.
- [x] Make Eventing ProcessStore selection fail closed without activating the
      partial Worker consumer.
- [ ] Commit the corrected ClickHouse live-runtime/migration/Ops EXPLAIN cut.
- [ ] Commit an authoritative, process-idempotent telemetry boot projection.
- [ ] Compose process-owned Prisma and Redis compatibility seams, then replace
      the four live platform Eventing persistence graphs.
- [ ] Move the complete shared Eventing registry and concrete intent ports
      before enabling the new Worker consumer.

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
- [ ] Keep the direct platform S3 storage/migration and Lambda/CloudWatch clients
      as explicit residuals. `@langwatch/aws-client` currently owns only shared
      SES/SQS transport policy; Enterprise STS/S3 remains at its feature boundary.

Measured Wave 1 persistence baseline on 2026-08-28:

| Residual surface                                  |                                                                                Measured burden | Required owner/deletion gate                                                                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform Prisma                                   | 686 direct model/raw/transaction operations in 150 files, approximately 670 in production code | Move each operation behind its singular feature's private repository. Delete the old repository or handler query only after every production caller and equivalent behavioural test use the canonical service.    |
| Platform ClickHouse                               |                                          92 direct query/insert/command operations in 26 files | Move Trace, Analytics, Stored Object, Log, Metric, Eventing and Ops queries into their existing feature or infrastructure adapters without changing query fields, nullability, windows, ordering or retry policy. |
| Package Prisma outside canonical repositories     |                                                                       62 operations in 9 files | Finish Eventing infrastructure persistence, then remove AuthZ, Share, Prompt, Gateway, Dataset and Enterprise composition-level database access through their owning services/repositories.                       |
| Package ClickHouse outside canonical repositories |                                                                      32 operations in 13 files | Retain only explicit Eventing/process infrastructure adapters; move feature and Enterprise composition queries into private server repositories.                                                                  |

Run the persistence work in dependency order:

1. finish Prisma/ClickHouse process lifecycle and physical composition;
2. finish Eventing ProcessStore, EventStore, retention, replay and outbox
   persistence;
3. consolidate Project, Organization, User, Role, AuthZ and API-key repository
   ownership without starting their Wave 2 transport/identity cutover;
4. move the remaining product Prisma batches by singular feature;
5. move Trace, Analytics, Stored Object, Log and Metric ClickHouse batches;
6. move Auth and Enterprise persistence residuals; and
7. run a final direct-query sweep, allowing only strict private repositories,
   Eventing infrastructure repositories and named process infrastructure
   adapters.

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
