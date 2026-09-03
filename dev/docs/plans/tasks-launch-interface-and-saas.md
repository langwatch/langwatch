# One task interface, and what langwatch-saas does without the submodule

Status: 2026-09-03. Part 1 is being built. Part 2 decided by Alex: the fallback (saas tasks stay private as plugins on `@langwatch/task`; `apps/tasks` loads `LANGWATCH_TASK_MODULES`); the recommended move-in may follow later.

## What exists

Tasks are one-shot programs run from a shell: migrations at boot, backfills,
provisioning, document generation. Today they have four launch shapes.

```
                     langwatch (this repo)                        langwatch-saas
  ┌─────────────────────────────────────────────────┐   ┌──────────────────────────────┐
  │ apps/api/src/tasks/<name>/<name>.entrypoint.ts   │   │ src/task.ts  (its own runner) │
  │   clickhouse-migrate · lwql-provision            │   │ src/tasks/<group>/<name>.ts   │
  │   model-provider-migrate · openapi-{generate,    │   │   stripe/syncStripePrices     │
  │   check}                                         │   │   modelRegistry/sync…          │
  │   package.json: task:<name> → tsx entrypoint     │   │   migrations/…  gdpr/…         │
  │                                                  │   │   analytics/…                  │
  │ apps/worker/src/tasks/*.task.ts                  │   │                                │
  │   4 task classes, NO entrypoint, NO script:      │   │ imports the submodule by       │
  │   unreachable since platform/app was deleted     │   │ relative path:                 │
  │   webhook-signature-vectors.entrypoint.ts        │   │ ../../../langwatch/platform/   │
  │                                                  │   │ app/src/server/db  (GONE)      │
  │ infra/docker/Dockerfile CMD:                     │   │                                │
  │   pnpm task:prisma-migrate && task:clickhouse-   │   │ Dockerfile.runtime COPYs       │
  │   migrate && task:lwql-provision && start        │   │ langwatch/platform/app (GONE)  │
  └─────────────────────────────────────────────────┘   └──────────────────────────────┘
```

main had 15 tasks under `platform/app/src/tasks` behind one runner
(`scripts/run-task.sh` → `src/task.ts` → generated `TASKS` map, every task a
`default export async function execute(...args)`). This branch kept 9 of them
in two shapes and dropped 6 (`cleanupOldLambdas`, `groupQueueMigrationAudit`,
`runTopicClustering`, `sendSlackAlert`, `generateOpenAPISpec` as a name, and
the `objectStorageMigration` helper split). langwatch-saas's runner and every
one of its 8 tasks import `langwatch/platform/app/...`, which no longer exists,
so the saas repo does not build against this branch at all.

## Part 1: one interface, tasks owned by features

```
packages/task/                       @langwatch/task        the interface + launcher, no product code
  src/task.ts                        abstract class Task { name; description; run({ args, signal }) }
  src/task-catalogue.ts              class TaskCatalogue { static create(tasks: Task[]); get(name); names() }
  src/task-launcher.ts               runTask({ catalogue, argv, close }) → exit code; logs start/finish/failure once
  src/task-host.port.ts              abstract class TaskHostPort { prisma?; clickhouse?; redis?; objectStorage?; config }

packages/features/<f>/server/src/tasks/<name>.task.ts      grammar addition: `tasks/<name>.task.ts` exports `<Name>Task`
  analytics/server      tasks/lwql-provision.task.ts
  model-provider/server tasks/model-provider-migrate.task.ts   (+ migrate-custom-models from main, dropped here)
  annotation/server     tasks/annotation-clickhouse-backfill.task.ts
  dataset/server        tasks/dataset-content-backfill.task.ts
  scenario/server       tasks/stalled-runs-backfill.task.ts
  stored-object/server  tasks/object-storage-migrate.task.ts   (+ its adapters and the group-queue audit)
  egress                tasks/webhook-signature-vectors.task.ts
  topic/server          tasks/topic-clustering-run.task.ts     (from main; dropped here)
  notification/server   tasks/slack-alert.task.ts              (from main; dropped here)

packages/clickhouse-client/src/tasks/clickhouse-migrate.task.ts   goose runner + migrations dir move here,
                                                                  beside prisma-client's prisma migrations

apps/tasks/                          @langwatch/tasks        the fourth executable: one composition root, one CMD
  src/tasks.entrypoint.ts            loads .env, composes TaskHost from the shared infrastructure roots,
                                     builds the catalogue from every feature's exported tasks, calls runTask
  src/tasks.catalogue.ts             the one list; a feature's task is here or it does not exist
  package.json                       "task": "tsx --env-file-if-exists=../../.env src/tasks.entrypoint.ts"
                                     "task:prisma-migrate" stays a prisma CLI wrapper, called by the same name

apps/api/src/tasks/openapi-document/  stays: it enumerates the api's own router. Its two entrypoints
                                     become Task classes and register in the same catalogue.
```

