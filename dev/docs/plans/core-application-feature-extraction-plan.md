# Platform application exit ledger

**Updated:** 2026-08-27

**Committed baseline:** `9fe7392510`

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

At this baseline it is **6,332 files**. `platform/app/src` contains 6,001. The
shared working tree currently contains 5,931 files, but those 401 deletions are
not progress until their vertical slices pass review and their exact paths are
committed.

The rest are scripts, E2E coverage, specs, public assets, Prisma files and
workspace configuration. `platform/app/ee` contains zero files; Enterprise
residue now means licensed behaviour or composition still scattered elsewhere
in the application.

The large physical roots are:

| Current root                      | Files | Destination                                                                 |
| --------------------------------- | ----: | --------------------------------------------------------------------------- |
| `src/server`                      | 2,340 | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages |
| `src/features`                    | 1,259 | Feature web packages and `apps/ui` composition                              |
| `src/components`                  | 1,031 | Feature web packages, Design System and `apps/ui` composition               |
| `src/pages`                       |   243 | `apps/ui`; API compatibility pages to `apps/api`                            |
| `src/app`                         |   211 | `apps/api`                                                                  |
| `src/utils`                       |   178 | Owning feature, Design System or process app                                |
| `src/hooks`                       |   138 | Owning feature web package or `apps/ui`                                     |
| `src/runtime`                     |    93 | `apps/api`, `apps/worker`, `apps/ui`, `tools/dev-runtime`                   |
| `src/experiments-v3`              |   137 | Experiment/Evaluation packages and app composition                          |
| `src/prompts`                     |   136 | Prompt web package and `apps/ui`                                            |
| `src/optimization_studio`         |    97 | Workflow web package and app composition                                    |
| Other `src` roots and entry files |   138 | Owning feature or process app                                               |

Counts are refreshed after every committed batch. Ignored local/generated files
are regenerated or removed at final workspace deletion; they are not migration
inputs.

The current physical tree under review is smaller: `server` 1,955, `features`
1,208, `components` 1,026, `pages` 243, `app` 211, `utils` 176, `hooks` 138,
`runtime` 158, `experiments-v3` 137, `prompts` 136 and
`optimization_studio` 70. These are queue sizes, not completed migration.

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
| Trace                                               | trace OTLP intake, processing, projections, reads, overlays, query language and trace UI                     | `trace/{contract,server,web}`, process apps                                    |
| Log                                                 | log OTLP intake, processing, storage and trace contributions                                                 | `log/{contract,server}`, process apps                                          |
| Metric                                              | metric OTLP intake, processing, points, series, rollups and trace correlations                               | `metric/{contract,server}`, process apps                                       |
| Telemetry                                           | LangWatch's own opt-in usage and diagnostic reporting back to LangWatch                                      | `telemetry/{contract,server}`, process boot                                    |
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

The `auth` catalogue owner still lacks its declared package root. The
`telemetry` root is deliberately reserved for LangWatch's own opt-in call-home
usage and diagnostics and is established only with that slice. Their absence
is not permission to put either behaviour in an application bag.
The other two major mixed bags are `server/event-sourcing` (271 files) and
`server/app-layer` (360). They are split by the named owners above and are never
moved wholesale.

### Feature package integrity

The working tree currently has 40 core feature directories and 51 catalogue
entries. Trace, Log and Metric are now the catalogue owners and production app
composition uses their separate services. `auth` and `telemetry` remain empty
placeholders until their real vertical slices exist. The superseded
`otlp-ingestion` root and lockfile importers are deleted; no production or test
source imports that horizontal package.

- [x] Repair the broken Trace handoff. Trace canonicalisation and its coverage
      are back under Trace, the package pipeline is composed in production, raw
      `span_received` remains the single durable span fact seen by existing
      subscribers, and no production Trace path references Elasticsearch.
      Trace contract has 209 passing tests, Trace server has 611, and the focused
      app parity suite has 42. Strict source-shape repair and removal of the
      temporary OTLP duplicate remain part of the open Trace cut below.
- [x] Recut `otlp-ingestion` into Trace, Log and Metric, then delete its root,
      catalogue entry and workspace references. It is not retained as a
      compatibility feature.
- [x] Compose the singular Trace, Log and Metric services and move their
      catalogue ownership together. No app production import now references the
      mixed OTLP package. Do not use `telemetry` for signal code.
- [x] Delete the displaced app Log/Metric repositories now that package coverage
      proves the same queries, fields, retention, ordering, usage estimates and
      30-second rollups. The two real ClickHouse suites now consume explicit
      package testing exports; they remain in app only until the shared
      container harness moves.
