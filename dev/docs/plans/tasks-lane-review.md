# Tasks lane review — Part 1 of `tasks-launch-interface-and-saas.md`

Reviewed: the uncommitted tree on `feat/strict-feature-layout-v0` on top of 36993b361c
(`@langwatch/task`, `apps/tasks`, first task moved). Scope as briefed; other lanes'
edits (scenario spec rebinds, `apps/api/src/app-trpc`, the worker composition test
hunk about `spanCommandShardCount`, the `test:unit`/`test:integration` split and
testcontainers devDeps in `analytics/server/package.json`) were not judged.

## Verdict: approve with fixes

The shape is right: one launcher, one catalogue, tasks owned by features, migrations
beside the client that runs them, every `task:` caller repointed, `tools/migrationorder`
demotes the old root to previous+forbidden the way the last move did. Tests travel with
the tasks and pass in their new packages. `go test ./tools/migrationorder/...` passes.

Three callers are broken by the move and must be fixed **before this commits**:
the container CMD's first step cannot find the Prisma CLI, the `npx @langwatch/server`
install never installs `apps/tasks`, and the dev compose runs `apps/tasks` against a
bind-mounted host `node_modules`. All three are one-line-shaped. Everything after
them is quality.

```
                what runs the task                      does it reach apps/tasks?
  ┌──────────────────────────────────────┐   ┌──────────────────────────────────────────┐
  │ Dockerfile CMD                       │   │ install --filter @langwatch/tasks...  ✓  │
  │   cd /app/apps/tasks &&              │   │ COPY apps/tasks                       ✓  │
  │   pnpm -s task prisma-migrate        │──▶│ `pnpm exec prisma` from apps/tasks    ✗  │  fix 1
  │   pnpm -s task clickhouse-migrate    │   │   (prisma is a dep of apps/api only)      │
  │   pnpm -s task lwql-provision        │   │                                            │
  ├──────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │ npx @langwatch/server                │   │ ensureLangwatchDeps filters             ✗  │  fix 2
  │   migrate.ts → locateTasksDir()      │──▶│   APP_PACKAGE_NAMES = api, worker, ui      │
  │   pnpm run task prisma-migrate       │   │   → apps/tasks has no node_modules         │
  ├──────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │ dev/compose.dev.yml api service      │   │ init install filters                    ✗  │  fix 3
  │   (cd /apps/tasks && pnpm run task   │──▶│ no tasks_modules volume → host darwin      │
  │    clickhouse-migrate)               │   │   binaries under /apps/tasks/node_modules  │
  ├──────────────────────────────────────┤   ├──────────────────────────────────────────┤
  │ CI workflows (4), Makefile, root     │   │ full-workspace installs                 ✓  │
  │ package.json                         │──▶│ gateway-matrix adds the filter          ✓  │
  └──────────────────────────────────────┘   └──────────────────────────────────────────┘
```

Evidence for fix 1, run in this tree:

```
$ cd apps/tasks && pnpm exec prisma --version
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "prisma" not found
```

`apps/tasks/node_modules/.bin` holds `tsx`, `tsc`, `vitest`… and no `prisma`; the only
`prisma` bins are `apps/api/node_modules/.bin/prisma` and
`packages/prisma-client/node_modules/.bin/prisma` (a devDependency there, absent
after `--prod`). `PrismaMigrateTask` spawns `pnpm exec prisma` with the process cwd,
which the CMD sets to `/app/apps/tasks`.

## Answers to the five judgement questions

### 1. The four worker tasks left "composed entrypoint absent"

They are **named absences that have gone stale, edging into stubs**. Each has a real
`Task` subclass with a `static create(deps)` that nothing constructs, and a comment
naming why. The comments were written when the classes lived in `apps/worker` and
name the *worker's* missing collaborators. Three of the four reasons no longer hold
in `apps/tasks`, which composes Prisma, ClickHouse and Redis:

