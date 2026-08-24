# Core application feature extraction plan

**Date:** 2026-08-24

**Scope:** the non-Enterprise product implementation still under
`platform/app`. Enterprise feature extraction is explicitly out of scope for
this plan.

**Decisions:**
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-102](../adr/102-runtime-composition-roots.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md).

## Outcome

Reusable product behaviour moves out of `platform/app` into singular feature
packages before the physical `apps/ui`, `apps/api`, and `apps/worker` move.
The application remains the process composition and compatibility-transport
host while the migration is in progress.

This is the canonical migration map. A source move must point to a row in this
map. We do not choose the next package from whichever legacy file happens to be
open.

The inventory at the start of this plan contains approximately:

- 1,579 production TypeScript modules below `platform/app/src/server`;
- 128 production modules below `platform/app/src/app/api`; and
- 1,205 production modules below `pages`, `components`, and `hooks`.

The large count is why the split is organised as vertical features rather than
as a directory rename.

## Boundary rules used by the map

1. A feature owns a product lifecycle, not a URL, table, component, or provider.
2. Subordinate concepts stay with their owner: avatar with User, teams and
   invites with Organization, prompt versions and tags with Prompt, dataset
   records with Dataset, and spans and shares with Trace.
3. A service receives its own private repositories and other feature services.
   It never receives another feature's repository.
4. Another feature consumes only the canonical abstract service and portable
   Zod 4 values from the owning contract package.
5. Ordinary service and repository methods return a value or throw. A nullable
   lookup is named `try...`, and exists only when a caller genuinely needs to
   branch on absence. Repositories do not use a weaker convention than
   services.
6. Hono, tRPC, workers, and scripts receive the one process-owned App graph.
   They do not construct a service per request or recover dependencies from a
   global Prisma client.
7. Existing tRPC names and REST paths remain compatibility transports. Moving a
   feature does not rename an endpoint.
8. Contracts, services, repositories, API adapters, projections, subscribers,
   processes, tests, web UI, and runtime wiring move together when they belong
   to the same feature slice.

## Canonical core feature map

### Identity and tenancy

| Feature | Owns | Current API surfaces | Principal legacy implementation | State |
| --- | --- | --- | --- | --- |
| `auth` | login, authentication providers, browser and CLI sessions, password and session lifecycle | `/api/auth/*`, `/api/auth/cli/*`, auth pages; authentication portions of `user` tRPC | `server/auth*`, `server/better-auth`, `server/auth0`, `server/routes/auth*.ts`, `pages/auth`, `pages/cli` | not extracted |
| `authz` | permission decisions, grants and bindings | `authz` and `roleBinding` tRPC; `/api/role-bindings` | AuthZ feature packages plus remaining app permission middleware and compatibility services | package landed; app adapters remain |
| `role` | custom-role definitions and assignment policy | `role` tRPC; `/api/roles` | Role feature package plus legacy characterization tests | canonical contract/server and process composition landed; rebase the remaining legacy tests, then remove the old service and repository |
| `user` | user profile, preferences, deactivation, password-facing profile operations and avatar | `user` tRPC, `/api/me`, `/api/user-avatar`, pages and components below `me` | User feature packages plus compatibility portions of `server/api/routers/user.ts` | contract/server landed; profile, activation, preferences and avatar use one User service; Auth and cross-feature procedures remain in the app router |
| `organization` | organization, team, group, membership, invite and personal-workspace lifecycle | `organization`, `team`, `group`, and `personalWorkspaceFeatures` tRPC; `/api/organization`, `/api/organizations`, `/api/teams`, `/api/groups` | Organization feature package plus remaining `app-layer/{organizations,role-bindings}` and `server/invites` compatibility code | Team REST/tRPC and both Group transports use the process-owned service; Team membership reads and writes are AuthZ-backed with privacy, last-admin, additive-grant and concurrency invariants; invite and remaining organization membership compatibility behaviour remains |
| `project` | project identity, lifecycle and settings | `project` tRPC and `/api/projects` | Project feature package plus compatibility transports | canonical contract/server, tRPC and REST transports, runtime composition, project/team invariants, and compatibility callers migrated; API-key collaboration remains |
| `api-key` | API credential issuance, rotation, restrictions and revocation | `apiKey` tRPC and `/api/api-keys` | `server/api-key`, Hono API-key middleware and settings UI | canonical contract/server landed and the duplicate lifecycle repository/service is deleted; extraction remains incomplete while legacy-grant minting holds domain logic and token resolution reads Project persistence outside the Project service |