- [ ] Trace every contract, server and web workspace to a production composition
      root; either wire an honest owner or remove a superseded scaffold.
- [ ] Sort the `role` catalogue subjects and rerun catalogue validation; the
      malformed entry currently makes a registered owner appear absent.
- [ ] Resolve the currently uncomposed candidates. Data Privacy contract/server
      exists beside the live app implementation; the Entitlement contract is
      used but its server has no caller; Stored Object server/APIs are not
      mounted; Feature Flag web is in its active cut. Low import counts are
      leads, not deletion authority; trace runtime registration and legacy
      duplication before deciding to wire, recut or delete.
- [ ] Compare every established package with its same-domain `platform/app`
      residue and record each remaining transport, page or worker adapter.
- [ ] Delete empty re-export shims, duplicate repositories and package surfaces
      that exist only for tests or migration narration after canonical coverage
      has moved.
- [ ] Run strict manifest/layout, package-consumer, architecture-baseline and
      declaration checks after each batch; remove only stale baseline entries.
- [ ] Repair package test exports that are excluded from their published files,
      beginning with OTLP Ingestion and Suite; an active test consumer does not
      make an unpublished export valid.
- [ ] Finish with every catalogue entry either backed by its real vertical root
      or explicitly queued with its live source named, no production
      implementation duplicated in `platform/app`, and no package surface
      without a real caller. Auth and product-usage Telemetry are the two known
      catalogue-only owners, not exceptions to forget.

### Event-sourcing decomposition

`server/event-sourcing` is not an Eventing package candidate:

| Committed files | Owner                                                                                                                                                                  |
| --------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|             417 | Feature server packages: Automation, Enterprise Billing, Coding Agent, Evaluation, Experiment, Gateway, GitHub, Langy, Log, Metric, Simulation, Suite, Topic and Trace |
|              36 | `apps/worker` and Ops composition: concrete adapters, registry, process maintenance, replay presets and infrastructure integration coverage                            |
|               1 | Delete unused `pipelines/shared/analyticsStoreBase.ts`                                                                                                                 |
|               0 | One-for-one moves into `packages/eventing`; that package already owns the reusable framework                                                                           |

The 128-file observability-signal pipeline belongs in three vertical features, not
horizontal ingestion/processing features and not six half-features. Trace, Log
and Metric each own their OTLP intake, canonical processing, durable eventing
and existing-table projections. Trace additionally owns trace reads, queries
and UI; Log owns log storage and trace contributions; Metric owns points,
series, rollups and trace correlations. A genuinely shared OTLP wire codec may
be a small technical library, but it owns no service or persistence. Evaluation,
Experiment, Simulation, project metadata and broadcast reactions remain named
feature or worker adapters.

## Deletion batches

A batch is complete only when its domain search finds no implementation under
`platform/app`. Its transport, page and worker composition move to the relevant
`apps/*` workspace in the same batch; they are not left for a later directory
shuffle. Tests, ADRs, specs and developer documentation move with the owner.

