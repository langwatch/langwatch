# Platform application exit ledger

**Updated:** 2026-08-26

**Snapshot:** committed tree at `d027e0090a`

**Goal:** delete `platform/app`.

This is the one migration ledger for the application split. It records current
residue and deletion batches. Accepted architecture remains in
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md); this file does not repeat
those decisions.

## Progress measure

The authoritative committed number is:

```sh
git ls-tree -r --name-only HEAD platform/app | wc -l
```

At this snapshot it is **6,410 files**. `platform/app/src` contains 6,079.
The shared working tree is lower while migration batches are under review, but
those deletions are not progress until their exact paths are committed.

The rest are scripts, E2E coverage, specs, public assets, Prisma files and
workspace configuration. `platform/app/ee` contains zero files; Enterprise
residue now means licensed behaviour or composition still scattered elsewhere
in the application.

The large physical roots are:

| Current root                      | Files | Destination                                                                 |
| --------------------------------- | ----: | --------------------------------------------------------------------------- |
| `src/server`                      | 2,532 | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages |
| `src/features`                    | 1,275 | Feature web packages and `apps/ui` composition                              |
| `src/components`                  | 1,098 | Feature web packages, Design System and `apps/ui` composition               |
| `src/pages`                       |   241 | `apps/ui`; API compatibility pages to `apps/api`                            |
| `src/app`                         |   211 | `apps/api`                                                                  |
| `src/utils`                       |   177 | Owning feature, Design System or process app                                |
| `src/hooks`                       |   139 | Owning feature web package or `apps/ui`                                     |
| `src/runtime`                     |    82 | `apps/api`, `apps/worker`, `apps/ui`, `tools/dev-runtime`                   |
| `src/experiments-v3`              |   137 | Experiment/Evaluation packages and app composition                          |
| `src/prompts`                     |   136 | Prompt web package and `apps/ui`                                            |
| `src/optimization_studio`         |    97 | Workflow web package and app composition                                    |
| Other `src` roots and entry files |   139 | Owning feature or process app                                               |

Counts are refreshed after every committed batch. Ignored local/generated files
are regenerated or removed at final workspace deletion; they are not migration
inputs.

## Ownership map

Names separated by commas below remain separate singular features. A row groups
their migration because their old code is entangled, not because their service
boundaries are being merged.