### AI assets and execution

| Feature | Owns | Current API surfaces | Principal legacy implementation | State |
| --- | --- | --- | --- | --- |
| `model-provider` | provider credentials, provider instances, models, default-model policy, model metadata, model costs and Codex-account provider credentials | `modelProvider`, `llmModelCost`, `translate`; `/api/model-providers`, `/api/model-defaults` | `server/modelProviders`, model-provider settings/components and model configuration hooks | strict contract/server and process-owned route integration landed with scope authorization and default/cost parity; remaining execution-internal resolvers migrate with their owning features |
| `prompt` | prompt definitions, versions, tags and prompt configuration | `prompts`, `promptTags`; `/api/prompts` | `server/prompt-config`, `src/prompts`, prompt components/hooks | contract/server/web packages landed; page composition, client query adapters and cross-feature Trace/Evaluation bridges remain in the application |
| `dataset` | datasets, records, imports and dataset file handling | `dataset`, `datasetRecord`; `/api/dataset`, `/api/dataset/generate` | `server/datasets`, dataset components | contract/server/web packages landed; remaining application files are transport, page composition and cross-feature execution seams |
| `agent` | agent definitions and agent-specific HTTP node configuration | `agents`, `/api/agents`; agent portions of `httpProxy` and `setupSkills` | Agent feature package plus remaining `server/agents` and agent UI | package partial |
| `workflow` | workflow definitions, versions, graph nodes and workflow execution-facing behaviour | `workflow`; `/api/workflows`, legacy workflow routes | `server/workflows`, `optimization_studio` workflow domain and workflow UI | contract/server and process App service landed; ordinary CRUD transports delegate to it, while version/copy propagation and execution composition still contain legacy persistence |
| `evaluator` | evaluator definitions, evaluator providers and evaluator configuration | `evaluators`, evaluator portion of `optimization`; `/api/evaluators` | `server/evaluators`, evaluator components | contract/server/web packages landed and the duplicate app service is deleted; copy/cascade transport orchestration remains |
| `evaluation` | evaluation definitions, execution, runs, results and DSPy evaluation steps | `evaluations`, `batchRecord`; legacy evaluation REST | `server/evaluations`, `app-layer/evaluations`, `app-layer/dspy-steps`, evaluation UI | contract/server scaffold landed but is not integrated: its ClickHouse repository must first absorb the hardened production retention, deduplication, projection-id and write-cap behavior, then execution/Eventing/UI residue must move |
| `monitor` | online monitor definition and lifecycle | `monitors`; `/api/monitors` | `app-layer/monitors`, monitor router and online-evaluation UI | contract/server packages and process App service landed; remaining dataset-provider and UI seams still need draining |
| `experiment` | experiment definition and run history | `experiments`; `/api/experiments`, experiment-v3 REST | `server/experiments*`, experiment event pipeline and UI | definition contract/server and App transport migration landed; ClickHouse run history is the active package drain |
| `scenario` | scenario definition, events and cancellation | `scenarios`; `/api/scenarios`, `/api/scenario-events`, scenario generation route | `server/scenarios`, scenario components/hooks | contract/server and request-App CRUD/runner/worker integration landed; cancellation, failure handling and browser coordination remain explicit execution seams |
| `simulation` | simulation execution, batches and simulation-run results | simulation procedures currently nested below `scenarios`; `/api/simulation-runs` | `app-layer/simulations`, simulation event pipeline and UI | Zod 4 read contract/server landed; ClickHouse adapter and request-App integration are active, while Eventing execution remains separate |
| `suite` | suite definition, run plan and suite-run history | `suites`; `/api/suites` | `server/suites`, `app-layer/suites`, suite event pipeline and UI | definition contract/server and request-App CRUD integration landed; run orchestration and archived-name resolution are the active drain |

### Observability, analysis and collaboration

