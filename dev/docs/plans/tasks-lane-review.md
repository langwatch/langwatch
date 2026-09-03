# Tasks lane review — Part 1 of `tasks-launch-interface-and-saas.md`

**Verdict then:** approve with fixes (4 P0, 10 P1, 9 P2). **Audited
2026-09-03 against the working tree:** every P0 and P1 fix landed; the P2 set
landed except fix 16, and fix 18 is partial. Two tasks the review asked to
wire are still unregistered, each for a reason named below.

## Landed

`36993b361c` (`@langwatch/task`, `apps/tasks`, first task moved),
`9419492617` (the operational tasks onto the catalogue) and `b686724b39`
(plugin module loading + the stalled-runs backfill through Eventing).

- **P0 1–4.** `apps/tasks/package.json:39` carries `"prisma": "7.9.1"` at
  `apps/api`'s pin, so the container CMD's first step finds the CLI under
  `--prod`. `apps/server/src/services/node-deps.ts:26-31`'s
  `APP_PACKAGE_NAMES` includes `"@langwatch/tasks"`, so the `npx` install
  creates its `node_modules`. `dev/compose.dev.yml` has the `tasks_modules`
  volume and the install filter. The npx-publish tarball assertion names the
  `packages/prisma-client/prisma.config.ts` the migrate path actually reads.
- **P1 5–14.** The `lwql-provision` self-import and stale `@see`; the two
  `<Name>Task extends Task` inversions and their Runner wrappers; the two
  ports moved out of `tasks/` into `ports/`; the "not yet registered" comments
  rewritten against `apps/tasks`' handles; `createMigrationInventory` moved to
  a `postgres.*.adapter.ts` so the task calls a service, not a repository; the
  usage block and the orphaned JSDoc in `object-storage-migrate.task.ts`; the
  `signature-vectors` generated-file note; `runTopicClustering` restored as
  `topic-clustering-run.task.ts`; the Slack `IncomingWebhook` transport folded
  into `automation/server/src/adapters/` and shared with the worker, with the
  base host taken from `args[1]`/`BASE_HOST` instead of hardcoded;
  `RETENTION_MANAGED_TABLES` moved into `data-retention-contract` so
  `clickhouse-client` no longer depends on a feature server.
- **P2 15, 17, 19–23.** The 12-line `TaskHostPort` comment cut to two; the two
  near-identically-named ClickHouse task classes folded;
  `model-provider-migrate.task.ts` split into two files; the entrypoint test's
  budget raised; the Dockerfile comment, the duplicate
  `task:prisma-migrate` script and the catalogue's unnamed report reference
  all corrected.
- **Fix 8, both halves.** `object-storage-migrate` is wired
  (`apps/tasks/src/platform/object-storage-migrate.composition.ts`), and
  `stalled-runs-backfill` is wired through a minimal producer-only Eventing
  host (`tasks-eventing.composition.ts` +
  `stalled-runs-backfill.composition.ts`) reusing
  `createSimulationProcessingProducerPipeline`.
  `StalledRunsBackfillTask.create` takes deferred factories rather than eager
  values, so a missing `REDIS_URL` fails only that task at run time instead of
  every task at catalogue construction.

Eleven tasks are registered in `apps/tasks/src/tasks.catalogue.ts`:
`prisma-migrate`, `webhook-signature-vectors`, `clickhouse-migrate`,
`lwql-provision`, `model-provider-migrate-custom-models`,
`model-provider-migrate-credentials`, `slack-alert`,
`object-storage-migrate`, `stalled-runs-backfill`,
`annotation-clickhouse-backfill`, `dataset-content-backfill` (plus the
enterprise-billing and user-data tasks another lane added since).

**Two retirements confirmed.** `cleanupOldLambdas` stays retired — nothing on
this branch invokes Lambda, no `@aws-sdk/client-lambda` dependency exists, and
`LANGWATCH_NLP_LAMBDA_CONFIG` survives only as a capability flag. The orphan
config leaf is a separate cleanup. `runTopicClustering`'s file was restored;
its registration is open (below).