| task | stated blocker | true today? | smallest wiring |
| --- | --- | --- | --- |
| `object-storage-migrate` (stored-object) | "this process composes no stored-object ClickHouse connection. Only the API does" | No — `TasksHost.clickhouse` exists. The API's `ApiStoredObjectsClickHouse` (`apps/api/src/app/api-trpc-collaborators.product-infra.composition.ts:482-501`) is 20 lines over a resolver. | A `StoredObjectsClickHousePort` over `host.requireClickhouse()`, `AwsClientProcessRuntime.create({ outboundProxy })` (`packages/aws-client/src/process-runtime.ts:18`), `MigrationCutoverRedisAudit` over `host.requireRedis()`, then `ObjectStorageMigrateTask.create({ migration: () => createMigrationTask(...) })`. ~40 lines in the catalogue plus moving `createMigrationInventory` into an adapter (fix 9). Needs no `host.objectStorage`: the migration builds its own S3/Azure drivers from `OBJECT_STORAGE_MIGRATION_*`. |
| `stalled-runs-backfill` (scenario) | "the worker's `ScenarioExecutionService` rejects `finishUnsuccessfulRun`" | No — the API composes the real one: `ScenarioFailureHandlerService.create({ agents, simulations })` (`apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts:752`). | `SimulationStalledRunAdapter.create(clickhouse)` as the finder and `ScenarioFailureHandlerService` (needs the agent and simulation services over Prisma + the ClickHouse event store). Medium: the agent/simulation composition is the bulk; ~60 lines lifted from the API. |
| `annotation-clickhouse-backfill` (annotation) | "`bulkSyncAnnotations` is a command on the trace pipeline composed inside the worker" | Partly. The command is *handled* by the worker, but *sending* one is a queue write. | An adapter implementing `TraceAnnotationSyncPort` by enqueuing `bulkSyncAnnotations` on the trace pipeline's command queue over `host.requireRedis()`; the worker processes it. Needs the eventing pipeline's send-side factory; medium. |
| `dataset-content-backfill` (dataset) | "`DatasetStorageResolver` is built inside `worker-dataset-normalization.composition.ts`" | Yes — `WorkerDatasetStorageResolver` (`apps/worker/src/app/worker-dataset-normalization.composition.ts:133`) is app-local and needs the stored-object runtime that is the `objectStorage: never` handle. | Move `WorkerDatasetStorageResolver` into `dataset/server/src/adapters/` and give `TasksHost.objectStorage` the same `createWorkerObjectStorage` runtime. This is the one genuine absence; it is exactly the `objectStorage` handle `TaskHostPort` reserved. |

Recommendation: wire `object-storage-migrate` and `stalled-runs-backfill` in this
PR (the handles exist and the comments claiming otherwise are wrong); keep the other
two as absences but rewrite their comments to name the `apps/tasks` blocker, not the
worker's, and record all four in the plan. A `Task` subclass exported from a feature
index that no process constructs should not stay that way past this PR.

### 2. The two retirements

- **`runTopicClustering` — a feature to restore.** The subject exists:
  `packages/features/topic/server/src/intents/topic-clustering-runner.intent.ts:136`
  `TopicClusteringRunner implements TopicClusteringRunPort`, exported from the topic
  index with `ClusteringPageOutcome`, and composed by
  `apps/worker/src/app/worker-topic-clustering.composition.ts`. main's task is 30
  lines: loop `runPage({ projectId, searchAfter, runContext: { runId, page } })`
  until `nextSearchAfter` is empty. The plan's own Sequence step 1 says "port the 4
  dropped ones whose subjects exist"; `slack-alert` was ported and this one was not.
  Restore as `packages/features/topic/server/src/tasks/topic-clustering-run.task.ts`
  taking `runPage: () => TopicClusteringRunPort` and `projectId` from `args[0]`;
  register when the runner is composed (model-provider execution adapter + ClickHouse
  + Prisma — the same three the worker composition takes).
- **`cleanupOldLambdas` — a dead subject; retirement stands.** It deleted stale NLP
  Lambda function versions and their log groups. Nothing on this branch invokes
  Lambda: no `@aws-sdk/client-lambda` dependency anywhere outside `CHANGELOG.md`, and
  `LANGWATCH_NLP_LAMBDA_CONFIG` survives only as a capability flag
  (`packages/config/src/public-app-config.projection.ts:66,199`). Record it in the
  plan as retired-with-subject-gone; the orphan config leaf is a separate cleanup.

### 3. The migrations move — `tools/migrationorder` and the workflows

Correct and complete. `set.go:53-62` makes `packages/clickhouse-client/migrations`
canonical and adds `apps/api/src/tasks/clickhouse-migrate/migrations` to **both**
`PreviousDirectories` and `ForbiddenDirectories` (the lesson from the last move:
origin/main's 78 files at the old root read as merged history, not 78 new
migrations). `check_test.go` and `git_test.go` are repointed; `go test` passes.
`migration-order.yml:39` watches the new path; `pr-impact-map.yml:54` classifies it;
`langwatch.yml` semgrep includes follow; `npx-server-publish.yml:247` asserts the new
directory in the tarball; every test that reads a migration by path
(`aggregatingDimensionGuard`, `canonical-*`, `clickhouse-migrations`, `retention-ttl`,
`stored-object-helm-and-docs-shape:403`, `trace-cold-scan-detector:24`) resolves to
`packages/clickhouse-client/migrations`. `goose.migration-runner.ts:27` reads
`../../migrations` from `src/tasks/`, which is that directory.