| Feature | Owns | Current API surfaces | Principal legacy implementation | State |
| --- | --- | --- | --- | --- |
| `telemetry` | standards-compliant OTLP ingestion, collector intake and telemetry normalization | `/api/otel/v1/{traces,logs,metrics}`, collector, RUM and ingestion aliases | `server/otel`, `server/tracer/collector`, telemetry routes and trace-processing ingress | must preserve OTLP paths and wire standards |
| `trace` | traces, spans, logs attached to traces, querying, edit overlays, shares, pinned trace presentation and saved trace views | `traces`, `tracesV2`, `spans`, `traceEditOverlay`, `share`, `sharedTrace`, `savedViews`; `/api/traces`, legacy trace routes and trace export | `app-layer/traces`, `server/traces`, trace-processing projections, trace UI | largest read/write feature; split after Telemetry contract |
| `annotation` | annotation queues, annotations and scores | `annotation`, `annotationScore`; annotation REST | `server/annotations`, annotation components | consumes Trace service |
| `analytics` | analytics query execution, LWQL, timeseries and reusable analytical reads | `analytics`, `costs`; `/api/analytics`, `/api/analytics-sql` | `server/analytics`, `app-layer/analytics`, analytics-query UI | Dashboard and Topic are consumers, not sub-implementations |
| `dashboard` | dashboards, graphs, saved workbench charts and chart ordering | `dashboards`, `graphs`; `/api/dashboards`, `/api/graphs` and saved-chart analytics API | `server/dashboards`, `analytics/saved-workbench-charts`, graph UI | add to catalogue; independent durable lifecycle |
| `topic` | topic model, topic-clustering runs and topic status | `topics` | `app-layer/topic-clustering` and its Eventing pipeline | add to catalogue; independent process lifecycle |
| `data-retention` | retention policy, pinning, metering and retroactive retention work | `dataRetention`, `pinnedTrace` | `server/data-retention` and data-retention UI | already a distinct catalogue owner |
| `data-privacy` | capture/redaction policy and scoped privacy configuration | `dataPrivacy` | `server/data-privacy` and privacy settings UI | add to catalogue; policy is used beyond Trace reads |
| `automation` | automation and trigger definitions, trigger-fire history, report schedules, actions, deliveries and email suppression | `automation`, `trigger`, `trigger-fire-history`, `report-schedule`, `email-suppression`; `/api/triggers`, unsubscribe routes | Automation feature packages plus thin compatibility transports and app-only provider adapters | strict contract/server/web package, process App.automation composition, and legacy caller migration complete |
| `notification` | user-visible notifications and preferences | notification reads/writes embedded in application flows | `server/notifications`, notification UI and mail delivery collaboration | mail transport stays infrastructure |
| `presence` | collaborative presence and cursor lifecycle | `presence`, SSE presence events | Presence feature packages plus `features/presence` browser compatibility UI | contract/server landed; the process owns one service and tRPC receives it through `ctx.app` |

### Platform products and operations

| Feature | Owns | Current API surfaces | Principal legacy implementation | State |
| --- | --- | --- | --- | --- |
| `gateway` | virtual keys, routing policy, budgets, cache rules, guardrails and gateway usage | `virtualKeys`, `personalVirtualKeys`, `routingPolicy`, `gatewayBudgets`, `gatewayCacheRules`, `gatewayGuardrails`, `gatewayUsage`, `gatewaySpendEvents`; `/api/gateway-*` | `server/gateway`, gateway pages/components | consumes Model Provider, Organization, Project and AuthZ services |
| `coding-agent` | coding-agent sessions, conversations, transcript and pull-request usage | `codingAgents`; `/api/coding-agent` | `app-layer/coding-agent`, coding-agent UI | consumes GitHub and Trace services |
| `github` | GitHub installation, webhook, repository and pull-request linkage lifecycle | `github`; GitHub setup/install/webhook routes | `app-layer/github`, GitHub routes and UI | add to catalogue; shared by Coding Agent and Langy |
| `langy` | Langy conversations, turns, messages, credentials and relay | `langy`, `langyEgress`; Langy public/internal/relay routes | Langy feature packages plus application auth/key, turn, worker, relay and browser adapters | contract/server/web and durable eventing moved; the process owns one LangyService, but remaining app turn/relay code still imports server internals and must move behind that service before the feature is complete |
| `secret` | project-secret lifecycle and reserved-name policy | `secrets`; `/api/secrets` | secret API implementation and secret UI | small but independent security lifecycle |
| `entitlement` | provider-neutral plan and capability decisions | `plan`, `limits` compatibility reads | Entitlement feature package plus legacy plan/usage enforcement composition | package landed; remove direct Enterprise types from core service contracts |
| `stored-object` | durable object metadata, upload, delivery and migration | `storedObjects`; `/api/files`, `/api/stored-objects` | Stored Object packages plus app storage adapters | package partial |
| `ops` | backoffice administration, bug-report review, queues, scheduler, replay, migrations and event/process inspection | `ops`, `bugReports`; `/api/ops`, `/api/bug-reports`, admin/ops pages | Ops feature package plus `app-layer/ops`, `server/ops`, worker/queue tooling | package partial |