| Owner                                               | Remaining application anchors                                                                                | Destination                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Auth                                                | `server/auth*`, `server/better-auth`, `server/auth0`, auth/CLI routes and pages, session middleware          | `auth/{contract,server,web}`, `apps/api`, `apps/ui`                            |
| User                                                | `server/api/routers/user.ts`, `/api/me`, `/api/user-avatar`, `components/me`, `pages/me`                     | `user/{contract,server,web}`, thin app transports/pages                        |
| AuthZ, Role                                         | permission middleware, `role`, `roleBinding`, `authz` compatibility routers and tests                        | Their existing strict packages; transports to `apps/api`                       |
| Organization                                        | organization, team, group, invite, membership and workspace switcher code across server, settings and routes | `organization/{contract,server,web}`, app composition                          |
| Project                                             | project routes, settings, workspace selection and project guards                                             | `project/{contract,server,web}`, app composition                               |
| API Key                                             | `server/api-key`, API-key middleware, `apiKey` router, `/api/api-keys`, settings UI                          | `api-key/{contract,server,web}`, `apps/api`                                    |
| Entitlement                                         | plan/limit reads and provider-neutral capability checks                                                      | `entitlement/{contract,server}`, app composition                               |
| Model Provider                                      | `server/modelProviders` (70 files), model-provider/default routes, provider hooks, forms and settings        | `model-provider/{contract,server,web}`, app composition                        |
| Prompt                                              | `src/prompts`, prompt pages/components/hooks, prompt and tag transports                                      | `prompt/{contract,server,web}`, app composition                                |
| Dataset                                             | dataset/record routes, dataset components and execution adapters                                             | `dataset/{contract,server,web}`, app composition                               |
| Agent                                               | agent routes, `components/agents`, HTTP-node configuration and execution adapters                            | `agent/{contract,server,web}`, app composition                                 |
| Workflow                                            | `src/optimization_studio` (97 files), `server/workflows`, workflow routes and Studio pages                   | `workflow/{contract,server,web}`, app composition                              |
| Evaluator                                           | evaluator routes/components and evaluator execution adapters                                                 | `evaluator/{contract,server,web}`, app composition                             |
| Evaluation, Monitor                                 | evaluation engine, monitor transports, online-evaluation UI and eventing consumers                           | Separate feature packages, `apps/api`, `apps/worker`, `apps/ui`                |
| Experiment                                          | `src/experiments-v3` (137 files), experiment routes/pages and experiment-run eventing                        | `experiment/{contract,server,web}`, three process apps                         |
| Scenario                                            | `server/scenarios` (48 files), scenario routes, child execution, browser tab coordination                    | `scenario/{contract,server,web}`, process apps                                 |
| Simulation                                          | simulation routes/UI and `simulation-processing` pipeline                                                    | `simulation/{contract,server,web}`, process apps                               |
| Suite                                               | suite routes/UI, suite execution adapter and `suite-run-processing`                                          | `suite/{contract,server,web}`, process apps                                    |
| Telemetry                                           | OTLP, collector, tracer intake and normalisation                                                             | `telemetry/{contract,server}`, `apps/api`, `apps/worker`                       |
| Trace                                               | `features/traces-v2`, trace reads/writes, overlays, filters, trace-processing and trace UI                   | `trace/{contract,server,web}`, process apps                                    |
| Annotation                                          | annotation queues/scores/components and annotation transports                                                | `annotation/{contract,server,web}`, app composition                            |
| Share                                               | share/shared-trace routes and public viewer UI                                                               | `share/{contract,server,web}`, app composition                                 |
| Analytics                                           | analytics/LWQL/cost query code and reusable analytical UI                                                    | `analytics/{contract,server,web}`, app composition                             |
| Dashboard                                           | dashboards, graphs, saved charts and dashboard UI                                                            | `dashboard/{contract,server,web}`, app composition                             |
| Topic                                               | topic-clustering app layer and durable pipeline                                                              | `topic/{contract,server,web}`, process apps                                    |
| Data Privacy                                        | redaction/capture policy, settings and transport code                                                        | `data-privacy/{contract,server,web}`, app composition                          |
| Data Retention                                      | retention/pinning policy, work and settings UI                                                               | `data-retention/{contract,server,web}`, process apps                           |
| Gateway                                             | `server/gateway` (78 files), spend pipeline (14), gateway UI (71), routes and transports                     | `gateway/{contract,server,web}`, process apps                                  |
| GitHub                                              | GitHub routes, webhooks and maintenance pipeline                                                             | `github/{contract,server,web}`, process apps                                   |
| Coding Agent                                        | coding-agent routes, transcript/Trace collaboration and processing pipeline                                  | `coding-agent/{contract,server,web}`, process apps                             |
| Langy                                               | `features/langy` (210 files), Langy routes, relay/turn adapters and pipelines                                | `langy/{contract,server,web}`, process apps                                    |
| Automation                                          | automation/trigger/report policy, provider delivery and authoring UI                                         | `automation/{contract,server,web}`, process apps                               |
| Notification                                        | user notification preferences and delivery collaboration                                                     | `notification/{contract,server,web}`, process apps                             |
| Presence                                            | browser presence, SSE and Redis-backed lifecycle                                                             | `presence/{contract,server,web}`, process apps                                 |
| Secret                                              | secret compatibility API and UI                                                                              | `secret/{contract,server,web}`, `apps/api`, `apps/ui`                          |
| Feature Flag                                        | `server/featureFlag` (20 files), 59 named callers, Ops controls and browser guards                           | `feature-flag/{contract,server,web}`, app composition                          |
| Stored Object                                       | upload/delivery/migration code and storage adapters                                                          | `stored-object/{contract,server}`, process apps                                |
| Ops                                                 | `server/app-layer/ops`, `server/ops`, admin/ops pages and components, scheduler/replay tools                 | `ops/{contract,server,web}`, process apps                                      |
| Enterprise features                                 | governance/licensing/billing/managed-provider/SaaS/SCIM/SSO/webhook residue outside the now-empty `ee` tree  | `packages/enterprise/features/**` and matching Enterprise composition packages |
| Home, onboarding, navigation, command bar, briefing | Cross-feature screens and orchestration with no independent persistence owner                                | `apps/ui` and thin `apps/api` composition                                      |
| Design System                                       | generic visual primitives, icons, form controls and browser-only formatting                                  | `packages/design-system`                                                       |
| Process infrastructure                              | config, boot, Prisma, Redis, ClickHouse, queues, mail, storage, SSE and observability wiring                 | Named infrastructure packages and the owning process app                       |

