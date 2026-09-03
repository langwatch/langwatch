# One task interface, and what langwatch-saas does without the submodule

**Status 2026-09-03, audited against the working tree.** Part 1 landed. Part 2
was decided by Alex in favour of the fallback (saas tasks stay private as
plugins on `@langwatch/task`; `apps/tasks` loads `LANGWATCH_TASK_MODULES`),
which is implemented. The recommended move-in remains an open option Alex may
take later.

## Part 1 — landed

`36993b361c` (the interface and launcher), `9419492617` (the operational tasks
onto the catalogue) and `b686724b39` (plugin modules + the stalled-runs
backfill). Review and its fix list: `tasks-lane-review.md`.

```
packages/task/                       @langwatch/task        the interface + launcher, no product code
  src/task.ts                        abstract class Task { name; description; run({ args, signal }) }
  src/task-catalogue.ts              class TaskCatalogue { static create(tasks); get(name); names() }
  src/task-launcher.ts               runTask({ catalogue, argv, close }) → exit code
  src/task-host.port.ts              abstract class TaskHostPort { prisma?; clickhouse?; redis?; objectStorage?; config }

packages/features/<f>/server/src/tasks/<name>.task.ts      grammar kind: `tasks/<name>.task.ts` exports `<Name>Task`
packages/clickhouse-client/src/tasks/clickhouse-migrate.task.ts   goose runner + the migrations directory

apps/tasks/                          @langwatch/tasks       the fourth executable: one composition root, one CMD
  src/tasks.entrypoint.ts            loads .env, composes TaskHost, builds the catalogue, calls runTask
  src/tasks.catalogue.ts             the one list; a feature's task is here or it does not exist
```

The Docker CMD is
`cd /app/apps/tasks && pnpm -s task prisma-migrate && pnpm -s task clickhouse-migrate && pnpm -s task lwql-provision && cd ../api && pnpm -s start`,
and the same words work on a laptop:
`pnpm --filter @langwatch/tasks task <name> [args]`.

Rules the move kept: a task is a class with `static create(deps)` and named
parameters; it calls services and adapters, never a repository; it throws the
contract's errors; a missing handle is a named absence (`TaskHostPort`
optionals), so `clickhouse-migrate` without ClickHouse refuses by name instead
of stack-tracing. Tests travelled with each task.

**Nine tasks registered:** `prisma-migrate`, `clickhouse-migrate`,
`lwql-provision`, `model-provider-migrate-custom-models`,
`model-provider-migrate-credentials`, `webhook-signature-vectors`,
`slack-alert`, `object-storage-migrate`, `stalled-runs-backfill`.

**Three moved but unregistered**, each naming its own blocker in its file and
in `apps/tasks/src/tasks.catalogue.ts`:
`annotation-clickhouse-backfill` and `dataset-content-backfill` (a trace
producer registration `apps/tasks` has not built, and the `objectStorage`
handle it does not compose) and `topic-clustering-run` (the full
`TopicClusteringRunner` plus **two** producer registrations, neither of which
has a ready-made factory). Details and the resume point are in
`tasks-lane-review.md`; the shared root cause is decision 6 in
`open-decisions-2026-09-03.md`.

`cleanupOldLambdas` stays retired: nothing on this branch invokes Lambda, so
there is no subject left to restore.

## Part 2 — the fallback, implemented

`@langwatch/task` is a leaf package (deps: `@langwatch/observability`, zod), so
saas can depend on it as a git subdirectory dependency and implement `Task`.
`apps/tasks` reads `LANGWATCH_TASK_MODULES` — a comma-separated list of module
SPECIFIERS (package names or absolute paths, not a directory to scan), split
and trimmed by `parseTaskModuleSpecifiers`
(`apps/tasks/src/platform/task-modules-loader.ts`). Each specifier is imported
with exactly one dynamic `import()` — the one place in `apps/tasks` the
inline-import ban is lifted, because a specifier named by an environment
variable cannot be a static `import` and this is the CLI's own boot seam.

**The module contract.** A named module exports exactly one of:

- `tasks: Task[]` — already-constructed instances, or
- `createTasks(host: TaskHostPort): Task[]` — a factory over the SAME
  `TaskHostPort` the built-in tasks compose against.

