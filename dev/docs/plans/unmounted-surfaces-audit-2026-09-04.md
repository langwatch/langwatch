# Unmounted surfaces audit — `origin/main` vs `feat/strict-feature-layout-v0`

Read-only audit, 2026-09-04. Compares what `origin/main` actually served against
what this branch actually mounts, for all four runtime surfaces plus tasks.
Nothing here trusts a comment: every row is a registration site.

**Snapshot caveat.** The worktree is shared and was being edited during the
audit. `HEAD` is `3c82ae4260`; `apps/api/src/app-rest/*` and
`apps/api/src/app/api-production.composition.ts` were dirty. One finding —
the Better Auth family — changed state mid-audit and is recorded as it stands
in the working tree.

Main's REST composition root is `platform/app/src/server/api-router.ts`
(85 `api.route(` registrations, lines 116–231), called once from
`platform/app/src/start.ts:234`.

---

## 1. REST

The branch mounts through three sites:
`apps/api/src/app-rest/app-rest.process-features.ts:526` (process families),
`apps/api/src/app-rest/app-rest.packaged-families.ts:399` (packaged families,
each gated on a service the process composed), and a tail of four extra
`.route("/")` calls in `apps/api/src/app/api-production.composition.ts:1832–1870`
(secrets, api-keys, gateway platform/spend/internal, ElevenLabs).

### Gaps