|   # | Status      | Chunk                                 | Current evidence and exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --: | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  01 | integration | Model Provider legacy cut             | Commit `4b89a72a6f` makes the feature package the owner of the catalogue, defaults, costs, credentials and Prisma persistence. The contract now has the Zod-backed legacy response mapper and its complete sentinel coverage; contract and server checks are green. Finish the API mount and managed-Bedrock composition before deleting the old router. Additive contract fields remain compatible; removal or semantic reinterpretation does not.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|  02 | active      | Scenario execution cut                | `server/scenarios` now has no production implementation. Simulation server owns the existing `simulationRunExecution` process manager; Scenario server owns its effectful execution service. Finish retargeting the five residual tests/support files and preserve the child-process prefetch overlap, cancellation, terminal events and OTEL isolation. Do not create a second Evaluation process manager.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|  03 | repair      | Gateway vertical                      | Production Virtual Key composition now receives Project and the old app trace-destination decision is down 224 lines. Review found stale test constructors and a second Gateway-owned trace-project query in budget scope reach, so this is not commit-ready. Replace that query through the complete Project service, retarget every test constructor, then continue draining the 170-file named Gateway surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|  04 | review      | Workflow and Studio                   | The reviewed working slice takes `optimization_studio` from 97 to 70 files. Workflow web owns the palette, draggable nodes, previews, running status, autosave, undo/redo, metadata, progress, run-until-here, properties frame, create/import dialog, results panel and workflow-card presentation/actions. App-only tRPC, project, toast, replication-dialog and drawer composition remains. Package typecheck and 34 files/223 tests pass. Review the accumulated exact-path manifest before commit. |
|  05 | review      | Evaluation execution family           | Evaluation server now owns the processing pipeline, deterministic projections, durable intent preparation/outcome flow and input-offload policy; Analytics owns the evaluation ClickHouse rows and rollups. Evaluation contract/server and Analytics contract/server/web typechecks pass; package coverage is 2, 156, 2, 28 and 174 tests respectively, with 42 focused app parity tests. Focused architecture lint is clear. The legacy evaluator engine remains an explicit 18-file `server/app-layer/evaluations` plus 30-file `server/evaluations` residual until Evaluator, Trace and Model Provider ports replace it; do not call this vertical complete or delete its tests yet.                                                                                                                |
|  06 | integration | Trace, Log and Metric                 | Commit `9fe7392510` lands the Log and Metric verticals: 213 exact paths, 65 committed application files removed and 10,127 lines deleted. Their four package typechecks and 97 tests pass; the relevant 94 architecture-plugin tests pass. The horizontal `telemetry` package and old app Log/Metric pipelines are gone. Trace owns canonicalisation and its reviewed live package pipeline consumes the one raw `span_received` fact; land that remaining exact manifest next without changing `stored_spans`, `trace_analytics`, `trace_summaries`, timeseries rollups or any legacy API shape. Retain no Elasticsearch ingestion or signal code under `telemetry`. |
|  07 | active      | Langy, Coding Agent and GitHub        | Inventory found 319 named Langy, 51 Coding Agent and 21 GitHub app files. The first physical batch is moving the 33-file Coding Agent processing pipeline and four-file GitHub maintenance process into their server packages, leaving only registration and ordering in worker composition. Langy follows after its callback-shaped boundary is repaired. |
|  08 | active      | Identity and tenancy                  | Inventory found 126 production files and 146 tests across Auth, User, AuthZ, Role, Organization, Project and API Key. The first cut moves the 1,173-line RoleBinding service into the existing AuthZ services, consolidates its repositories, rewires compatibility transports and deletes three production files plus four displaced tests. Auth remains a catalogue owner without a package and is a later full vertical. |
|  09 | queued      | Prompt, Dataset and Agent             | Apply the prompt/CopilotKit replacement from PR 7371 first, then drain the resulting three independent feature surfaces. Prompt's old named lower bound is 161 files; Dataset/Stored Object has 88 before scattered adapters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|  10 | inventory   | Analytics, Dashboard and Topic        | Analytics evaluation reads have moved with chunk 05. Topic is under a gated inventory before edits: clustering, transports, eventing, workers and UI must move as one reviewed vertical without importing Trace repositories. The remaining Analytics lower bound is refreshed after the Evaluation commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|  11 | review      | Automation, Notification and Presence | The 1,092-line settlement dispatcher is now split into named settlement, email, notification and persistence collaborators behind Automation server, using the complete Trace service. Terminal persistence monitoring and the effectful dispatch scenarios are restored; Automation has 142, Trace contract 209, Trace server 611 and the focused app slice 20 passing tests. Review and land the exact manifest before moving the wider UI residue. |
|  12 | active      | Data and security utilities           | Commits `0cf394039c` and `8b68603fd8` move retroactive work and storage metering behind the canonical Data Retention service. The app-owned meter service and unit suite are deleted; tRPC response/auth behaviour, cache semantics, ClickHouse limits and live-schema coverage are preserved. Eight deliberate app residues remain: transport, page shell, compatibility index, RBAC-aware scope read, policy authz/read, resolver and legacy policy schema. Move those to the process apps or feature package, then continue Data Privacy, Secret, Share and Stored Object.                                                                                                                                                                                                                                                                                                         |
|  13 | inventory   | Ops and Enterprise seams              | Core Ops is under a gated inventory before edits. Move reusable admin/ops behaviour to the core Ops feature and process composition only; do not pull licensed implementations out of `packages/enterprise/**`. Scheduler and replay tools move only when their ownership and transport/eventing parity are explicit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|  14 | queued      | Generic browser surface               | Empty root `components`, `hooks`, `utils`, navigation/onboarding/home/briefing and generic feature bags into feature web, Design System or `apps/ui`; no new shared catch-all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|  15 | integration | Feature Flag                          | Commits `3727210dc9` and `e767291583` establish the canonical target/service boundary, AuthZ grant, controlled web presentation, experiments menu and typed tRPC surface. Contract/server/web/AuthZ coverage passes, as do the 12 focused app authorization tests. The remaining cut is mechanical but mandatory: migrate every old server caller, move Ops transport to the composed service, remove PostHog evaluation config, then delete the 20 displaced `server/featureFlag` files. |
|  16 | queued      | UI composition                        | `apps/ui` is still an eight-file runtime skeleton. Apply the React compiler setup and form fixes from PR 7282 at the final Vite root, then move the browser entry, router, pages, styles, public assets and browser tests there. Remove browser inference of server implementation types. |
|  17 | queued      | API composition                       | `apps/api` is still an eight-file runtime skeleton. Move the 119 Hono files, 139 server API/tRPC files, middleware, static delivery, auth transport, OpenAPI and compatibility adapters there. Direct Hono routes move onto `@langwatch/api`: URLs and verbs stay fixed while handlers validate input and output schemas. Middleware serializes trusted `HandledError` fields losslessly; dashboard remediation copy comes only from a trusted document keyed by error code. Existing statuses, headers and complete JSON shapes remain adapter contracts. |
|  18 | queued      | Worker composition                    | `apps/worker` is still an eight-file runtime skeleton. Move Eventing/Group Queue registration, consumers, schedulers, task registry and worker boot there from `server/event-sourcing` and `runtime`; deterministic feature event logic stays in feature server packages. |
|  19 | queued      | Infrastructure and config             | Move Prisma schema/migrations/client lifecycle, boot config, storage, mail and process instrumentation to named packages/process apps. The physical split must eliminate the remaining 81 global App users, 52 global Prisma users and 92 direct environment readers rather than copying them into new roots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|  20 | queued      | Repository support                    | Move feature specs/docs/tests to owners; E2E to `dev/tests/e2e`; build/start/seed/ops scripts to their app, infrastructure package or contributor tooling; public product assets to UI and repository artwork to `.github/assets`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|  21 | queued      | Delete and rebase                     | Move remaining package/config/build files and remove every external `platform/app` reference, including `apps/server`, workspace config, Makefile, CI, Docker, Helm/compose, scripts, generated OpenAPI location and architecture baselines. Then delete `platform/app`. Fetch and rebase onto fresh `origin/main`, resolve conflicts into the new owners rather than restoring app code, and rerun the complete deletion/parity proof. |

