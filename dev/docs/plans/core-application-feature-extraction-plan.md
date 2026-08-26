# Platform application exit ledger

**Updated:** 2026-08-26

**Snapshot:** working tree at `6ddc34a65f`

**Goal:** delete `platform/app`.

This is the one migration ledger for the application split. It records current
residue and deletion batches. Accepted architecture remains in
[ADR-101](../adr/101-feature-package-surfaces.md),
[ADR-111](../adr/111-physical-application-workspaces.md), and
[ADR-112](../adr/112-singular-feature-ownership.md); this file does not repeat
those decisions.

## Progress measure

The authoritative number is:

```sh
rg --files --hidden platform/app \
  -g '!node_modules/**' \
  -g '!.next/**' \
  -g '!dist/**' \
  -g '!coverage/**' \
  | wc -l
```

At this snapshot it is **6,312 files**:

| Kind                                           | Files |
| ---------------------------------------------- | ----: |
| Production code                                | 3,560 |
| Tests                                          | 2,475 |
| Configuration, assets, specs and other support |   277 |

`platform/app/src` contains 5,981 files. The rest are scripts, E2E coverage,
specs, public assets, Prisma files and workspace configuration. `platform/app/ee`
contains zero files; Enterprise residue now means licensed behaviour or
composition still scattered elsewhere in the application.

The large physical roots are:

| Current root                      |   All | Production | Tests | Destination                                                                 |
| --------------------------------- | ----: | ---------: | ----: | --------------------------------------------------------------------------- |
| `src/server`                      | 2,290 |      1,031 | 1,179 | Feature server packages, `apps/api`, `apps/worker`, infrastructure packages |
| `src/features`                    | 1,179 |        770 |   372 | Feature web packages and `apps/ui` composition                              |
| `src/components`                  | 1,098 |        733 |   364 | Feature web packages, Design System and `apps/ui` composition               |
| `src/pages`                       |   241 |        165 |    74 | `apps/ui`; API compatibility pages to `apps/api`                            |
| `src/app`                         |   211 |        119 |    91 | `apps/api`                                                                  |
| `src/utils`                       |   176 |        107 |    69 | Owning feature, Design System or process app                                |
| `src/hooks`                       |   139 |         87 |    52 | Owning feature web package or `apps/ui`                                     |
| `src/runtime`                     |   139 |         98 |    41 | `apps/api`, `apps/worker`, `apps/ui`, `tools/dev-runtime`                   |
| `src/experiments-v3`              |   137 |         63 |    74 | Experiment/Evaluation packages and app composition                          |
| `src/prompts`                     |   136 |         96 |    40 | Prompt web package and `apps/ui`                                            |
| `src/optimization_studio`         |    97 |         74 |    23 | Workflow web package and app composition                                    |
| Other `src` roots and entry files |   138 |         82 |    51 | Owning feature or process app                                               |

Counts include the shared dirty worktree and are refreshed after every merged
batch. They are evidence, not a baseline that permits new files.

Five ignored local/generated files (`.env*`, `.DS_Store` and
`src/tasks.generated.ts`) are not included. They are regenerated or removed at
the final workspace deletion; they are not migration inputs.

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