Rules the move keeps: a task is a class with `static create(deps)` and named
parameters; it calls services and adapters, never a repository; it throws the
contract's errors; a missing handle is a named absence (`TaskHostPort`
optionals), so `clickhouse-migrate` without ClickHouse refuses by name instead
of stack-tracing. Tests travel with each task into the owning package's
`__tests__`. The Docker CMD becomes
`cd /app/apps/tasks && pnpm -s task prisma-migrate && pnpm -s task clickhouse-migrate && pnpm -s task lwql-provision && cd ../api && pnpm -s start`,
and the same words work on a laptop: `pnpm --filter @langwatch/tasks task <name> [args]`.

### What landed (2026-09-03, reviewed in `dev/docs/plans/tasks-lane-review.md`)

Eight tasks are registered in `apps/tasks/src/tasks.catalogue.ts`:
`prisma-migrate`, `clickhouse-migrate`, `lwql-provision`,
`model-provider-migrate-custom-models`, `model-provider-migrate-credentials`,
`webhook-signature-vectors`, `slack-alert` and `object-storage-migrate`.
`apps/tasks` now carries a `prisma` dependency at the same pin as `apps/api`
(fix 1) — the container CMD's first step, `prisma migrate deploy`, needs the
CLI binary, and the image installs `--prod`, so it has to be a real
dependency rather than inherited from a devDependency elsewhere in the
workspace.

**Update (2026-09-03, later pass): `stalled-runs-backfill` is now wired**,
the ninth registered task. `apps/tasks` composes a minimal producer-only
Eventing host (`apps/tasks/src/platform/tasks-eventing.composition.ts`) over
its own Group Queue Redis — `consumersEnabled: false`,
`EventStoreProducerOnly`, `processManagerMode: "producer-only"`, the same
three decisions `ApiEventingInfrastructure` makes
(`apps/api/src/platform/infrastructure/api-eventing.infrastructure.ts`) — and
registers `createSimulationProcessingProducerPipeline` (already exported by
`@langwatch/scenario-server` for exactly this shape) to get a real
`finishRun` command sender. `StalledRunsBackfillTask.create` changed from two
eager collaborators to two deferred factories
(`packages/features/scenario/server/src/tasks/stalled-runs-backfill.task.ts`),
matching `TopicClusteringRunTask`'s existing `runPage` shape, so a missing
`REDIS_URL` fails only this task at run time rather than every task at
catalogue construction. Full wiring:
`apps/tasks/src/platform/stalled-runs-backfill.composition.ts`.