| Path family                                                                          | main file:line                                                           | branch file:line                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/*` (Better Auth: sign-in, sign-up, session, sign-out, OAuth/SSO callback) | `api-router.ts:216` → `server/routes/auth.ts`                            | `app-rest.process-features.ts:730` (mount) + `api-production.composition.ts:1364,1818` (`composeAuthRest`)        | **Was built-but-unmounted; wired in the uncommitted working tree during this audit.** `git show HEAD:app-rest.process-features.ts` has zero references to `createAuthRestApp`; the working-tree copy mounts it. Not yet committed.                                                                                                                                              |
| `/api/webhooks/stripe`                                                               | `server/routes/misc.ts:1534`                                             | `packages/enterprise/features/billing/server/src/transport/api-rest/stripe-webhook.api.ts:48`                     | **Built-but-unmounted.** `createStripeWebhookRestApp` has zero references anywhere in `apps/`.                                                                                                                                                                                                                                                                                  |
| `/api/admin/*` (impersonate + backoffice resource CRUD)                              | `api-router.ts:208` → `platform/app/ee/admin/routes/admin.ts:43,108,233` | `packages/features/ops/server/src/transport/api-rest/admin.api.ts:111`                                            | **Built-but-unmounted.** `createAdminRestApp` has zero references in `apps/`.                                                                                                                                                                                                                                                                                                   |
| `/api/export/traces` (bulk trace export)                                             | `api-router.ts:144` → `app/api/export/traces/[[...route]]/app.ts`        | `packages/features/trace/server/src/transport/api-rest/trace-export.api.ts:102`                                   | **Built-but-unmounted.** `createExportTracesRestApp` is only re-exported (`apps/api/src/index.ts:226`); `apps/api/src/features/export/` contains only `scenario-run-export-rest.mount.ts`.                                                                                                                                                                                      |
| `POST /api/workflows/:id/evaluate`                                                   | `app/api/workflows/[[...route]]/app.ts:287`                              | `api-packaged-rest.composition.ts` `triggerWorkflowEvaluation` (rejects with `ApiRestCapabilityUnavailableError`) | **Partially built.** Route mounts and refuses by name; the other five workflow routes answer.                                                                                                                                                                                                                                                                                   |
| `/api/cron/old_lambdas_cleanup`, `/api/cron/trace_analytics`, `/api/cron/seed_demo`  | `server/routes/cron.ts:74,77,80,230,231`                                 | none                                                                                                              | **Absent.** No `/api/cron` family on the branch. `trace_analytics` was the SaaS per-org usage-limit sweep.                                                                                                                                                                                                                                                                      |
| `POST /api/track_usage` (anonymous self-hosted instance telemetry receiver)          | `server/routes/misc.ts:1288`                                             | none                                                                                                              | **Absent.** The _sender_ survives (`packages/features/ops/server/.../ops-worker.contribution.ts`) but is itself uninstalled (see §3); the receiver has no counterpart.                                                                                                                                                                                                          |
| `POST /api/demo/hotel_bot`                                                           | `server/routes/misc.ts:313`                                              | none                                                                                                              | **Absent.** Demo fixture endpoint.                                                                                                                                                                                                                                                                                                                                              |
| `/api/copilotkit` (prompt-studio chat runtime)                                       | `api-router.ts:125`                                                      | `app-rest.packaged-families.ts:835` (`report.absent("copilotkit")`)                                               | **Absent, deliberately and reported at boot, on both halves.** The browser asks `PromptHostPort.playgroundChat()`, which this application answers `{ available: false }`, and renders the unavailable state instead of mounting the chat; the component that sets `runtimeUrl="/api/copilotkit"` is unreachable. Bound by `specs/prompts/playground-chat-availability.feature`. |
| Usage/plan enforcement on ingest                                                     | main's `traceUsageGuard` refused over-plan ingest                        | `api-packaged-rest.composition.ts` `traceUsageGuard` is `async (_c, next) => next()`                              | **Partially built.** Deliberate degradation, reported at boot, but it is a real behaviour change for SaaS.                                                                                                                                                                                                                                                                      |

### Everything else matches

The other ~75 of main's 85 registrations have a counterpart at the same path:
agents (v1 + legacy alias), agent-cache, analytics (+ legacy), analytics-sql,
query, coding-agent (+ v1), dashboards, graphs, dataset (+ generate),
evaluators, events/track_event, experiments (+ v3 + v3 legacy alias +
experiment/init), files, export/scenario-runs, gateway openapi/platform/spend/
internal, api-discovery, root-discovery, governance, groups, me, model-defaults,
model-providers, monitors, api-keys, organization (singular), organizations
(plural provisioning), projects, role-bindings, roles, scim-tokens, prompts,
scenario-events, scenarios, secrets, simulation-runs, suites, run-plans,
test-suites, teams, webhooks, traces, triggers (+ trigger/slack), user-avatar,
workflows (CRUD + studio + run + optimization), otel, otel path aliases, rum,
playground, langy (turns/ui-actions/internal/relay), elevenlabs, github,
scenario-generate, scim, auth0-scim intake, bug-reports, annotations,
auth/cli, collector, ingest, evaluations-legacy (+ guardrails), health,
dspy/log_steps, mcp/authorize, image-proxy, ops, sse, trpc, unsubscribe.

The frozen document `apps/api/src/features/discovery/openapi-document.json`
publishes 190 paths across 45 first-segment families; every one of them has a
mount on the branch except `/api/optimization/{workflowId}/{versionId}`'s
sibling evaluate route noted above.

---

## 2. tRPC

**No main namespace is missing and no procedure count shrank.** 93 namespaces on
main (`platform/app/src/server/api/root.ts:200`), 93 on the branch — 91 in the
feature record (`apps/api/src/app-trpc/app-trpc.features.ts:634-912`) plus
`agents` and `secrets`, which are mounted directly on the application root
(`apps/api/src/api.application.ts:508-512`).

Two namespaces grew: `ops` 91 → 92, `featureFlag` 3 → 7. Four look smaller only
because the branch splits or merges files, and all four total out identically:
`user` 26 = 23 (`user.api.ts`) + 3 (enterprise `personal-dashboard.api.ts:99,132,151`,
merged at features.ts:880); `analytics` 13 = 4 + 3 + 6 across three files;
`governance` 6 = 5 + 1 (`governance-home.mount.ts`); `suites` 15 = 11 + 4.

### The one structural risk

| Item                                                   | main file:line                                                              | branch file:line                                                                                                                                                                                               | Status                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 91 packaged namespaces, as one all-or-nothing unit | statically imported into `appRouter`, `root.ts:97-192` — always on the wire | `api-trpc-features.composition.ts:194-203` (`tryCompose` returns `undefined` without database or authz) and `:340-346` (`composeApiTrpcCollaborators` returns `undefined` if **any** of ten halves is missing) | **Wired, but fails closed as a block.** When it returns `undefined`, `api-production.composition.ts:1002` omits `features` and `NoApiTrpcFeatures.build()` returns `{}` (`api.application.ts:413-415`). The wire surface becomes `agents.*` and `secrets.*` only. |

The ten halves each have their own precondition
(`api-production.composition.ts:2480, 2528, 2601, 2659, 2706, 2762, 2877, 3036,
3108, 3445`). The sharpest one: `composeApiSecretEncryption`
(`api-production.composition.ts:3611-3619`) returns `undefined` when
`config.storedSecretEncryptionKey` is unset, which drops `composeAgentGroup`
(`:2762`), which drops the collaborators, which drops all 91 namespaces. On main
a missing stored-secret key left every router on the wire. This is not a gap in
the sense of missing code — it is a boot-configuration cliff that main did not
have.

`currency` and `subscription` are mounted as empty routers when `saasBilling` is
false (`enterprise-billing-trpc.mount.ts:59-65`), which is what main did via
`env.IS_SAAS` shims. Parity, not a regression.

---

## 3. Worker

Main's worker surface is `platform/app/src/server/workers/startWorkers.ts`
(7 boot stages) plus the worker-only loops in the app-layer `presets.ts`, plus
25 event-sourcing pipelines from `pipelineRegistry.registerAll()`.

**All 25 pipelines are ported and installed** — 24 feature installers ordered at
`apps/worker/src/app/worker-production.composition.ts:1974-2003`, asserted
against `apps/worker/src/features/catalogue.json`. Every one rides the single
shared `event-sourcing/jobs` queue, as on main.

The gaps are all in the non-pipeline surface.

| Worker / loop                                      | main file:line                           | branch file:line                                                                                                        | Status                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scenario execution pool + `startScenarioProcessor` | `startWorkers.ts:67-93`, called `:526`   | `worker-scenario-processing.composition.ts:141` (`absence.withoutExecutionPool()`), `:251` (`submit()` rejects by name) | **Absent.** The `simulationRunExecution` process manager is installed, but its `execute` intent throws. No process in the repo composes `ScenarioExecutionPoolService`. Simulation runs never execute. |
| ClickHouse storage-stats collection                | `startWorkers.ts:49-61`, called `:525`   | none                                                                                                                    | **Absent.** Ops storage metrics have no producer.                                                                                                                                                      |
| NLP fetch dispatcher teardown                      | `startWorkers.ts:100-105`, called `:527` | none                                                                                                                    | **Absent.** Moot only while the pool above is absent.                                                                                                                                                  |
| Enqueue-rate anomaly worker                        | `startWorkers.ts:109-120`, called `:531` | `packages/features/ops/server/src/adapters/ops-worker.adapter.ts:57`                                                    | **Built-but-not-installed.** Only re-exported.                                                                                                                                                         |
| Self-hosted usage-stats telemetry worker           | `startWorkers.ts:153-162`, called `:533` | `packages/features/ops/server/src/adapters/ops-worker.adapter.ts:77`                                                    | **Built-but-not-installed.** Pairs with the absent `/api/track_usage` receiver.                                                                                                                        |
| Realtime voice-session poller                      | `startWorkers.ts:140-149`, called `:534` | `packages/features/gateway/server/src/services/gateway-realtime-session-reconciliation.service.ts:84,138`               | **Built-but-not-installed.** Only caller is its own unit test. Brokered voice spend now depends entirely on the post-call webhook arriving.                                                            |
| System migrations runner (ADR-092 stage B)         | `presets.ts:1131-1133`                   | `packages/system-migrations/src/runner.service.ts`                                                                      | **Built-but-not-installed.** No production caller repo-wide. In-place authz migrations never converge.                                                                                                 |
| Redis readiness + DB probe fail-fast at boot       | `startWorkers.ts:36-46,516-517`          | not reproduced                                                                                                          | **Absent** (minor).                                                                                                                                                                                    |

Installed and matching: the calendar `SchedulerService` loop, the
`REPORT_SCHEDULER_TARGET_TYPE` handler and reconcile sweep
(`worker-report-schedule.composition.ts:328-358`), governance spend-spike
anomaly worker (`worker-governance-anomaly.composition.ts:121-150`),
topic-clustering boot seeds (`topic-worker-feature.installer.ts:70`), and the
metrics/`/healthz` liveness thread (`worker-metrics.server.ts:133-213`) — though
`readMetrics` now returns an empty body (`worker-standalone.composition.ts:161-164`),
prom-client having been replaced by OTLP.

---

## 4. UI

**No route regressions.** Main's authoritative route table is
`platform/app/src/routes.tsx` (react-router `createBrowserRouter`, not the
pages directory); the branch's is `apps/ui/src/model/ui-route-table.ts:128`.
Both hold exactly the same 163 paths — set difference in both directions is
empty. Every `page:` key resolves against a loader registry, and every registry
is spread into `apps/ui/src/features/installed-ui-features.ts:51-91`. There is
no "feature exists but is not installed" case.

Fourteen addresses changed from a page to a table-level redirect. All still
answer; what they render changed:

| Route                                                                             | main                             | branch                                                     | Note                                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/ops/queues`                                                                     | `routes.tsx:644` (page)          | `ui-route-table.ts:789` → `/ops`                           | **The one place real page content is gone** — no `pages/ops/queues` loader exists.              |
| `/ops/scheduler`                                                                  | `routes.tsx:646`                 | `:796` → `/ops/event-sourcing/schedules`                   | Content superseded.                                                                             |
| `/ops/projections`                                                                | `routes.tsx:682`                 | `:837` → `/ops/event-sourcing/projections`                 | `:runId` detail survives (`:849`).                                                              |
| `/ops/backoffice`                                                                 | `routes.tsx:690`                 | `:855` → `/ops/backoffice/users`                           | Index-to-first-tab.                                                                             |
| `/admin/*`                                                                        | `routes.tsx:95`                  | `:159` → `/ops/backoffice` with a segment map (`:163-172`) | Equivalent.                                                                                     |
| `/gateway`                                                                        | `routes.tsx:339`                 | `:431` → `/gateway/virtual-keys`                           | Main's page body was a `router.replace`.                                                        |
| `/:project/evaluations`, `/evaluations/new`, `/new/choose`, `/evaluations/wizard` | `routes.tsx:455,463,467,471`     | `:541,554,562,577`                                         | Redirects to experiments / online-evaluations.                                                  |
| `/:project/traces/:trace`, `/:project/messages{,/:trace,/:openTab,/:span}`        | `routes.tsx:491,498,502,506,512` | `:603,619,623,635,646`                                     | Now open the trace drawer. Main's were already redirect-only components. `:openTab` is dropped. |

One thing a path comparison cannot see: the branch moved authorization from
in-page guards to route-level `permission:`/`flags:` policy (e.g.
`apps/ui/src/features/gateway/ui/sections/gateway-routes.tsx:28-48`). Drift
there would present as a blank or denied page, not a 404.

---

## 5. Tasks and scripts

Main's registry (`platform/app/scripts/generate-task-registry.mjs`, 13 default-exporting
modules) is replaced by `apps/tasks/src/tasks.catalogue.ts:40-59` and
`apps/api/src/tasks/tasks.entrypoint.ts:22-24`. Twelve of the thirteen are ported
under new names.

| Item                                                                                                                | main file:line                                             | branch                                                                                       | Status                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `cleanupOldLambdas`                                                                                                 | `src/tasks/cleanupOldLambdas.ts:173`                       | none                                                                                         | **Absent.** The only main task with no counterpart. Pairs with the absent `/api/cron/old_lambdas_cleanup`. |
| `runTopicClustering`                                                                                                | `src/tasks/runTopicClustering.ts:5`                        | `packages/features/topic/server/src/tasks/topic-clustering-run.task.ts:30` — in no catalogue | **Built-but-unregistered.** Cannot be run.                                                                 |
| `lwql:provision` / `start:prepare:db`                                                                               | `package.json:39,66`                                       | task exists (`tasks.catalogue.ts:44`) but no script or boot chain calls it                   | **Built-but-unwired.** LangWatchQL provisioning is no longer part of any deploy path.                      |
| `check:openapi-completeness`                                                                                        | `package.json:22`, `scripts/check-openapi-completeness.ts` | none (`openapi-check.task.ts:24` only checks frozen-doc drift)                               | **Absent.** A build gate on main.                                                                          |
| `task:migrate-object-storage`'s `--max-old-space-size=4096`                                                         | `package.json:55`                                          | no alias                                                                                     | **Absent.** The object-storage migration will run on the default heap.                                     |
| `ops/reap-stranded-group-keys.sh`, `ops/purge-process-manager-tables.mjs`                                           | `scripts/ops/`                                             | none                                                                                         | **Absent.** Redis/PM maintenance tooling.                                                                  |
| `migrations/backfill-vk-config-to-rp.ts`, `backfill-agent-audit-log-ids.ts`                                         | `scripts/`                                                 | none                                                                                         | **Absent.** One-off backfills.                                                                             |
| `report-duplicate-subscriptions.ts`, `report-routing-policy-dead-fields.ts`, `report-trace-destination-backfill.ts` | `scripts/`                                                 | none                                                                                         | **Absent.** Production diagnosis scripts.                                                                  |
| `generate-license.ts` + `localDevLicense.ts`                                                                        | `scripts/`                                                 | none (the licensing _feature_ survives)                                                      | **Absent.** No license minting.                                                                            |
| `update-azure-deployment.ts`, `update-matrix-provider-keys.ts`                                                      | `scripts/`                                                 | none                                                                                         | **Absent.** Provider-key ops.                                                                              |
| `seed-lib/*` and every `seed-*.ts` except the Prisma seed and the demo platform seed                                | `scripts/`                                                 | only `packages/prisma-client/prisma/seed.ts`, `seed-demo-platform.ts`                        | **Absent.** Load, retention and perf seeding capability is gone.                                           |
| `smoke-boot.mjs`, `build-server.mjs`, `bundle-optional-externals.mjs`                                               | `scripts/`                                                 | none                                                                                         | **Absent.** Boot smoke check and the production bundle path (the branch runs tsx entrypoints).             |
| `generate:vega-validator`                                                                                           | `package.json:76`                                          | script file moved to `packages/features/analytics/contract/scripts/` — no package.json entry | **Built-but-unwired.**                                                                                     |
| The whole `scripts/dogfood/**` tree, `qa-*` probes, `dev:clean`, `tsc-watch`, `licenses`, `test:e2e:codegen`        | `platform/app/`                                            | none                                                                                         | **Absent** (dev conveniences).                                                                             |

Branch-only additions with no main counterpart: `prisma-migrate`,
`stripe-prices-sync`, `tiered-free-to-seat-event`, `user-data-erase`,
`model-registry-sync`, `openapi-check`.

---

## Ranked by customer impact

1. **Sign-in** — `/api/auth/*` was unmounted and is fixed only in the
   uncommitted working tree. Until that commit lands, nobody can authenticate.
2. **Evaluation and simulation runs** — the scenario execution pool is absent
   outright; the process manager's `execute` intent refuses by name, so
   simulation runs enqueue and never execute. `POST /api/workflows/:id/evaluate`
   refuses for the same class of reason.
3. **Billing** — `/api/webhooks/stripe` is built and unmounted, so Stripe
   subscription lifecycle events are dropped. The realtime voice-session poller
   is built and uninstalled, so brokered voice spend settles only if the
   post-call webhook arrives.
4. **Ingestion** — ingestion itself is fully mounted, but plan enforcement on it
   is a no-op (`traceUsageGuard`), and `/api/export/traces` (bulk export back
   out) is built and unmounted.
5. **Operations and support** — `/api/admin/*` (impersonation, backoffice CRUD)
   unmounted; `/ops/queues` page content gone; system-migrations runner,
   enqueue-rate anomaly worker, storage-stats collection and usage-stats
   telemetry all uninstalled; `lwql:provision` unwired; the ops/backfill/report
   script suite absent.
6. **Prompt Studio chat** — `/api/copilotkit` absent by design on both halves;
   the browser renders the unavailable state and never posts.
7. **The `/api/cron/*` family, `/api/track_usage`, demo fixtures and the seeding
   suite** — absent, low customer-facing impact.

---

## Verdict

The branch serves nearly all of main's surface, and the two surfaces most likely
to have rotted did not: tRPC is at full parity — 93 of 93 namespaces, no
procedure count down, two up — and the UI route table is byte-for-byte the same
163 paths with every loader installed. REST carries about 75 of main's 85
registrations at the same prefixes, with the frozen 190-path document fully
covered. What is missing is concentrated and almost entirely wiring rather than
code: nine REST families and workers are built and sitting in packages with no
caller (Better Auth — fixed in the uncommitted tree during this audit — the
Stripe webhook, `/api/admin/*`, `/api/export/traces`, the enqueue-rate anomaly
worker, the usage-stats telemetry worker, the realtime voice-session poller, the
system-migrations runner, and the topic-clustering task), and a further handful
are absent outright (the scenario execution pool, storage-stats collection,
`/api/cron/*`, `/api/track_usage`, `cleanupOldLambdas`, and most of the seeding
and ops-script suite). Two things are refusals by name rather than absences —
workflow evaluation and simulation execution — which means those features are
honestly broken rather than silently broken. The one novel failure mode the
branch introduces that main did not have is the tRPC collaborators being
all-or-nothing: a single missing composition half, including one caused by an
unset `storedSecretEncryptionKey`, takes all 91 packaged namespaces off the wire
at once. In blunt terms: the platform is roughly 90% re-served, the remaining
10% is mostly a day of wiring, and until the auth commit lands none of it is
reachable anyway.
