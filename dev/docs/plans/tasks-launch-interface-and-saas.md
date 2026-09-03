# One task interface, and what langwatch-saas does without the submodule

Status: proposed 2026-09-03. Part 1 is being built; part 2 needs a decision.

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

`@langwatch/task` is a leaf package (deps: `@langwatch/observability`, zod), so
saas can depend on it as a git subdirectory dependency and implement `Task`.
`apps/tasks` gains `LANGWATCH_TASK_MODULES=/app/saas/tasks`: a directory of
modules each exporting `tasks: Task[]`, loaded after the built-in catalogue,
name collisions refused. The saas image is
`FROM langwatch/langwatch:<sha>` plus `COPY dist/tasks /app/saas/tasks`. What
a plugin can reach is exactly `TaskHostPort`, typed narrowly (a Prisma
client type would drag the generated client in, so the host exposes the
contract services it composed, not the raw client). This keeps the submodule
out and the runner single, at the price of a second build and a narrower
surface for the private tasks. Use it only for tasks that cannot be public.

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