One dead include: `langwatch.yml:159` adds `packages/clickhouse-client/migrations/**/*.sql`
under a rule whose `exclude` is `**/migrations/**` — same as before the move, harmless.

### 4. The new workspace dependencies

`packages/clickhouse-client`: `@clickhouse/client`, `@langwatch/observability`,
`@langwatch/task` — justified (the package had no `dependencies` block and now runs
the goose runner). `@langwatch/data-retention-server` is an **infrastructure package
depending on a feature server package**, for one constant (`RETENTION_MANAGED_TABLES`
via `/retention-tables`). No cycle today — that subpath imports only
`@langwatch/data-retention-contract` — but it is the wrong direction; the constant
belongs in the contract. Fix 14.

`packages/features/stored-object/server`: `dataset-contract` (`chunkKey` in the
service), `group-queue` (the audit adapter), `redis-client` + `ioredis` (the Redis
adapter), `task` — justified by the moved code. `prisma-client` exists only for
`import type { PrismaClient }` in the task and `createMigrationInventory`; it becomes
justified once that inventory is a `postgres.*.adapter.ts` (fix 9).

`analytics/server` gains `@langwatch/clickhouse-client` for `parseConnectionUrl` and
`@langwatch/task`; `model-provider/server` gains `secret-server` (the AES cipher)
and `task`; `automation/server` gains `@slack/webhook` (duplicating the worker's
transport, fix 13). `apps/tasks` gains the five feature servers it lists —
inherent to a static catalogue, with the cost noted in fix 18.

### 5. The Dockerfile CMD, public image and `npx @langwatch/server`

The CMD text matches the plan and the same words run on a laptop (verified:
`pnpm --filter @langwatch/tasks task` lists seven names; `webhook-signature-vectors`
runs in 2.9s). Both `pnpm install` stages add `--filter "@langwatch/tasks..."` and
the runtime stage copies `apps/tasks`. **But step one fails** (fix 1): `prisma` is
not a dependency of `@langwatch/tasks`. The `npx` path repoints `migrate.ts` to
`locateTasksDir()` correctly and `distribution-files.json` ships `apps/tasks/`, but
`APP_PACKAGE_NAMES` (`node-deps.ts:26-30`) still installs only api, worker and ui,
so `apps/tasks/node_modules` is never created on a customer machine and `pnpm run
task` finds no `tsx` (fix 2). `node-deps.ts:256-264` still runs `prisma generate`
from `apps/api` with `./prisma.config.ts`, which keeps working only while `apps/api`
keeps its `prisma` dependency and config — leave those in place for this PR.

## Fix list

P0 — the commit must not land without these.

1. **`apps/tasks/package.json:19-35`** — add `"prisma": "7.9.1"` to `dependencies`
   (the same pin `apps/api/package.json:161` carries, and for the same reason: the
   image installs `--prod`). `pnpm exec prisma` from `apps/tasks` currently fails
   `Command "prisma" not found`, so `CMD … pnpm -s task prisma-migrate` exits 1 and
   the container never reaches `pnpm -s run start`. Then run `pnpm install` for the
   lockfile.
2. **`apps/server/src/services/node-deps.ts:26-30`** — add `"@langwatch/tasks"` to
   `APP_PACKAGE_NAMES`. Without it `workspaceInstallArgs` never filters `apps/tasks`
   in, and `migrate.ts:57-68` runs `pnpm run task …` in a directory with no
   `node_modules`. Update the spec scenario "The install still refuses to drift from
   the lockfile" if it pins the filter list.
3. **`dev/compose.dev.yml`** — add a `tasks_modules:/apps/tasks/node_modules` volume
   to the `init` (`:171-174`) and `api` (`:297-300`) services and the top-level
   `volumes:` block (`:487-496`); add `/apps/tasks/node_modules` to the `mkdir` at
   `:181`; add `--filter '@langwatch/tasks...'` to the install at `:192`. As written,
   `:307` runs `tsx` from the host's bind-mounted `apps/tasks/node_modules` (darwin
   binaries in a linux container) or from nothing on a fresh volume.
4. **`.github/workflows/npx-server-publish.yml:243`** — the tarball assertion names
   `apps/api/prisma.config.ts`, which the migrate path no longer reads; add
   `package/app/packages/prisma-client/prisma.config.ts`, the file
   `apps/tasks/src/tasks/prisma-migrate.task.ts:29-31` resolves. (Keep the api one
   while `node-deps.ts:263` still uses it.)

P1 — correctness of the move against the rules.