**The migrations move is correct and complete.** `tools/migrationorder`'s
`set.go` makes `packages/clickhouse-client/migrations` canonical and lists the
old root in **both** `PreviousDirectories` and `ForbiddenDirectories`, which is
the lesson from the last move. Every workflow, semgrep include and
path-reading test resolves to the new directory. One harmless dead include
remains: `langwatch.yml:159` adds
`packages/clickhouse-client/migrations/**/*.sql` under a rule whose `exclude`
is `**/migrations/**` — same as before the move.

## Open — one unregistered task (was three)

Decision 6 in `open-decisions-2026-09-03.md` chose option (a): build the
trace-processing pipeline's producer factory and register the two cheap
tasks; leave `topic-clustering-run` named and unregistered. Both parts are
now done.

- **`annotation-clickhouse-backfill`** (annotation) — **wired.**
  `createTraceProcessingProducerPipeline` (`@langwatch/trace-server`) already
  existed (built for `apps/api`'s annotation tRPC path) and is reused
  unchanged. `apps/tasks/src/platform/annotation-clickhouse-backfill.composition.ts`
  registers it on this process's own producer-only Eventing host and wraps
  `registered.commands.bulkSyncAnnotations` as a `TraceAnnotationSyncPort`.
  `AnnotationClickHouseBackfillTask.create` now takes deferred factories
  (`source`/`sync` as `() => Port`, not values), matching
  `stalled-runs-backfill`'s reason: a missing `REDIS_URL` fails only this task
  at run time, not every task at catalogue construction.
- **`dataset-content-backfill`** (dataset) — **wired.**
  `TasksHost.objectStorage` is no longer `never`: it is
  `TasksObjectStorage` (`apps/tasks/src/platform/infrastructure/tasks-stored-object-storage.adapter.ts`),
  built from the SHARED `objectStorageConfigDefinition`
  (`@langwatch/config`) — the same `S3_BUCKET_NAME`, `STORED_OBJECTS_BACKEND`
  etc. `apps/api` and `apps/worker` read — plus the shared
  `parseDataplaneS3RoutingTable` helper for BYOC routing, reusing
  `StoredObjectDestinationPolicy` from `@langwatch/stored-object-server/storage`
  rather than the worker's own app-local driver classes (which stayed
  untouched; `apps/worker` was read-only for this change). Rather than
  literally moving `WorkerDatasetStorageResolver`, a new
  `DatasetObjectStorageResolver` + `DatasetObjectStorageS3ClientResolver`
  landed in `dataset/server/src/adapters/dataset-object-storage-resolver.adapter.ts`,
  decoupled from any one app's storage runtime via a small
  `DatasetStorageDestinationPort` seam (`apps/tasks` implements it by wrapping
  its own `StoredObjectDestinationPolicy`). **Azure is a named absence**: this
  composition builds no Azure driver, so a deployment whose real
  `STORED_OBJECTS_BACKEND=azure` gets a clear refusal (thrown by
  `StoredObjectDestinationPolicy` itself) the moment a project resolves to it,
  never a silent local-filesystem fallback. `DatasetContentBackfillTask.create`
  now takes deferred factories too, for the same reason as annotation's.
- **`topic-clustering-run`** (topic) — **still unregistered, now for a
  smaller reason.** The producer side is done:
  `createTopicClusteringProcessingProducerPipeline`
  (`packages/features/topic/server/src/adapters/topic-clustering-processing-producer.adapter.ts`)
  registers `topic_clustering_processing` for `TopicClusteringCommandsPort`
  (`recordTopics`, `requestClustering`), with stand-ins for the three Postgres
  `StateProjectionStore`s and the process manager's run port, outcome commands
  and metrics port — all plain interfaces, no abstract-class ceremony needed.
  Combined with the pre-existing `createTraceProcessingProducerPipeline` for
  `TraceTopicAssignmentPort`, **both** producer registrations
  `topic-clustering-run` needs now exist. What remains is the runner itself:
  a real `TopicClusteringRunPort` needs a model-provider gateway, langevals
  and a Prisma repository, none of which `apps/tasks` composes. This factory
  is built but **not yet consumed by any apps/tasks task** — it is groundwork
  for whoever builds that runner next.