|   # | Status          | Chunk                                 | Current evidence and exit                                                                                                                                                                                                                                                                                |
| --: | --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  01 | review          | Model Provider legacy cut             | The 1,824-line service and 583-line repository are deleted in the worktree. The exact named lower-bound surface is 81 files across `server/modelProviders`, model-provider UI and both Hono route groups; also drain settings hooks, scripts and runtime adapters.                                       |
|  02 | active          | Scenario execution cut                | Drain the 48-file `server/scenarios` residue: processor/child execution, typed config, secrets, ingest lag and browser coordination. The exact named Scenario surface is 99 files; move its Scenario/Simulation/Suite composition and canonical coverage too.                                            |
|  03 | active          | Gateway vertical                      | The exact named surface is 170 files: 78 gateway server, 14 spend-pipeline, 71 gateway UI/page and seven Hono transport files. Drain the named tRPC/internal transports too. Strict architecture must reach zero before integration.                                                                     |
|  04 | started         | Workflow and Studio                   | The current worktree has already removed 16 Studio files. Move the remaining 97-file `optimization_studio` tree, workflow persistence/execution, routes and pages; preserve DSL and response parity.                                                                                                     |
|  05 | queued          | Evaluation execution family           | Move Evaluator, Evaluation, Monitor, Experiment, Suite and Simulation as separate owners. Exact named lower bounds are Experiment 223 files, Evaluation/Evaluator 135, Simulation 91 and Suite 85; drain their app-layer and eventing pipelines too.                                                     |
|  06 | queued, largest | Telemetry and Trace                   | Establish the missing Telemetry package and move intake first, then Trace storage/query/eventing/web. The exact named Trace surface is 1,052 files; Telemetry/tracer residue is additional. Preserve every response field and keep `trace_analytics`, `trace_summaries` and timeseries rollups distinct. |
|  07 | queued          | Langy, Coding Agent and GitHub        | Finish their separate services and move API, UI, webhook and durable pipeline composition. The exact `langy`/`asaplangy` web residue is 216 files before routes and pipelines.                                                                                                                           |
|  08 | queued          | Identity and tenancy                  | Finish Auth, User, AuthZ, Role, Organization, Project and API Key across settings/me/member UI, compatibility transports and boot.                                                                                                                                                                       |
|  09 | queued          | Prompt, Dataset and Agent             | Drain all three independent feature surfaces, including reusable editors, hooks, execution adapters and specs. Prompt's exact named lower bound is 161 files; Dataset/Stored Object has 88 before scattered adapters.                                                                                    |
|  10 | queued          | Analytics, Dashboard and Topic        | Consolidate duplicate reads, move analytical UI, and move topic process/eventing without leaking Trace repositories. Analytics has an exact named lower bound of 164 files.                                                                                                                              |
|  11 | queued          | Automation, Notification and Presence | Move reusable authoring UI and policy to feature packages; move effect execution and realtime registration to process apps.                                                                                                                                                                              |
|  12 | queued          | Data and security utilities           | Complete Data Privacy, Data Retention, Secret, Share and Stored Object, including public viewer and storage adapters.                                                                                                                                                                                    |
|  13 | queued          | Ops and Enterprise seams              | Move core admin/ops to Ops. Move every licensed residue to its Enterprise feature or Enterprise API/worker/web composition package.                                                                                                                                                                      |
|  14 | queued          | Generic browser surface               | Empty root `components`, `hooks`, `utils`, navigation/onboarding/home/briefing and generic feature bags into feature web, Design System or `apps/ui`; no new shared catch-all.                                                                                                                           |
|  15 | queued          | UI composition                        | Move the browser entry, router, pages, styles, public assets and Vite/browser tests to `apps/ui`. Remove browser inference of server implementation types.                                                                                                                                               |
|  16 | queued          | API composition                       | Move Hono/tRPC roots, middleware, static delivery, auth transport, OpenAPI and remaining compatibility adapters to `apps/api`.                                                                                                                                                                           |
|  17 | queued          | Worker composition                    | Move Eventing/Group Queue registration, consumers, schedulers, task registry and worker boot to `apps/worker`; deterministic feature event logic stays in feature server packages.                                                                                                                       |
|  18 | queued          | Infrastructure and config             | Move Prisma schema/migrations/client lifecycle, boot config, storage, mail and process instrumentation to named packages/process apps. Delete global Prisma, global App and import-time environment access.                                                                                              |
|  19 | queued          | Repository support                    | Move feature specs/docs/tests to owners; E2E to `dev/tests/e2e`; build/start/seed/ops scripts to their app, infrastructure package or contributor tooling; public product assets to UI and repository artwork to `.github/assets`.                                                                       |
|  20 | queued          | Delete the workspace                  | Move the remaining package/config/build files, update workspace filters, CI, Docker, Helm and self-host staging, then delete `platform/app` and its migration baselines.                                                                                                                                 |

The immediate integration order is **01, 02, 04, 03**. Model Provider and the
small Scenario/Workflow cuts should land while Gateway finishes its strict
repair. After those, work begins on **05 and 06 in parallel**; Trace is the
largest and least predictable batch, so it starts before the smaller tail.

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

This is 20 macro chunks, likely 30–40 reviewable commits. With the current
parallelism, the first four chunks are the next checkpoint. A complete deletion
is roughly **three to five sustained migration days**, with Trace/Telemetry the
main uncertainty. The file count and completed chunks take precedence over the
clock estimate.