Two catalogue owners do not yet have their declared package roots: `auth` and
`telemetry`. Their batches must establish strict packages before moving code;
the absence is not permission to put their behaviour in an application bag.
The other two major mixed bags are `server/event-sourcing` (422 files) and
`server/app-layer` (396). They are split by the named owners above and are never
moved wholesale.

## Deletion batches

A batch is complete only when its domain search finds no implementation under
`platform/app`. Its transport, page and worker composition move to the relevant
`apps/*` workspace in the same batch; they are not left for a later directory
shuffle. Tests, ADRs, specs and developer documentation move with the owner.

|   # | Status          | Chunk                                 | Current evidence and exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --: | --------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  01 | integration     | Model Provider legacy cut             | Commit `4b89a72a6f` makes the feature package the owner of the catalogue, defaults, costs, credentials and Prisma persistence. Scope resolution uses the complete Project and Organization services. The app cutover is separate because its shared composition root also contains the active Scenario and Workflow cuts; provider validation, transports and settings UI remain until that integration lands.                                                                                                                                 |
|  02 | active          | Scenario execution cut                | `server/scenarios` now has no production implementation. Simulation server owns the existing `simulationRunExecution` process manager; Scenario server owns its effectful execution service. Finish retargeting the five residual tests/support files and preserve the child-process prefetch overlap, cancellation, terminal events and OTEL isolation. Do not create a second Evaluation process manager.                                                                                                                                    |
|  03 | repair          | Gateway vertical                      | Production Virtual Key composition now receives Project and the old app trace-destination decision is down 224 lines. Review found stale test constructors and a second Gateway-owned trace-project query in budget scope reach, so this is not commit-ready. Replace that query through the complete Project service, retarget every test constructor, then continue draining the 170-file named Gateway surface.                                                                                                                             |
|  04 | active          | Workflow and Studio                   | `optimization_studio` is down from 97 to 85 files. Workflow web owns the palette, draggable nodes, previews, running status, autosave, undo/redo, metadata, progress, run-until-here and the reusable properties frame. Move the remaining browser-owned property panels, results, evaluate, optimise, history, dataset and execution-transport surfaces while preserving the DSL and response shapes.                                                                                                                                         |
|  05 | active          | Evaluation execution family           | Evaluation server owns the processing pipeline, deterministic projections, retry-safe execution intent, analytics stores and distinct ClickHouse analytics/rollup adapters. Trace supplies the portable span/event reads and no Elasticsearch ingestion shape was retained. Finish the stored-input read/offload seam and retarget its tests; Simulation's existing process manager remains the only manager for this execution path.                                                                                                          |
|  06 | audited, queued | Telemetry and Trace                   | Establish the missing Telemetry package and move intake first, then Trace storage/query/eventing/web. The live intake routes call `app.traces.collection` and the registered trace-processing event-sourcing pipeline; no Elasticsearch client or direct dependency remains. Delete the dead Elasticsearch-named shapes, converters, fixtures, comments and retired Organization configuration columns instead of migrating them. Preserve every response field and keep `trace_analytics`, `trace_summaries` and timeseries rollups distinct. |
|  07 | queued          | Langy, Coding Agent and GitHub        | Finish their separate services and move API, UI, webhook and durable pipeline composition. The exact `langy`/`asaplangy` web residue is 216 files before routes and pipelines.                                                                                                                                                                                                                                                                                                                                                                 |
|  08 | queued          | Identity and tenancy                  | Finish Auth, User, AuthZ, Role, Organization, Project and API Key across settings/me/member UI, compatibility transports and boot.                                                                                                                                                                                                                                                                                                                                                                                                             |
|  09 | queued          | Prompt, Dataset and Agent             | Apply the prompt/CopilotKit replacement from PR 7371 first, then drain the resulting three independent feature surfaces. Prompt's old named lower bound is 161 files; Dataset/Stored Object has 88 before scattered adapters.                                                                                                                                                                                                                                                                                                                  |
|  10 | queued          | Analytics, Dashboard and Topic        | Consolidate duplicate reads, move analytical UI, and move topic process/eventing without leaking Trace repositories. Analytics has an exact named lower bound of 164 files.                                                                                                                                                                                                                                                                                                                                                                    |
|  11 | active          | Automation, Notification and Presence | Presence reusable browser state and components now live in `presence/web`; app callers use that package and the duplicate implementation is deleted. The app retains only tRPC/cross-feature hooks and page composition until they move to `apps/ui`. Continue Automation and Notification, then move realtime registration to process composition.                                                                                                                                                                                            |
|  12 | active          | Data and security utilities           | Data Retention contract/server own policy cascade, persistence, cache and pins; reusable settings presentation now lives in `data-retention/web`. The remaining Data Retention cut is nine app server files: move retroactive execution first, then the metering service and portable policy values; keep permission-filtered scope enumeration, tRPC compatibility, page composition and ClickHouse process wiring in the relevant process apps. Continue Data Privacy, Secret, Share and Stored Object afterwards.                           |
|  13 | queued          | Ops and Enterprise seams              | Move core admin/ops to Ops. Move every licensed residue to its Enterprise feature or Enterprise API/worker/web composition package.                                                                                                                                                                                                                                                                                                                                                                                                            |
|  14 | queued          | Generic browser surface               | Empty root `components`, `hooks`, `utils`, navigation/onboarding/home/briefing and generic feature bags into feature web, Design System or `apps/ui`; no new shared catch-all.                                                                                                                                                                                                                                                                                                                                                                 |
|  15 | queued          | UI composition                        | Apply the React compiler setup and form fixes from PR 7282 at the final Vite root, then move the browser entry, router, pages, styles, public assets and browser tests to `apps/ui`. Remove browser inference of server implementation types.                                                                                                                                                                                                                                                                                                  |
|  16 | queued          | API composition                       | Move Hono/tRPC roots, middleware, static delivery, auth transport, OpenAPI and compatibility adapters to `apps/api`. Direct Hono routes must move onto `@langwatch/api`: REST keeps its URLs and verbs but handlers receive one schema-validated input and return schema-validated output, while middleware serializes errors. Existing statuses, headers and complete JSON shapes remain compatibility contracts at the adapter.                                                                                                              |
|  17 | queued          | Worker composition                    | Move Eventing/Group Queue registration, consumers, schedulers, task registry and worker boot to `apps/worker`; deterministic feature event logic stays in feature server packages.                                                                                                                                                                                                                                                                                                                                                             |
|  18 | queued          | Infrastructure and config             | Move Prisma schema/migrations/client lifecycle, boot config, storage, mail and process instrumentation to named packages/process apps. Delete global Prisma, global App and import-time environment access.                                                                                                                                                                                                                                                                                                                                    |
|  19 | queued          | Repository support                    | Move feature specs/docs/tests to owners; E2E to `dev/tests/e2e`; build/start/seed/ops scripts to their app, infrastructure package or contributor tooling; public product assets to UI and repository artwork to `.github/assets`.                                                                                                                                                                                                                                                                                                             |
|  20 | queued          | Feature Flag                          | Move the 20-file store/service/rules/cache implementation and its 59 named callers into the singular `feature-flag` package. It is the raw, powerful encapsulation for definitions, targeting, evaluation, persistence, cache invalidation, Ops controls and browser guards. Expose one canonical service; callers supply authorised context and consume decisions rather than storing flags or reimplementing evaluation.                                                                                                                     |
|  21 | queued          | Delete the workspace                  | Move the remaining package/config/build files, update workspace filters, CI, Docker, Helm and self-host staging, then delete `platform/app` and its migration baselines.                                                                                                                                                                                                                                                                                                                                                                       |