## Open — fix 18, index surfaces (partial)

Applied to annotation, dataset, analytics and model-provider. The
`stored-object/server` index still exports `MigrationBlockedError`,
`createMigrationStorageEndpoint`, every `Migration*` type,
`resolveMigrationS3Region`, `auditGroupQueuesForStorageMigration` and
`QueueAuditRedis`. Most of those became real composition-root imports when the
task was wired in the same pass
(`object-storage-migrate.composition.ts` imports `createMigrationTask`,
`createMigrationInventory`, `MigrationS3StorageDriver`,
`MigrationCutoverRedisAudit`, `StoredObjectsRepository`,
`StoredObjectsClickHousePort` and `auditQueuesForCutover` directly), so
trimming them would break the composition. The remaining untrimmed names are
genuinely test-only or unused outside the package and want an individual
audit, not a sweep.

## Open — fix 16, lazy handle composition (plan written, not implemented)

`TasksHost.create()` (`apps/tasks/src/platform/tasks-host.composition.ts:64`)
still opens Prisma, ClickHouse and Redis eagerly whenever their URLs are
configured. `prisma-migrate` — the container CMD's first step — therefore opens
a ClickHouse client and a Redis connection it never reads.

### Why it is not a one-line change

Three things move at once, not one:

1. **The fields become getters.** `TaskHostPort` declares
   `abstract readonly prisma: Prisma | undefined` etc.; a subclass may satisfy
   an abstract `readonly` member with a `get prisma()` accessor, so this is a
   `TasksHost` change only, not a `TaskHostPort` one.
2. **Each getter must memoize.** A task can call `requireClickhouse()` more
   than once in one run (`stalled-runs-backfill`'s two factories both do). A
   naive getter would open a second client, a second pool, and for Prisma a
   second `PrismaTenancyGuardService` wrap per call.
3. **`close()` must track what was OPENED, not what was CONFIGURED.** Today's
   `this.clickhouse ? … : Promise.resolve()` is sound only because the two are
   the same fact. Once opening is deferred, reading the getter to check
   presence would _open_ it — turning shutdown into the last thing that creates
   a connection. `close()` needs its own record of what was actually
   constructed, checked directly and never through the public getter.

Nothing here touches `TaskHostPort`, `TasksConfig` or any task: every consumer
already goes through `require*()`, never the raw field, so the laziness is
invisible to them by construction. That is why deferring it was safe.

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

  get clickhouse(): ClickHouseClient | undefined { /* same "unresolved" sentinel */ }
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

The three-state sentinel is what makes "never accessed" distinguishable from
"accessed, and this environment has none" — a plain `T | undefined` cannot tell
`close()` the difference, and the difference is exactly what decides whether
`close()` may skip it. `loggedAbsence` moves from boot time to first-access
time, a deliberate behaviour change to call out in the same PR since today's
boot log is incidentally an inventory of what a deployment configured.

### Lifecycle tests it needs

New file `apps/tasks/src/platform/__tests__/tasks-host.composition.unit.test.ts`
(this class has no dedicated unit test today, only the black-box entrypoint
integration test). Each case needs to observe whether the underlying connect
factory was invoked — check `apps/api`'s or `apps/worker`'s infrastructure unit
tests for the established mocking seam rather than inventing one.

- **Construction opens nothing.** All three URLs configured;
  `TasksHost.create(config)` calls no connect factory.
- **First access opens exactly one handle.** `requireClickhouse()` calls
  `createClient` once and leaves the other two uncalled.
- **Repeated access memoizes.** Two calls, one `createClient`, and both return
  the same object (`toBe`, not `toEqual`).
- **Absence is still named at first access**, once, not again on a second read.
- **`close()` on an untouched host closes nothing** — the `prisma-migrate`
  case, and the regression test for what fix 16 names.
- **`close()` closes only what was opened** — after only `requireRedis()`,
  the other two connect _and_ shutdown spies stay at zero.
- **`close()` with nothing configured is a no-op**, unchanged.
- **Concurrent first access does not double-open.** Today's connect factories
  are synchronous, so this may collapse into the memoization case; note which
  is true at implementation time rather than assuming.