Three tasks still exist as `Task` subclasses but are not registered — each
names its own `apps/tasks` blocker in its file (`apps/tasks/src/tasks.catalogue.ts`
lists them by name too):

  - `annotation-clickhouse-backfill` (annotation) — needs a queue write for
    `bulkSyncAnnotations` on the trace pipeline; wiring it needs a producer
    registration of the trace-processing pipeline definition, which
    `apps/tasks` does not build (only `simulation_processing` is registered).
  - `dataset-content-backfill` (dataset) — needs `DatasetStorageResolver`,
    built from the worker's stored-object runtime (`TasksHost.objectStorage`
    is `never`).
  - `topic-clustering-run` (topic) — restored from main's `runTopicClustering`
    as `packages/features/topic/server/src/tasks/topic-clustering-run.task.ts`.
    Unlike `stalled-runs-backfill`, this one needs far more than a command
    sender: the full `TopicClusteringRunner` (ClickHouse reads, a
    model-provider gateway `apps/tasks` composes none of, langevals, a
    Prisma-backed repository, the legacy-import seed guard) PLUS two separate
    producer registrations — `topic_clustering_processing` for
    `TopicClusteringCommandsPort` (needs stand-ins for three Postgres
    `StateProjectionStore`s and its process manager's metrics and run ports)
    and the trace pipeline for `TraceTopicAssignmentPort`. Neither has a
    ready-made producer factory the way `simulation_processing` does. See the
    task's own comment for the full collaborator list.

`annotation-clickhouse-backfill` and `dataset-content-backfill` share one
root cause with each other, distinct from `topic-clustering-run`'s: a
producer registration `apps/tasks` has not built (the trace pipeline) or an
infrastructure handle it does not compose (object storage). Building the
trace pipeline's producer registration is follow-up work, not a one-line
fix — the same shape `stalled-runs-backfill` used for `simulation_processing`,
applied to a different, not-yet-built factory.

`slack-alert` was restored from main and no longer hardcodes
`baseHost: "https://app.langwatch.ai"` — it takes the base host as the task's
second argument (falling back to `BASE_HOST`), and its Slack transport
(`IncomingWebhook`) now lives in
`packages/features/automation/server/src/adapters/slack-webhook.client.adapter.ts`,
shared with the worker's real automation deliveries instead of duplicated.

`cleanupOldLambdas` stays retired: nothing on this branch invokes Lambda
(`LANGWATCH_NLP_LAMBDA_CONFIG` survives only as a capability flag), so there
is no subject left to restore.

## Part 2: langwatch-saas without the submodule

The saas repo's TypeScript is 8 tasks and a runner. Everything else in it is
Go tooling, Terraform, workflows and two small apps. The tasks import
langwatch's Prisma client, Redis connection, billing (Stripe) services,
nurturing service, model-provider catalogues and onboarding checks, all of
which are now `packages/enterprise/features/billing`,
`packages/features/model-provider`, `packages/features/onboarding` and
`packages/prisma-client`. They are enterprise feature code that happens to sit
in another repository.

### Recommended: the saas tasks move into `packages/enterprise` and the image ships them

```
langwatch-saas today                          recommended
┌──────────────────────────┐                  ┌──────────────────────────────────────────┐
│ langwatch/  (submodule)  │                  │ langwatch: packages/enterprise/features/  │
│ src/task.ts  src/tasks/  │  ── move ──▶     │   billing/server/src/tasks/               │
│ Dockerfile.runtime       │                  │     stripe-prices-sync.task.ts            │
│   FROM node, COPY        │                  │     tiered-free-to-seat-event.task.ts     │
│   submodule + src/tasks  │                  │   ...model-provider/server/src/tasks/      │
│ sync-model-registry.yaml │                  │     model-registry-sync.task.ts           │
│   pnpm run task:saas …   │                  │   ...user/server/src/tasks/               │
└──────────────────────────┘                  │     user-data-erase.task.ts (gdpr)        │
                                              │   ...onboarding/server/src/tasks/         │
                                              │     onboarding-completion-rate.task.ts    │
                                              │  apps/tasks catalogue lists them; the     │
                                              │  public image already contains them       │
                                              ├──────────────────────────────────────────┤
                                              │ langwatch-saas: NO submodule, NO node     │
                                              │  infra pins  image: langwatch/langwatch:  │
                                              │  <sha>  (a version, not a git pointer)    │
                                              │  workflows run                            │
                                              │   docker run langwatch/langwatch:<sha> \  │
                                              │     pnpm -s --filter @langwatch/tasks \   │
                                              │     task model-registry-sync              │
                                              │  Dockerfile.runtime deleted: the public   │
                                              │  image IS the runtime image               │
                                              └──────────────────────────────────────────┘
```

Why this and not "import the package somehow": the saas tasks need server
packages (Prisma, Redis, the billing service), and those are workspace
packages whose own dependencies are `workspace:*`. pnpm cannot resolve a
`workspace:*` graph out of a git dependency (`github:langwatch/langwatch#path:…`
works for a leaf package with registry deps only), and publishing 50 server
packages to a registry for one consumer is the wrong trade. Moving the 8 tasks
in makes the enterprise grouping true, deletes the second runner, and turns the
saas repo's coupling from a submodule SHA into an image tag, which is what it
deploys anyway. Secrets stay where they are: Stripe and OpenRouter keys come
from the environment the workflow or the pod supplies, never from code.

Cost: the saas tasks become public source. Billing and Stripe code is already
public in `packages/enterprise/features/billing`; the model-registry sync and
the GDPR erase are ordinary operations. If any single task is genuinely
private, it stays in saas as a plugin (below) and the rest move.

### Fallback: saas keeps private tasks as plugins on the same interface

**Implemented (2026-09-03).** `@langwatch/task` is a leaf package (deps:
`@langwatch/observability`, zod), so saas can depend on it as a git
subdirectory dependency and implement `Task`. `apps/tasks` reads
`LANGWATCH_TASK_MODULES` — a comma-separated list of module SPECIFIERS
(package names or absolute paths, not a directory to scan), split and
trimmed by `parseTaskModuleSpecifiers`
(`apps/tasks/src/platform/task-modules-loader.ts`). Each specifier is
imported with exactly one dynamic `import()` — the one place in `apps/tasks`
the inline-import ban is lifted, because a specifier named by an environment
variable cannot be a static `import` and this is the CLI's own boot seam
(`tasks.entrypoint.ts`), not a runtime path a composition function reaches
into later.

**The module contract.** A named module exports exactly one of:

  - `tasks: Task[]` — already-constructed instances, or
  - `createTasks(host: TaskHostPort): Task[]` — a factory over the SAME
    `TaskHostPort` the built-in tasks compose against.

Every element is checked with `instanceof Task` (imported from
`@langwatch/task`, so a plugin built against a mismatched version of the
package fails this check rather than silently passing a lookalike object).
A module exporting neither shape, a module whose array holds a non-`Task`
value, and a module that fails to `import()` at all (not found, throws at
its own top level, ...) all fail the same way: `loadTaskModules` throws an
`Error` naming the specifier, and boot fails outright — `main()` in
`tasks.entrypoint.ts` never reaches `TaskCatalogue.create`. An unknown or
broken plugin module is a container that refuses to start, not a smaller
catalogue nobody notices shrank.

Plugin tasks are concatenated with the built-in catalogue and handed to
`TaskCatalogue.create` together, which already refuses a duplicate `name`
at construction (`packages/task/src/task-catalogue.ts`) — a plugin colliding
with a first-party task name, or with another plugin's, fails boot the same
way as two first-party tasks racing for one name. No separate collision
check was needed in the loader itself.

What a plugin can reach is exactly `TaskHostPort` (typed narrowly — a Prisma
client type would drag the generated client in, so the host exposes the
contract services it composed, not the raw client): `require*()` refuses by
name for a handle this deployment did not configure, the same vocabulary a
first-party task gets.

The saas image is `FROM langwatch/langwatch:<sha>` plus a `COPY` of the
plugin module's build output, with `LANGWATCH_TASK_MODULES` naming its
resolvable module path:

```dockerfile
# langwatch-saas/Dockerfile.tasks (sketch — saas repo, not built here)
FROM langwatch/langwatch:<sha>

# The saas repo's own private tasks, built to plain ESM/CJS ahead of time —
# `apps/tasks` imports this by specifier, not by source, so the plugin's own
# build step (tsc/tsup/whatever saas already uses) runs before this COPY.
COPY dist/tasks /app/saas-tasks

ENV LANGWATCH_TASK_MODULES=/app/saas-tasks/index.js

# Same CMD the public image already runs; the saas image differs only in
# what LANGWATCH_TASK_MODULES points at.
```

And the saas-side module, `dist/tasks/index.js` (built from whatever source
`langwatch-saas` keeps its private tasks in):

```ts
// langwatch-saas/src/tasks/index.ts (sketch — saas repo, not built here)
import { Task, type TaskHostPort } from "@langwatch/task";

class StripePricesSyncTask extends Task {
  readonly name = "stripe-prices-sync";
  readonly description = "...";
  static create(host: TaskHostPort): StripePricesSyncTask { /* ... */ }
  async run(input: { args: readonly string[]; signal: AbortSignal }): Promise<void> { /* ... */ }
}

export function createTasks(host: TaskHostPort): Task[] {
  return [StripePricesSyncTask.create(host) /* , ...the rest of the 8 */];
}
```

This keeps the submodule out and the runner single, at the price of a second
build and a narrower surface for the private tasks. Use it only for tasks
that cannot be public.

Test coverage: `apps/tasks/src/platform/__tests__/task-modules-loader.unit.test.ts`
exercises both export shapes, a module exporting neither, a `tasks` array
holding a non-`Task` value, and an unresolvable specifier — each fixture
lives in `apps/tasks/src/platform/__tests__/fixtures/`.

### Not recommended

- Keeping the submodule and repointing 8 relative imports at the new package
  paths. It builds, and it keeps every cost the submodule has: a SHA to bump,
  a full workspace install in the saas image build, and a second copy of the
  runner.
- Publishing the server packages to npm or GitHub Packages. Fifty packages,
  one consumer, and a release step for every change.

## Sequence

1. Part 1 in langwatch: `@langwatch/task`, `apps/tasks`, grammar addition
   `tasks/<name>.task.ts`, move the 9 tasks, port the 4 dropped ones whose
   subjects exist, Docker CMD, specs and tests. One PR.
2. Decision on part 2. If recommended: a second langwatch PR adds the 8 saas
   tasks under `packages/enterprise`; the saas PR removes the submodule,
   `src/`, `Dockerfile.runtime`, `tsconfig.workers.json`, the node
   `package.json` scripts, points `sync-model-registry.yaml` and the deploy
   image reference at the public image tag, and keeps `infrastructure/`,
   `tools/`, `apps/` untouched.
3. If fallback: `apps/tasks` gains module loading (one env var, one loader,
   one collision check); the saas PR replaces the submodule with the git
   subdirectory dependency on `@langwatch/task`, rewrites the 8 tasks as
   `Task` classes over `TaskHostPort`, and builds `FROM` the public image.