## Application-owned seams that do not become product features

These modules remain in the application until the physical app split. Their
job is to compose feature services or operate the process; moving them into a
catch-all feature would recreate `platform/app` under `packages/features`.

| Seam | Why it remains application-owned | Target |
| --- | --- | --- |
| tRPC root and compatibility routers | assemble independently owned feature API adapters under the existing procedure names | `apps/api` |
| Hono root, middleware, OpenAPI discovery and error mapping | HTTP process and transport policy | `apps/api` |
| `home` recent-items aggregation | joins Audit Log activity to Prompt, Workflow, Dataset, Monitor and Annotation presentation | UI/API composition until a durable Home lifecycle exists |
| onboarding router and checks | orchestrates Organization, Project, Model Provider, Prompt, Dataset, Workflow, Monitor and Simulation services | `apps/api` plus `apps/ui`; no repository-owning Onboarding service |
| `/api/auth/cli` route | one compatibility transport spanning Auth, Organization, Project, API Key, Gateway and optional Enterprise capabilities | `apps/api`; domain behaviour moves behind each service |
| public HTML configuration bootstrap, viewer-capability query, API discovery, health, cron and static handlers | boot/configuration/process concerns; the initial HTML carries only schema-validated, allow-listed semantic browser configuration, never the raw environment; identity-dependent capabilities remain a separate query | `apps/api` or `apps/worker` |
| feature-flag bootstrap and runtime selection | runtime configuration; Ops owns only the management surface | app runtime composition |
| broadcast/SSE, mail, Redis, ClickHouse, Prisma, queues and object storage clients | reusable technical infrastructure, not product ownership | infrastructure packages and runtime composition |
| generic export transport | route/progress transport only; Scenario, Simulation and Trace own their export behaviour | `apps/api` |
| cross-feature navigation, command bar and page shells | compose feature-web screens | `apps/ui` |

## Catalogue corrections revealed by the inventory

The application contains five core lifecycles that satisfy ADR-112's feature
test but are not registered independently yet:

- `dashboard` owns Dashboard, CustomGraph and SavedWorkbenchChart lifecycle;
- `data-privacy` owns scoped capture and redaction policy;
- `github` owns installation and pull-request linkage shared by Coding Agent
  and Langy;
- `presence` owns the Redis-backed collaborative presence lifecycle; and
- `topic` owns the durable topic-clustering process and projected topic model.

These additions must update the catalogue, ADR-112's table, and the singular
ownership specification together before their packages are created. They are
not local `feature.json` expansions.

## Wave 1 and Wave 2 router ownership inventory

This inventory was taken from the TypeScript declaration outline rather than
from router filenames alone. A compatibility router may contain procedures
owned by several features; extraction moves each procedure behind its owner
without changing the public tRPC name.