5. **`packages/features/analytics/server/src/tasks/lwql-provision.task.ts:24-38`** —
   the file imports its own package by name (`from "@langwatch/analytics-server"`),
   a leftover from `apps/api`. Import `../langwatch-ql/production-provisioning` (or
   `#langwatch-ql/production-provisioning`). Line 18's `@see
   ../clickhouse-migrate/migrations/00084_…` points at a path that no longer exists;
   line 9-10 says "in `start:prepare:db`", which is not how it runs.
6. **`packages/features/annotation/server/src/tasks/annotation-clickhouse-backfill.task.ts:55,168`**
   and **`packages/features/dataset/server/src/tasks/dataset-content-backfill.task.ts:28,90`**
   — the class named `<Name>Task` does not extend `Task`; the `Task` subclass is
   `<Name>RunnerTask`. That inverts the grammar (`tasks/<name>.task.ts` exports
   `<Name>Task extends Task`). Fold: make `AnnotationClickHouseBackfillTask` and
   `DatasetContentBackfillTask` extend `Task` with `run()` calling the existing sweep,
   and delete the Runner wrappers. Update the two moved tests' imports.
7. **`annotation-clickhouse-backfill.task.ts:17-32`** — two abstract `*Port` classes
   are declared inside `tasks/`. Ports live in `ports/`: move
   `AnnotationBackfillSourcePort` and `TraceAnnotationSyncPort` to
   `ports/annotation-backfill.port.ts`.
8. **`packages/features/scenario/server/src/tasks/stalled-runs-backfill.task.ts:31-39,100-109`**,
   **`dataset-content-backfill.task.ts:21-26,79-89`**,
   **`annotation-clickhouse-backfill.task.ts:158-166`**,
   **`object-storage-migrate.task.ts:254-273,381-390`** — every "not yet registered"
   comment names the *worker's* missing collaborator, not `apps/tasks`', and two of
   them are false there (see question 1). Rewrite each to one sentence naming the
   `apps/tasks` handle that is missing, or wire the task (recommended for
   `object-storage-migrate` and `stalled-runs-backfill`), and move the reasoning to
   the plan.
9. **`packages/features/stored-object/server/src/tasks/object-storage-migrate.task.ts:26,283-327`**
   — the task imports `StoredObjectsRepository` and `createMigrationInventory` calls
   `repository.findLiveRowsByProjectPage` directly. A task calls services and
   adapters, never a repository. Move `createMigrationInventory` to
   `adapters/postgres.object-storage-migration-inventory.adapter.ts` (it also names
   `PrismaClient`, which is what that filename is for) and hand the task an
   `MigrationInventory`.
10. **`object-storage-migrate.task.ts:1-15`** — the usage block still says
    `pnpm run task migrateObjectStorage plan`; the command is
    `pnpm --filter @langwatch/tasks task object-storage-migrate plan`. Lines 254-273
    are an orphaned JSDoc block (a second `/** … */` immediately follows it) written
    for the worker ("this process composes no …"); delete it.
11. **`packages/egress/src/webhook/signature-vectors.ts:24,374`** — the generated-file
    note still says `pnpm --filter @langwatch/worker task:webhook-signature-vectors`,
    a script that no longer exists; repoint to
    `pnpm --filter @langwatch/tasks task webhook-signature-vectors` and rerun the task
    so `specs/webhooks/signature-vectors.json:2` carries the new note.
12. **Restore `runTopicClustering`** as
    `packages/features/topic/server/src/tasks/topic-clustering-run.task.ts`
    (`TopicClusteringRunTask`, `projectId` from `args[0]`, the `runPage` loop from
    main's 30 lines over `TopicClusteringRunPort`). Register it when the runner is
    composed in `apps/tasks`, or record it in the plan with the `apps/tasks` blocker
    named. Record `cleanupOldLambdas` in the plan as retired because the subject is
    gone.
13. **`packages/features/automation/server/src/tasks/slack-alert.task.ts:1-16,33-37`**
    — duplicates the `IncomingWebhook` transport already in
    `apps/worker/src/features/automation/slack-webhook.client.adapter.ts`. Move that
    client adapter into `automation/server/src/adapters/` and have both the worker
    composition and this task use it; then `@slack/webhook` is a dependency for one
    reason. Line 59 hardcodes `baseHost: "https://app.langwatch.ai"`; take it from
    `args[1]` or the process's base URL so the smoke test links to the deployment it
    runs against.
14. **`packages/clickhouse-client/package.json:24`** and
    **`src/tasks/ttl.reconciler.ts:4`** — move `RETENTION_MANAGED_TABLES` (and
    `PRODUCTION_STORAGE_METER_TABLES`, same file) into
    `@langwatch/data-retention-contract` and depend on the contract. An
    infrastructure package that every feature imports should not depend on a feature
    server, even acyclically.

P2 — clean-Go readability and shape.

15. **`packages/task/src/task-host.port.ts:17-28`** — the added comment is 12 lines
    of design rationale and future work. Keep two lines ("the type parameters default
    to `unknown` so a plugin can implement `Task` without the generated Prisma
    client"); the rest belongs in the plan's Part 2 section.
16. **`apps/tasks/src/platform/tasks-host.composition.ts:64-84`** — every task run,
    including `prisma-migrate` at the top of the container boot, opens Prisma,
    ClickHouse and Redis connections that no registered task reads
    (`clickhouse-migrate` and `lwql-provision` read `process.env.CLICKHOUSE_URL`
    themselves). Compose each handle on first `require*()` instead of at `create()`,
    or accept and say so in the class comment. Either way `objectStorage: never`
    at `:38,45` is the named absence that fix 8's dataset task needs filled.
17. **`packages/clickhouse-client/src/tasks/clickhouse-migrate.task.ts:37,162`** —
    `ClickHouseMigrationTask` (not a `Task`) and `ClickHouseMigrateTask` (a `Task`)
    in one file, differing by two letters. Fold the endpoint walk into
    `ClickHouseMigrateTask` and drop `runClickHouseMigrationTask` from the index
    (`src/index.ts:150`); nothing outside the package calls it. Pass the source
    explicitly (`create({ source: process.env })`) rather than reading ambient env in
    `run()`.
18. **Index surfaces** — `stored-object/server/src/index.ts:+378-417` exports ten
    task-internal helpers and four adapter/service families; `annotation` exports
    the ports and the inner sweep; `model-provider` exports the two `run*` walks;
    `analytics` exports `runLwqlProvisioningTask` and `LwqlProvisioningDatabase`.
    The catalogue needs only the `Task` classes (and
    `modelProviderCredentialCipherFromEnv`); the tests import the files directly.
    Export the classes and nothing else, so the index does not become a second
    public API for one-shot programs.
19. **`packages/features/model-provider/server/src/tasks/model-provider-migrate.task.ts`**
    — two `Task` classes in one file, neither named `ModelProviderMigrateTask`. Split
    into `model-provider-custom-models-migrate.task.ts` and
    `model-provider-credentials-migrate.task.ts`, with the shared row walk staying in
    `services/model-provider-legacy-migration.service.ts` where the per-row logic
    already lives.
20. **`apps/tasks/src/__tests__/tasks-entrypoint.integration.test.ts:31`** — the
    30s budget covers two cold spawns of a process that now imports five feature
    servers; it passed in 18.7s idle and timed out at 30s while other suites ran.
    Raise to 60s or spawn once and assert both invocations through `--filter` only.
21. **`infra/docker/Dockerfile:78-81`** — the comment says "the goose runner, TTL
    reconciler and openapi document tasks are the only ones that still live in
    apps/api"; the goose runner and TTL reconciler are in
    `packages/clickhouse-client/src/tasks/`. Only the two openapi tasks remain.
22. **`apps/tasks/package.json:14`** — `task:prisma-migrate` is a second spelling of
    `task prisma-migrate`; no caller uses it (Dockerfile, root `package.json`,
    `migrate.ts`, workflows all use the launcher form). Delete it.
23. **`apps/tasks/src/tasks.catalogue.ts:21-24`** — "see that plan and the
    migration's own report for what remains" names no report. List the four
    unregistered task names and the plan section that holds their reasons.
24. **`dev/docs/plans/tasks-launch-interface-and-saas.md`** — update Part 1 to what
    landed: seven registered tasks, four moved-but-unregistered with the
    `apps/tasks` blocker each, `slack-alert` restored, `topic-clustering-run`
    pending, `cleanupOldLambdas` retired with the subject, and the `prisma`
    dependency decision from fix 1.

## What was verified

- `pnpm --filter @langwatch/tasks task` boots, lists seven names, exits 1.
- `pnpm --filter @langwatch/tasks task webhook-signature-vectors` runs end to end (2.9s).
- `pnpm --filter @langwatch/task test` 9/9; `@langwatch/clickhouse-client test:unit`
  316/316 across 24 files at the new migration path; `@langwatch/tasks test` 1/1
  (18.7s, see fix 20).
- Task tests in `analytics-server`, `model-provider-server`, `annotation-server`,
  `dataset-server`, `scenario-server`, `automation-server` pass; `stored-object-server`
  adapter, service-integration and helm-shape tests pass (80).
- `go test ./tools/migrationorder/...` passes.
- `architecture-lint` `prisma-boundaries` and `feature-package-boundaries` suites pass
  (46) against this tree.
- `cd apps/tasks && pnpm exec prisma --version` fails: fix 1 is real, not inferred.
- No `task:` script caller remains outside comments and plan prose; the two prose
  leftovers are fix 11 and `sdks/python/Makefile:104` /
  `apps/api/src/features/discovery/openapi-document.ts:6`, which predate this lane.

## Deviations

Every P0 fix (1-4) and every P1 fix (5-14) landed as written, with two
exceptions below. P2 fixes 15, 17, 18 (partial), 19-23 landed; fix 16 was
skipped.

- **Fix 8 / stalled-runs-backfill and topic-clustering-run — not wired.**
  The task instruction asked to wire `object-storage-migrate` and
  `stalled-runs-backfill` into `apps/tasks`. `object-storage-migrate` is
  wired (`apps/tasks/src/platform/object-storage-migrate.composition.ts`),
  matching the review's "smallest wiring" shape almost exactly:
  `StoredObjectsClickHousePort` over `host.requireClickhouse()`,
  `AwsClientProcessRuntime.create({ outboundProxy })`,
  `MigrationCutoverRedisAudit` over the process's own Redis config, and
  `ObjectStorageMigrateTask.create({ migration: () => createMigrationTask(...) })`
  (as a factory, deferred to `run()`).

  `stalled-runs-backfill` is not wired. Composing `ScenarioFailureHandlerService`
  needs a real `SimulationService` (`SimulationClickHouseAdapter.create`) whose
  `execution: SimulationExecutionPort` dispatches `finishRun` through the
  simulation-processing pipeline's PRODUCER — the same
  `createSimulationProcessingProducerPipeline` the API registers on its
  `EventSourcing` instance (`apps/api/src/app/api-agent-pipelines.composition.ts`).
  That producer is built over `ApiEventingInfrastructure`
  (`apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts`),
  which itself needs a Group Queue's `GroupQueueDependencies` — infrastructure
  `apps/tasks`' `TasksHost` does not expose today (it holds a raw
  `RedisConnection`, not a Group Queue). Building that chain from scratch —
  Group Queue dependencies, producer-only Eventing registration, the
  simulation pipeline's producer variant, then `AgentService` and
  `SimulationService` on top — is materially more than the review's own
  "~60 lines lifted from the API" estimate once `apps/tasks` composes none of
  the queue layer that estimate assumed. I judged landing that chain without
  integration coverage against a real Redis too large a risk for this pass,
  and left the task's existing "not yet registered" comment as-is (it is
  still accurate).

  `topic-clustering-run` was restored (fix 12's file-restoration is done and
  registered nowhere) but is blocked on the identical Eventing-producer gap:
  `TopicClusteringRunnerDeps` needs `TopicClusteringCommandsPort` and
  `TraceTopicAssignmentPort`, both dispatched through the Topic and Trace
  processing pipelines' producer side. The review's text ("register when the
  runner is composed — model-provider execution adapter + ClickHouse + Prisma,
  the same three the worker composition takes") undercounts this: the worker
  reaches `TopicClusteringRunner` through
  `apps/worker/src/features/topic/topic-worker-feature.installer.ts`, a
  pipeline-installer wired to the worker's own Eventing consumer, not a plain
  three-handle composition. Both tasks are named, with their true blocker, in
  `apps/tasks/src/tasks.catalogue.ts`'s comment and in the plan doc's "What
  landed" section.

- **Fix 16 / lazy handle composition — skipped.** `TasksHost.create()` still
  opens Prisma, ClickHouse and Redis eagerly whenever their URLs are
  configured, rather than on a task's first `require*()` call. This is a
  structural change to `TaskHostPort`'s lifecycle contract (getters becoming
  lazy, `close()` needing to track what was actually opened) touching every
  task's assumptions about when a handle exists, and P2 priority did not
  justify the risk of destabilizing it without dedicated lifecycle tests in
  this pass. Left as-is; `objectStorage: never` stays the one absence
  `dataset-content-backfill` needs filled, unchanged from the review's note.

- **Fix 18 / index surfaces — applied to annotation, dataset, analytics and
  model-provider; partial on stored-object.** The stored-object index still
  exports `MigrationBlockedError`, `createMigrationStorageEndpoint`, every
  `Migration*` type from `object-storage-migration.service.ts`,
  `resolveMigrationS3Region`, `auditGroupQueuesForStorageMigration` and
  `QueueAuditRedis`, beyond the `ObjectStorageMigrateTask` class the fix asked
  the index to narrow to. Wiring the task in this pass (fix 8) turned most of
  the previously "task-internal, test-only" exports into real composition-root
  imports (`apps/tasks/src/platform/object-storage-migrate.composition.ts`
  now imports `createMigrationTask`, `createMigrationInventory`,
  `MigrationS3StorageDriver`, `MigrationCutoverRedisAudit`,
  `StoredObjectsRepository`, `StoredObjectsClickHousePort`, and
  `auditQueuesForCutover` directly), so trimming those specifically would
  break the composition this same pass added. The remaining untrimmed names
  are genuinely test-only or unused outside the package and are left for a
  follow-up pass to audit individually rather than cut under this review's
  time budget.

- **Fix 8 follow-up (2026-09-03) — `stalled-runs-backfill` is now wired.**
  A later pass composed a minimal producer-only Eventing host in
  `apps/tasks` (`apps/tasks/src/platform/tasks-eventing.composition.ts`,
  over the same Redis the process's other handles use) and registered
  `stalled-runs-backfill`
  (`apps/tasks/src/platform/stalled-runs-backfill.composition.ts`), reusing
  `createSimulationProcessingProducerPipeline` — the exact "smallest wiring"
  path this review named. `StalledRunsBackfillTask.create` changed shape from
  two eager values to two deferred factories (`finder: () => StalledRunFinder`,
  `execution: () => ScenarioExecutionService`), matching
  `TopicClusteringRunTask`'s existing `runPage` factory: registering the
  Eventing pipeline needs Redis, and a value (rather than a factory) would
  force that at catalogue-construction time, failing every OTHER task's boot
  in an environment with no `REDIS_URL`. `topic-clustering-run` stays
  unregistered — it needs the full `TopicClusteringRunner` (ClickHouse reads,
  a model-provider gateway, langevals, a Prisma repository, the legacy-import
  seed guard) plus TWO separate producer registrations
  (`topic_clustering_processing` for `TopicClusteringCommandsPort`, and the
  trace pipeline for `TraceTopicAssignmentPort`), neither of which has a
  ready-made producer factory the way `simulation_processing` does. See the
  task's own comment
  (`packages/features/topic/server/src/tasks/topic-clustering-run.task.ts`)
  and `apps/tasks/src/tasks.catalogue.ts` for the named absence.

## Fix 16 plan: lazy handle composition (written, not implemented)

Fix 16 asked `TasksHost` to compose each infrastructure handle on a task's
first `require*()` call instead of at `TasksHost.create()`, so
`prisma-migrate` — the container CMD's first step — does not also open a
ClickHouse client and a Redis connection it never reads. The review skipped
it as a P2 risk; this section is the plan for actually doing it, written so
a later pass does not have to re-derive the shape.

### Why it is not a one-line change

`TasksHost` today (`apps/tasks/src/platform/tasks-host.composition.ts:40-62`)
opens all three handles inside `static create()` and stores each as a plain
`readonly` field set once in the constructor; `close()` (`:86-94`) decides
what to shut down by checking those same fields for `undefined`. Laziness
changes three things at once, not one:

1. **The fields become getters.** `TaskHostPort`'s abstract contract
   (`packages/task/src/task-host.port.ts:23-26`) declares
   `abstract readonly prisma: Prisma | undefined` etc. A subclass may satisfy
   an abstract `readonly` member with a `get prisma()` accessor — TypeScript
   treats both as the same read-only shape — so this is not a `TaskHostPort`
   change, only a `TasksHost` one.
2. **Each getter must memoize.** A task can call `requireClickhouse()` more
   than once in one run (`stalled-runs-backfill`'s `finder` and `execution`
   factories both reach for ClickHouse independently in this pass's own
   wiring). A naive getter that reconnects on every access would open a
   second client, a second connection pool, and — for Prisma specifically —
   burn a second `PrismaTenancyGuardService` wrap per call. The getter must
   open at most once and return the same instance on every later call.
3. **`close()` must track what was actually OPENED, not what was
   CONFIGURED.** Today `close()`'s `this.clickhouse ? ... : Promise.resolve()`
   check is sound because "configured" and "opened" are the same fact — every
   configured handle is opened at `create()`. Once opening is deferred, a
   task that only ever called `requireRedis()` must not have `close()` reach
   for `this.clickhouse` (a getter call), because reading the getter to check
   its presence WOULD open it — turning shutdown into the last thing that
   creates a connection just to immediately tear it down. `close()` needs its
   own three booleans (or three nullable private fields checked directly,
   never through the public getter) recording whether each handle was ever
   actually constructed.

None of this touches `TaskHostPort`, `TasksConfig`, or any task — it is
entirely inside `TasksHost`'s own body, plus the four call sites
(`buildStalledRunsBackfillTask`, `buildObjectStorageMigrateTask`,
`LwqlProvisionTask`, the two `ModelProvider*MigrateTask`s) that already call
`require*()` through deferred factories and therefore do not change at all —
that is the whole reason fix 16 is safe to defer instead of urgent: every
consumer already goes through `require*()`, never the raw field, so the
laziness is invisible to them by construction.

### The target shape

```ts
export class TasksHost extends TaskHostPort<TasksConfig, PrismaClient, ClickHouseClient, RedisConnection, never> {
  private _prismaConnection: PrismaConnection | undefined | "unresolved" = "unresolved";
  private _clickhouse: ClickHouseClient | undefined | "unresolved" = "unresolved";
  private _redis: RedisConnection | undefined | "unresolved" = "unresolved";