The immediate integration order is **01, 02, 04, 03**. Model Provider and the
small Scenario/Workflow cuts should land while Gateway finishes its strict
repair. After those, work begins on **05 and 06 in parallel**; Trace is the
largest and least predictable batch, so it starts before the smaller tail.

### Evaluation execution cut map

This is the first closed slice of chunk 05:

| Current code                                                                                               | Owner after the cut                                                                     |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `server/app-layer/evaluations` execution, factories, cost recording and read-model repositories (30 files) | Evaluation server                                                                       |
| `event-sourcing/pipelines/evaluation-processing` events, commands and projections (19 files)               | Evaluation server                                                                       |
| Evaluation pipeline registration and effect executors                                                      | `apps/worker` composition                                                               |
| `server/evaluations` evaluator dispatch still called by execution                                          | Evaluator or Evaluation server according to whether it defines an evaluator or runs one |
| REST, Hono and tRPC compatibility handlers                                                                 | `apps/api`, delegating to Evaluation/Evaluator services with unchanged wire shapes      |
| Managed-provider selection                                                                                 | Model Provider service; core Evaluation does not import Enterprise contracts            |

The `simulationRunExecution` process manager is not part of this later cut. It
moves with chunk 02 because it owns Scenario execution dispatch, cancellation
and terminal Simulation events.