| Compatibility router | Procedures reviewed | Direct Prisma call sites at inventory | Ownership result |
| --- | ---: | ---: | --- |
| `user` | 20 | 16 | User owns tour, last-login, account profile, activation, home-path preference and avatar. Auth owns registration, linked accounts and password changes. Admin/Ops owns the admin flag. Personal context, usage, budgets, CLI bootstrap and budget-increase are application compositions over Organization, Project, Governance and Gateway services. |
| `organization` | 14 | 16 | Organization owns organization, membership, team, group and invite lifecycle. Audit-log reads call Audit Log service; plan enforcement calls Entitlement; no Enterprise repository belongs in Organization. |
| `team` | 8 | 11 | Team remains a subordinate Organization concept, so these procedures join the Organization service rather than creating a Team package. |
| `group` | 10 | 28 | Group and its member/binding edits remain subordinate Organization behaviour. AuthZ grant mutation is consumed as a service. |
| `personalWorkspaceFeatures` | 3 | 0 | Already delegates to Organization through `ctx.app`; it remains a compatibility router only. |
| `project` | 8 | 15 | Project owns create/update/archive and settings. Project-key operations collaborate with API Key; captured-data status calls Data Privacy; topic clustering calls Topic. |
| `apiKey` | 9 | 9 | API Key owns credential lifecycle and binding presentation. Organization, Project and AuthZ supply scope/membership services. |
| `modelProviders` | 17 | 20 | Model Provider owns credentials, provider instances, validation, model metadata and default-model policy. Managed Provider is an optional service collaborator, not a repository branch. |
| `promptTags` | 4 | 9 | Prompt Tag is subordinate to Prompt. Project-to-organization resolution must come from Project service rather than a router query. |
| `dataset` | 8 | 11 | Dataset owns dataset lifecycle, copy and mappings. Experiment is a service collaborator. |
| `datasetRecord` | 7 | 16 | Dataset Record and its S3/inline representations are one Dataset implementation detail, not a separate package. |
| `secrets` | 4 | 7 | Secret is a small independent security lifecycle; encryption is injected infrastructure and Project supplies tenancy. |

The first implementation pass removed the legacy User and Presence service
directories. Remaining direct Prisma calls in their compatibility routers are
either explicitly assigned above or are the next service methods to extract;
they are not a reason to introduce transport-owned repositories.

## Prepared Workflow boundary

The Workflow inventory is deliberately narrower than the current
`server/workflows` directory:

- Workflow owns definitions, versions, published-version selection, DSL
  validation, archive state and workflow execution dispatch.
- Model materialisation asks the Model Provider service. It does not receive a
  model-provider repository or Prisma client.
- Dataset-backed execution asks the Dataset service. Loading an evaluation run
  is not reimplemented inside Workflow.
- `/api/workflows/:id/evaluate` remains an API composition over Workflow and
  Evaluation while the compatibility URL is preserved. The current
  `WorkflowEvaluationService` is not moved wholesale into Workflow merely
  because the route begins with `/workflows`.
- Updating Agent mappings after a Workflow change calls the Agent service or a
  durable subscriber command. Workflow does not write Agent rows directly.
- The SSE execution transport and NLP process client are infrastructure ports
  injected once at process boot, not services or clients constructed by a
  request handler.

This boundary is the implementation handoff after Prompt and Dataset are
complete. It prevents the Workflow package from swallowing Evaluation, Agent,
Model Provider and Dataset behaviour while still giving every existing
workflow transport one canonical service.

## Dependency direction

The initial dependency spine is:

```text
Auth
  -> User
  -> Organization -> Project -> API Key
       |               |
       v               v
     AuthZ         Model Provider
                       |
          +------------+------------+
          v            v            v
        Prompt       Evaluator     Gateway
          |            |            |
          +-------> Workflow <-------+
                       |
             Evaluation / Monitor
                       |
          Experiment / Suite / Simulation

Telemetry -> Trace -> Annotation
               |  -> Data Retention
               |  -> Data Privacy
               +----> Analytics -> Dashboard
                                  -> Topic

GitHub -> Coding Agent
       -> Langy
```

This is a package dependency direction, not a call sequence. Cross-feature
workflows may orchestrate several services in an API or worker composition
root without creating a new shared repository layer.

## Extraction waves

### Wave 0: enforce and finish the composition foundation

- Keep the fast structural gate green for every newly moved file: singular
  ownership, canonical layout, service/repository dependency direction,
  persistence containment, explicit exports, and safe runtime composition.
- Keep formatting, routine dependency upgrades, and subjective expression
  style out of architecture lint. Explicitly retired runtimes and old package
  entry points remain structural safety failures.
- Finish one App graph shape shared by Hono, tRPC and workers.
- Keep repositories private and inject cross-feature services.
- Replace import-time environment validation at executable entrypoints with the
  explicit config and boot lifecycle; feature configuration remains injected.
  Inject schema-validated public browser configuration into the initial HTML
  as inert data rather than exposing an environment endpoint.
- Enforce the same fallible-result convention at service and repository
  boundaries while each feature moves. Do not preserve nullable ordinary
  methods as compatibility debt inside a new strict package.

### Wave 1: complete the identity spine

1. User, with avatar folded into the canonical service.
2. Organization's remaining team/group/invite/membership behaviour.
3. Project's remaining compatibility routes and settings behaviour.
4. API Key.