  private constructor(readonly config: TasksConfig) { super(); }

  static create(config: TasksConfig): TasksHost {
    return new TasksHost(config); // opens nothing
  }

  get prisma(): PrismaClient | undefined {
    return this.resolvePrisma()?.client;
  }

  private resolvePrisma(): PrismaConnection | undefined {
    if (this._prismaConnection === "unresolved") {
      const databaseUrl = this.config.databaseUrl?.trim();
      this._prismaConnection = databaseUrl
        ? PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(...)
        : loggedAbsence("prisma");
    }
    return this._prismaConnection;
  }

  get clickhouse(): ClickHouseClient | undefined { /* same "unresolved" sentinel shape */ }
  get redis(): RedisConnection | undefined { /* same */ }

  async close(): Promise<void> {
    await Promise.all([
      this._prismaConnection && this._prismaConnection !== "unresolved"
        ? PrismaShutdownService.create().shutdown(this._prismaConnection)
        : Promise.resolve(),
      this._clickhouse && this._clickhouse !== "unresolved" ? this._clickhouse.close() : Promise.resolve(),
      this._redis && this._redis !== "unresolved" ? RedisShutdownService.create().shutdown(this._redis) : Promise.resolve(),
    ]);
  }
}
```

The three-state sentinel (`"unresolved"` vs. the resolved `T | undefined`) is
what makes "never accessed" distinguishable from "accessed, and this
environment has none" — a plain `T | undefined` field cannot tell `close()`
the difference between "never asked" and "asked, absent", and the difference
is exactly what determines whether `close()` may safely skip it. `loggedAbsence`
moves from boot-time (logged once for every unset URL, whether or not any
task cares) to first-access time (logged only for a handle some task actually
reached for) — a deliberate behavior change worth calling out in the same PR,
since today's boot log is also incidentally an inventory of what a deployment
has configured.

### Lifecycle tests it needs

All of these are new `apps/tasks/src/platform/__tests__/tasks-host.composition.unit.test.ts`
scenarios (the file does not exist today — this class currently has no
dedicated unit test, only the black-box entrypoint integration test).
Each needs the ability to observe whether the underlying connect factory
(`PrismaConnectionService.connect`, `createClient` from `@clickhouse/client`,
`RedisConnectionService.connect`) was actually invoked — spy on the module
export or inject a factory port, whichever this codebase's existing
composition tests already do for `PrismaConnectionService`/`RedisConnectionService`
(check `apps/api`'s or `apps/worker`'s infrastructure unit tests for the
established mocking seam before inventing a new one).

  - **Construction opens nothing.** Given all three URLs configured,
    `TasksHost.create(config)` must not call any of the three connect
    factories. Assert zero calls on each spy immediately after `create()`.
  - **First access opens exactly one handle.** After `create()`, calling
    `host.requireClickhouse()` calls `createClient` exactly once, and leaves
    the Prisma and Redis connect factories uncalled.
  - **Repeated access memoizes.** Calling `host.requireClickhouse()` twice
    (or once via `.clickhouse` and once via `.requireClickhouse()`) calls
    `createClient` exactly once and both calls return the SAME object
    (`toBe`, not `toEqual`).
  - **Absence is still named at first access.** With `CLICKHOUSE_URL` unset,
    the first `host.clickhouse` read (or `requireClickhouse()` call) logs the
    absence exactly once; a second read does not log it again.
  - **`close()` on an untouched host closes nothing.** Given all three URLs
    configured but no `require*()` ever called (the `prisma-migrate` task's
    real shape — it reads `process.env` itself, never the host), `close()`
    must not call any of `PrismaShutdownService.shutdown`,
    `clickhouse.close`, or `RedisShutdownService.shutdown`. This is the
    regression test for the exact case fix 16 named.
  - **`close()` closes only what was opened.** Given all three URLs
    configured, calling only `requireRedis()` before `close()` must shut down
    Redis and must NOT construct (and then close) ClickHouse or Prisma —
    assert both the connect and the shutdown spies for the untouched handles
    stay at zero calls each.
  - **`close()` on a host with nothing configured is a no-op**, unchanged
    from today's behavior — kept as a regression guard since the sentinel
    rework touches the same branch.
  - **Concurrent first access does not double-open.** Two overlapping
    `require*()` calls for the same handle before the first has resolved
    (relevant if a future connect factory becomes genuinely async — today's
    `PrismaConnectionService.connect`/`RedisConnectionService.connect` are
    synchronous, but the sentinel must not assume that stays true) must still
    open exactly one connection. If the real factories stay synchronous this
    collapses to the "repeated access memoizes" case above and needs no
    separate async test; note which is true at implementation time rather
    than assuming.