### Data Retention cut map

The reusable web slice is complete. Nine production files remain in the app:

| Remaining code                                           | Destination                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Retroactive mutation, progress and cancellation          | Data Retention server behind a typed ClickHouse port; worker execution in `apps/worker` |
| Storage meter and cache                                  | Data Retention server; permission-filtered project enumeration stays in API composition |
| Portable policy values and duplicate resolver            | Data Retention contract; platform default injected by boot                              |
| tRPC routes, authz/read DTOs and settings page           | Compatibility adapters in `apps/api` and composition in `apps/ui`                       |
| TTL reconciliation, table writers, replay and migrations | ClickHouse infrastructure and worker composition, consuming the contract values         |

The next deletion batch is retroactive execution plus its tests, followed by
the meter service. The 19 managed retention tables, 12 metered tables and
timeseries/analytics stores remain distinct parity contracts.

PR 7282 and PR 7371 are migration inputs, not post-migration follow-ups. They
overlap the current application tree, so their intended changes are applied to
the final feature and process owners before the affected UI is moved. The old
Vite or prompt implementation is not migrated merely to replace it afterwards.

## Batch proof

Every batch records:

1. the before/after `platform/app` file count and exact deleted paths;
2. canonical contract/server/web ownership and the app composition destination;
3. API, auth, response, eventing, persistence and UI parity evidence;
4. package typechecks/tests, focused compatibility tests, Oxfmt, Oxc,
   architecture lint, test-quality review and `git diff --check`;
5. the remaining domain search results, which must be either zero or named
   process composition moving in that same batch; and
6. one small commit containing only that reviewed slice.

The final proof is deliberately dull:

```sh
test ! -e platform/app
```

## Forecast

This is 21 macro chunks, likely 30–40 reviewable commits. With the current
parallelism, the first four chunks are the next checkpoint. A complete deletion
is roughly **three to five sustained migration days**, with Trace/Telemetry the
main uncertainty. The file count and completed chunks take precedence over the
clock estimate.