These moves establish the services almost every later feature consumes. AuthZ
already has strict packages; Auth remains after User because its provider and
session surfaces are tightly coupled to application boot.

### Wave 2: independent product resources

1. Model Provider.
2. Prompt.
3. Dataset.
4. Secret.

These are durable CRUD-heavy boundaries with existing REST/tRPC coverage and
limited worker ownership. They give Workflow, Evaluation and Gateway stable
dependencies.

### Wave 3: execution features

1. Evaluator and Evaluation.
2. Monitor.
3. Scenario and Simulation.
4. Suite and Experiment.
5. Workflow, then remaining Agent behaviour.

The related features remain separate packages; their runtime graph composes
them.

### Wave 4: observability and analysis

1. Telemetry ingestion.
2. Trace.
3. Annotation, Data Retention and Data Privacy.
4. Analytics.
5. Dashboard and Topic.

This order prevents analytics and UI packages from reaching back into raw
trace persistence.

### Wave 5: platform products

1. Gateway.
2. GitHub, Coding Agent and Langy.
3. Automation, Notification and Presence.
4. remaining Ops and Stored Object application adapters.

### Wave 6: physical applications

Once reusable behaviour belongs to feature packages:

1. move browser composition and pages to `apps/ui`;
2. move Hono/tRPC/boot composition to `apps/api`;
3. move consumers, schedulers and task registration to `apps/worker`; and
4. move the publishable self-host CLI to `apps/server` while preserving all
   existing images, commands and deployment topology.

## Per-feature completion definition

A feature is not counted as extracted until all applicable items are true:

- singular catalogue entry, boundary ADR and Gherkin spec exist;
- feature-specific ADRs, specs and developer documentation have moved to the
  feature root, been corrected for the final boundary, and been compressed to
  current facts, durable decisions and useful journey context;
- contract package exposes portable Zod 4 values and the canonical service;
- server package owns its service, private repositories, adapters and durable
  eventing behaviour;
- web package owns reusable feature UI;
- the feature inventory has been drained across every legacy application root,
  including `src/runtime`, `src/features`, `src/server`,
  `src/server/app-layer`, `src/server/event-sourcing`, `src/components`, hooks,
  jobs and route-local helpers; a new package beside an old implementation is
  an incomplete extraction, not a compatibility layer;
- tRPC and REST compatibility transports delegate to the App service graph;
- API and worker runtime roots construct one implementation and close its
  resources;
- legacy business implementation is deleted rather than forwarded forever;
- package tests and affected compatibility tests pass; and
- architecture lint, Oxlint and declaration-boundary checks pass for the moved
  slice.

Before a slice starts, its inventory records every production module and every
ADR, spec or developer document that owns the subject or imports its old
implementation. On completion, any remaining application file must be named
explicitly as a transport registration, process composition module, page shell,
or infrastructure adapter. Those remnants may wire feature capabilities, but
may not contain domain validation, persistence, Eventing definitions, reusable
UI, or a second service implementation. Feature documentation must not remain
split between its package and `dev/docs`; cross-cutting application and
repository decisions are the only material that stays in `dev/docs`.
Architecture lint will keep a shrink-only baseline for the remaining legacy
fragments and reject new ones; the baseline is deleted feature by feature as
the inventory reaches zero.

## Current implementation queue

The foundation, identity spine, Automation, Prompt, Dataset and the first
execution package boundaries are landed. The queue now tracks only unfinished
vertical drains:

1. finish Experiment run history, Simulation ClickHouse reads and Suite run
   orchestration, then remove their displaced app services;
2. finish Scenario cancellation/failure/browser execution seams and the
   remaining Workflow version/copy/execution paths;
3. harden and integrate Evaluation's production ClickHouse semantics, then
   finish Monitor and Evaluator cross-feature orchestration;
4. finish Langy turn/relay and API Key grant/project-resolution seams;
5. run the inventory-to-zero pass for Prompt, Dataset and execution-feature UI;
6. begin Telemetry, Trace and Annotation only after the execution services are
   stable; and
7. compress and relocate feature-owned ADRs, specs and developer docs as each
   feature reaches zero legacy fragments.

A package scaffold or compatibility facade does not complete an item. The
per-feature completion definition remains the gate.