The immediate integration order is **06, 11, 04, 07, 08, 05, 02, 03, 01, 15**.
Work now lands deletion-sized verticals: finish Trace, then Automation and
Workflow. Coding Agent/GitHub and AuthZ proceed in parallel on disjoint package
roots. Feature Flag caller tidying waits until those larger reviewed cuts land.

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

The reusable web, retroactive mutation and storage-meter slices are complete.
Commits `0cf394039c` and `8b68603fd8` deleted:

- `server/data-retention/retroactive/retroactiveApply.ts`;
- `server/data-retention/retroactive/retroactiveUpdate.service.ts`; and
- their two app-owned unit test files;
- `server/data-retention/metering/storageMeter.service.ts`; and
- its app-owned unit suite.

The application moved from 6,405 to 6,401 files. Storage metering is now a
private collaborator of the one Data Retention service; the renamed app reader
is only temporary RBAC/transport composition. Eight deliberate Data Retention
residues remain:

| Remaining code                                           | Destination                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Permission-filtered storage scope read                   | `apps/api` composition, delegating byte totals to Data Retention                |
| Policy authz/read DTOs, legacy schema and resolver       | Data Retention contract/server plus API authorisation composition               |
| tRPC route, compatibility index and settings page        | Compatibility adapters in `apps/api` and composition in `apps/ui`               |
| TTL reconciliation, table writers, replay and migrations | ClickHouse infrastructure and worker composition, consuming the contract values |

The next deletion batch is policy/transport composition. The 19 managed
retention tables, 12 metered tables and timeseries/analytics stores remain
distinct parity contracts. `trace_summaries`, `trace_analytics` and
`trace_analytics_rollup` are not interchangeable.

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

After all batches, fetch and rebase onto current `origin/main`. Conflict
resolution must preserve the feature/package owners and absorb new upstream
behaviour into them; it must not recreate compatibility implementations under
`platform/app`. Rerun the full workspace, parity and deletion proof on the
rebased commit.

The final proof is deliberately dull:

```sh
test ! -e platform/app
```

## Forecast

This is 21 macro chunks, likely 30–40 reviewable commits. With the current
parallelism, the first four chunks are the next checkpoint. A complete deletion
is roughly **three to five sustained migration days**, with Trace, Log and Metric
the main uncertainty. The file count and completed chunks take precedence
over the clock estimate.