Every element is checked with `instanceof Task` imported from
`@langwatch/task`, so a plugin built against a mismatched version fails the
check rather than silently passing a lookalike. A module exporting neither
shape, an array holding a non-`Task`, and a module that fails to `import()` at
all fail the same way: `loadTaskModules` throws naming the specifier and boot
fails outright. An unknown or broken plugin is a container that refuses to
start, not a smaller catalogue nobody notices shrank.

Plugin tasks are concatenated with the built-in catalogue and handed to
`TaskCatalogue.create` together, which already refuses a duplicate `name` at
construction, so no separate collision check was needed.

What a plugin can reach is exactly `TaskHostPort` — typed narrowly, since a
Prisma client type would drag the generated client in, so the host exposes the
contract services it composed rather than the raw client. `require*()` refuses
by name for a handle this deployment did not configure, the same vocabulary a
first-party task gets.

The saas image is `FROM langwatch/langwatch:<sha>` plus a `COPY` of the
plugin's build output, with `LANGWATCH_TASK_MODULES` naming its resolvable
module path:

```dockerfile
# langwatch-saas/Dockerfile.tasks (sketch — saas repo, not built here)
FROM langwatch/langwatch:<sha>
COPY dist/tasks /app/saas-tasks
ENV LANGWATCH_TASK_MODULES=/app/saas-tasks/index.js
```

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

Coverage:
`apps/tasks/src/platform/__tests__/task-modules-loader.unit.test.ts` exercises
both export shapes, a module exporting neither, a `tasks` array holding a
non-`Task`, and an unresolvable specifier, with fixtures beside it.

## Part 2 — the move-in, still available

Alex took the fallback; the recommended option stays on the table and is
decision 7 in `open-decisions-2026-09-03.md`.

```
langwatch-saas today                          the move-in, if taken
┌──────────────────────────┐                  ┌──────────────────────────────────────────┐
│ langwatch/  (submodule)  │                  │ langwatch: packages/enterprise/features/  │
│ src/task.ts  src/tasks/  │  ── move ──▶     │   billing/server/src/tasks/               │
│ Dockerfile.runtime       │                  │     stripe-prices-sync.task.ts            │
│ sync-model-registry.yaml │                  │     tiered-free-to-seat-event.task.ts     │
└──────────────────────────┘                  │   model-provider/server/src/tasks/        │
                                              │     model-registry-sync.task.ts           │
                                              │   user/server/src/tasks/                  │
                                              │     user-data-erase.task.ts (gdpr)        │
                                              │   onboarding/server/src/tasks/            │
                                              │     onboarding-completion-rate.task.ts    │
                                              ├──────────────────────────────────────────┤
                                              │ langwatch-saas: NO submodule, NO node     │
                                              │  image: langwatch/langwatch:<sha>         │
                                              │  workflows run                            │
                                              │   docker run … pnpm -s --filter           │
                                              │     @langwatch/tasks task <name>          │
                                              │  Dockerfile.runtime deleted               │
                                              └──────────────────────────────────────────┘
```

Why this rather than "import the package somehow": the saas tasks need server
packages whose own dependencies are `workspace:*`, and pnpm cannot resolve a
`workspace:*` graph out of a git dependency. Publishing 50 server packages to a
registry for one consumer is the wrong trade. Moving the 8 tasks in makes the
enterprise grouping true, deletes the second runner, and turns the saas repo's
coupling from a submodule SHA into an image tag, which is what it deploys
anyway. Secrets stay where they are — Stripe and OpenRouter keys come from the
environment the workflow or the pod supplies.

Cost: the saas tasks become public source. Billing and Stripe code is already
public in `packages/enterprise/features/billing`; the model-registry sync and
the GDPR erase are ordinary operations. If any single task is genuinely
private, it stays in saas as a plugin and the rest move — the two options
compose.

### Not recommended, either way

- Keeping the submodule and repointing 8 relative imports at the new package
  paths. It builds, and it keeps every cost the submodule has: a SHA to bump, a
  full workspace install in the saas image build, and a second copy of the
  runner.
- Publishing the server packages to npm or GitHub Packages. Fifty packages, one
  consumer, and a release step for every change.

## What still has to happen in langwatch-saas

Nothing in this repository blocks it, and nothing here has done it: the saas
repo's runner and all 8 of its tasks still import
`langwatch/platform/app/...`, which no longer exists, so **the saas repo does
not build against this branch**. Under the fallback the saas PR replaces the
submodule with the git subdirectory dependency on `@langwatch/task`, rewrites
the 8 tasks as `Task` classes over `TaskHostPort`, and builds `FROM` the public
image.
