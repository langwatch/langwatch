# scenario — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
shaped after [`dataset.md`](./dataset.md).

## 1. What is there now

**26,951 lines across 178 non-test files** — server 90 files / 16,758 lines,
contract 40 / 5,015, web 48 / 5,178.

**54 distinct operations** (29 scenario + 25 simulation), declared **≈273 times**
across nine layers.

```
  @langwatch/scenario-contract                                    84 non-test files outside
    scenario.service.ts        abstract ScenarioService     29     the feature import this
    simulation.service.ts      abstract SimulationService   25     package. It earns its keep.
        │
  ── two doors, and only one goes through the app ───────────────────────────────
        │
  transport/api-trpc/  (8 files)              transport/api-rest/  (5 files)
    ctx.app.scenarios → ScenarioApp             scenarios: () => ScenarioService
    27 procedures, ~10 pass-through             calls the SERVICE directly, and
                                                stamps its own `actor`
        │                                              │
    app/scenario.app.ts     ScenarioApp   32 methods ← 24 literal one-line pass-throughs
        │                                              │
        ├──────────────────────────┬──────────────────┴────────┬─────────────────┐
        │                          │                           │                 │
  services/scenario.service   services/simulation.service  services/scenario-   services/
    ScenarioService  28         SimulationService  24        execution.service   scenario-tab-
    real rules ✔                24/24 are `schema.parse(     5 methods,          registry.service
        │                       await repo.same(input))`     5 delegations       carries a whole
        │                           │                            │               in-memory store
  repositories/scenario       repositories/simulation      services/scenario-    behind `| null`
    .repository  abstract 24    .repository  abstract 17    execution-prefetcher
        │                       + NullSimulationRepo 17     + 5 sub-services
  repositories/prisma/        repositories/clickhouse/          │
    scenario.repository  23     simulation-clickhouse         services/scenario-
    1,592 lines, 17 methods     .repository  17               processor.service
        │                           │                         ↕ connect() cycle
      Postgres                  ClickHouse                  services/scenario-
                                                            execution-pool.service
  ports/ (12 files, avg 14 lines)   adapters/ (25 files)   projections/ subscribers/
                                                            processes/ intents/ stores/
```

`server/src/adapters/` holds two categories under one name: **19 real adapters**
(child process, HTTP agent, code agent, workflow agent, prompt config, Redis,
LiteLLM — genuine boundary implementations) and **6 wiring factories** that only
call another class's `create` (`prisma.scenario.adapter.ts:11-27`,
`simulation.clickhouse.adapter.ts:21-34`,
`simulation-eventing.adapter.ts:40,93,127`,
`simulation-processing-pipeline.adapter.ts`).

Wrapped outside by two more pure-wiring classes in the app:
`platform/app/src/runtime/app/features/scenario.ts:13-46` (`AppScenarioRuntime`,
6 fields re-passed verbatim) and `.../simulation.ts:81-98` (`AppSimulationRuntime`).

## 2. Problems

### P1 — The facade covers one door of two, so the two doors already differ (breaks R3, R8)

`app/scenario.app.ts:1-31` states the reason the class exists:

> "Five tRPC sub-surfaces answer for this feature … a REST family for the same
> feature would have had to restate it. … A caller arrives as an argument, never
> read from a session or a request."

The REST family restates it. `transport/api-rest/scenario-v1.api.ts:29-32` takes
`scenarios: () => ScenarioService` — the service, not the app — and calls it at
`:204, :251, :309, :372, :380, :442, :491, :562`. Same for
`api-rest/simulation-run.api.ts:169` (`simulations: () => SimulationService`,
called at `:205, :211, :236, :257, :309, :357, :398`) and
`api-rest/scenario-event.api.ts:59`.

The divergence is not hypothetical. `scenario-v1.api.ts:145-150` reads the caller
**from a request header** and builds the actor itself:

```ts
function actorFromRequest(c: { req: { header: (name: string) => string | undefined } }): ScenarioActor {
  const declared = c.req.header("X-LangWatch-Surface")?.toLowerCase();
  return { userId: null, label: declared === "cli" ? "cli" : "api" };
}
```

passed at `:317` (create) and `:389` (update). tRPC does the opposite —
`scenario-crud.api.ts:80, :140, :217` hand `ctx.actor()` to the app, which stamps
**two** fields (`app/scenario.app.ts:186-190`): `lastUpdatedById` *and* `actor`.
REST sets `actor` only, so an API-key update leaves `lastUpdatedById` stale while
the version history records `api`. Two doors, two answers — the exact failure the
facade's own docstring says it prevents.

The app cannot currently serve REST: `authorFor` (`scenario.app.ts:137-139`)
hard-codes `label: "user"`, so there is no way to express an API or CLI caller.

### P2 — `readSuiteRunData` consolidated 2 of 6 call sites, and says otherwise (breaks R7, R8)

`app/scenario.app.ts:332-344`:

> "Which read answers is a domain question, not a paging one … Two handlers asked
> it, so it is answered once."

Callers of the consolidated method: `scenario-events.api.ts:116, :207`. Callers of
the two raw branches it wraps, still reachable because the app re-exports both at
`scenario.app.ts:413` and `:449`: `scenario-events.api.ts:186`, `:355`,
`api-rest/simulation-run.api.ts:236`, `:257`. Four of six handlers bypass the
answer. The comment is not true of the code.

### P3 — `SimulationService` is 24 methods of re-validation and nothing else (breaks R3)

`services/simulation.service.ts:73-219`. Every read is
`schema.parse(await this.repository.sameName(input))`; every write is
`this.execution.sameName(schema.parse(input))`. Zero domain rules, zero branches.
`ast-grep --filter no-same-name-delegation-ts` flags the three that do not even
wrap a parse (`:124, :170, :174`); the AST rule cannot see the other 21 through
the `parse()` call.

The parses are not free: `simulationRunDataSchema.array().parse(...)`
(`:112, :119-121, :148-149`) re-validates every row on every page read, on data
this same package's `repositories/clickhouse/simulation-run.mapper.ts` just built
from typed columns.

### P4 — `ScenarioExecutionService` is five methods and five delegations (breaks R3)

`services/scenario-execution.service.ts:36-56`:

| Method | Body |
|---|---|
| `submit` (`:36`) | `this.options.pool.submit(input)` |
| `cancel` (`:40`) | `this.options.cancellations.publish(input)` |
| `prefetch` (`:44`) | `this.options.prefetcher.prefetch(input)` |
| `prepare` (`:50`) | `this.options.prefetcher.prepare(input)` |
| `finishUnsuccessfulRun` (`:54`) | `this.options.failures.finishUnsuccessfulRun(input)` |

`ast-grep` flags `:44, :50, :54`. Underneath, `prefetch` delegates again:
`services/scenario-execution-prefetcher.service.ts:107-111` is
`return this.prepare(input).result`. A prefetch travels
tRPC → `ScenarioApp.prefetchExecution` (`scenario.app.ts:272`) →
`ScenarioExecutionService.prefetch` → `ScenarioExecutionPrefetcherService.prefetch`
→ `.prepare` — four hops before any behaviour.

### P5 — 54 operations, ≈273 declarations (breaks R8)

| Operation set | Declared in | Count |
|---|---|---|
| Simulation (25) | `contract/src/simulation.service.ts:114-163` | 25 |
| | `server/src/services/simulation.service.ts:73-219` | 24 |
| | `server/src/repositories/simulation.repository.ts:41-83` | 17 |
| | `server/src/repositories/simulation.repository.ts:86-151` (`NullSimulationRepository`) | 17 |
| | `server/src/repositories/clickhouse/simulation-clickhouse.repository.ts` | 17 |
| | `server/src/testing.ts:39-153` (`TestSimulationService`) | 25 |
| | `server/src/ports/simulation-execution.port.ts:13-22` | 8 |
| | `platform/app/src/runtime/app/features/simulation.ts:25-65` | 8 |
| | `server/src/app/scenario.app.ts` (simulation reads) | 12 |
| Scenario (29) | `contract/src/scenario.service.ts` | 29 |
| | `server/src/services/scenario.service.ts:73-427` | 28 |
| | `server/src/repositories/scenario.repository.ts:21-73` | 24 |
| | `server/src/repositories/prisma/scenario.repository.ts:85-682` | 23 |
| | `server/src/app/scenario.app.ts` (scenario ops) | 16 |

Adding one simulation read means editing six files before a query exists.

### P6 — `index.ts` publishes ≥146 symbols; 46 are used outside (breaks R8)

`server/src/index.ts` is 97 lines: **37 `export *` lines** publishing ≥110 symbols,
plus 36 named. Across the 24 files outside the feature that import
`@langwatch/scenario-server`, **46 distinct symbols** are used. Published and never
imported outside: `AUTH_STRATEGIES`, `CANCELLATION_CHANNEL`, `ChildLoggerAdapter`,
`ChildProcessSpawnAdapter`, `ChildTlsEnvAdapter`, `ExecutionJobData`,
`FencedTemplate`, `HttpAuthAdapter`, `LitellmModelAdapter`, `PromptTemplateAdapter`,
`RemoteTraceRunAdapter`, `ScenarioChildBootstrapPort`, `ScenarioChildExecutionAdapter`,
`ScenarioExecutionPoolPort`, `ScenarioExecutionRunnerPort`, `ScenarioRoleModelAdapter`,
`ScenarioSecretReferenceAdapter`, `ScenarioTabStorePort`, `ScenarioWorkflowMappingService`,
`SerializedAgentRegistryAdapter`, `SerializedHttpAgentAdapter`, `SerializedPromptConfigAdapter`,
`SerializedWorkflowAgentAdapter`, `SimulationProcessingCommandsAdapter`, `SimulationService`,
`applyAuthentication`, `buildChildEnvironment`, `buildPromptTemplateContext`,
`createJudgeModelFromParams`, `fenceSecretRefs`, `filterRunsByTimestamp`,
`redactSecrets`, `resolveSecretRefs`, `selectRoleModelParams`, and ~65 more.

`index.ts:72` also reaches into a transport module for a pure domain predicate:
`export { filterRunsByTimestamp } from "./transport/api-trpc/scenario-events.api"`
(defined at `scenario-events.api.ts:46`).

### P7 — Four of fifteen ports have one in-package implementation (breaks R4)

Implementations found by `grep -rn "extends <Port>"` repo-wide, excluding tests:

| Port | Production impls | Verdict |
|---|---|---|
| `ScenarioClockPort` (`scenario-clock.port.ts:1`) | 1, `platform/app/.../scenario.ts:76` | **Keep** — cross-package |
| `ScenarioIdPort` / `ScenarioFolderIdPort` (`scenario-id.port.ts:1,5`) | 1 each, `platform/app/.../scenario.ts:48,62` | **Keep, merge** — see below |
| `ScenarioSecretCipherPort` (`:2`) | 1, `platform/app/.../scenario.ts:90` | **Keep** — cross-package |
| `ScenarioHttpPort` (`scenario-http.port.ts:18`) | 1, `platform/app/src/runtime/worker/scenario-child-process.ts:12` | **Keep** — SSRF policy inversion |
| `ScenarioProcessorServiceMetricsPort` (`:1`) | 1, `platform/app/src/runtime/worker/app-scenario-processor.adapter.ts:15` | **Keep** — cross-package |
| `SimulationExecutionPort` (`:13`) | 1, `platform/app/.../simulation.ts:25` | **Keep** — cross-package |
| `SimulationWindowedReadPort` (`:26`) | 1, `platform/app/.../simulation.ts:68` | **Keep** — cross-package |
| `CancellationPublisherPort` (`:9`) | 2 in-package (`redis.cancellation-channel.adapter.ts:22,40`) | **Keep** |
| `ScenarioExecutionPoolPort` (`:4`) | 2 in-package (`scenario-execution-pool.service.ts:29,243`) | **Keep** |
| `CancellationSubscriberPort` (`:14`) | 1 in-package (`redis.cancellation-channel.adapter.ts:58`) | **Delete** |
| `ScenarioTabStorePort` (`:1`) | 1 in-package (`redis.scenario-tab-store.adapter.ts:26`) | **Keep — after P9** |
| `ScenarioChildBootstrapPort` + `ScenarioChildExecutionSession` (`:17, :12`) | 1 in-package (`node-scenario-child-process.adapter.ts:59, :211`) | **Delete** |
| `ScenarioExecutionRunnerPort` (`:3`) | 1 in-package (`scenario-processor.service.ts:25`) | **Delete with P8** |

`ScenarioIdPort` and `ScenarioFolderIdPort` (`ports/scenario-id.port.ts:1-6`) are
byte-identical abstract classes — `abstract next(): string` — and their two app
implementations (`platform/app/src/runtime/app/features/scenario.ts:48-60` and
`:62-74`) are byte-identical too, thirteen lines each wrapping a `() => string`.
One `ScenarioIdPort` with two named instances says the same thing.

### P8 — The execution pool is built in two phases, and one guard is a throw while two are `?.` (breaks R5)

`services/scenario-execution-pool.service.ts:41`:

```ts
private runner: ScenarioExecutionRunnerPort | undefined = void 0;
```

set later by `connect()` (`:52-54`), called from
`services/scenario-processor.service.ts:49` inside `start()`. The cycle is real:
`ScenarioProcessorService.create` takes `pool: ScenarioExecutionPoolService` — the
**concrete** class, not the port (`scenario-processor.service.ts:28`) — because it
needs `connect`, `runningChildren` and `markCancelled`, while the pool needs the
processor to run jobs.

The same field is then guarded three different ways:

- `:184-188` — `if (!runner) throw new Error("Scenario execution pool is not connected …")`
- `:147` — `this.runner?.skipCancelled(jobData);`
- `:225` — `this.runner?.skipCancelled(next);`

Both `?.` sites are the **cancellation** path. If a job is submitted before
`start()` runs, `submit` at `:142-149` takes the cancelled branch, the optional
call evaporates, and the run never reaches a terminal state — it orphans at
QUEUED, which is precisely what the `inFlightJobs` comment at `:75-80` says the
design exists to prevent. One field, three policies, and the quiet one is on the
path that matters.

### P9 — `ScenarioTabRegistryService` carries a second store implementation inside itself (breaks R5, R2)

`services/scenario-tab-registry.service.ts:22-27` takes
`store: ScenarioTabStorePort | null`, and every one of the five methods opens with
the same three lines (`:41-42, :64-65, :87-88, :113-114, :139-140`):

```ts
const store = this.options.store;
if (!store) { /* …an entire in-memory implementation… */ }
```

The in-memory half is real code: two maps (`:19-20`), `memoryEntry` (`:157`),
`pruneMemory` (`:167`), and a pending-navigate sweeper (`:180`). Production reaches
it — `platform/app/src/server/app-layer/presets.ts:2316` passes
`redis ? RedisScenarioTabStoreAdapter.create(redis) : null` — so this is a genuine
two-mode feature written as a nullable field instead of a second adapter. Extracted
as `MemoryScenarioTabStoreAdapter`, the service loses ~70 lines and five branches,
and `ScenarioTabStorePort` earns its second implementation (P7).

### P10 — Six wiring-only classes between the composition root and the constructor (breaks R3)

`platform/app/src/server/app-layer/presets.ts:1430-1437` calls
`AppScenarioRuntime.create({ database, simulations, ids, folderIds, clock, secretCipher })`.
`AppScenarioRuntime.build()` (`platform/app/src/runtime/app/features/scenario.ts:36-45`)
re-passes all six to `PrismaScenarioAdapter.create`, which
(`packages/features/scenario/server/src/adapters/prisma.scenario.adapter.ts:19-26`)
re-passes all six to `ScenarioService.create`. Three classes, 74 lines, six fields
spelled three times, no behaviour. The simulation side is the same shape —
`presets.ts:1411` → `AppSimulationRuntime.build()` (`simulation.ts:88-98`) →
`SimulationClickHouseAdapter.create` (`adapters/simulation.clickhouse.adapter.ts:21-30`)
→ `SimulationService.create`.

### P11 — `cancelBatchRun` re-reads the whole batch once per run

`services/scenario.service.ts:397-401` reads the batch, then `:406-418` calls
`this.cancelJob(...)` for every cancellable run — and `cancelJob` at `:373-377`
reads the same batch again. A 100-run batch issues 101 `getRunDataForBatchRun`
ClickHouse reads where one would do. `cancelJob` needs the run's status, which
`cancelBatchRun` already filtered for at `:403`.

### P12 — Repository methods are named like services (breaks the repo naming rule)

25 `get*` against 16 `find*` across `repositories/`. Worst:
`repositories/clickhouse/simulation-clickhouse.repository.ts` — 12 `get*`
(`:385 getScenarioSetsData`, `:462 getBatchHistoryForScenarioSet`,
`:795 getAllRunDataForScenarioSet`, `:1173 getLastResultSummaries`,
`:1282 getDistinctExternalSetIds`) against 3 `find*` (`:1027, :1247, :1373`). The
abstract propagates it (`repositories/simulation.repository.ts:42-79`: 11 `get*`,
3 `find*`). `repositories/prisma/scenario.repository.ts` is compliant apart from
`:425 getFolderRunDefinition`. Because the service is a same-name pass-through
(P3), `get*`/`find*` is the only signal a reader has for which layer they are in,
and it is wrong on 25 of 41 methods.

### P13 — The dedup subquery is inlined three times over a helper that already exists

`repositories/clickhouse/simulation-clickhouse.repository.ts:165-172` defines
`qualifiedDedupPredicate`, called at `:1349` and `:1420`. Its body is then written
out by hand, byte for byte, at `:744-750`, `:809-814` and `:1573-1579`. This is the
IN-tuple dedup pattern `dev/docs/best_practices/clickhouse-queries.md` mandates, so
a divergence between the five copies is a correctness bug, not a style one.

### P14 — Comments name six files that no longer exist, and four are incident reports (breaks R7)

Source files named in comments, checked against the tree (`packages/`, `platform/`,
`apps/`, `services/`):

| Comment | Names | In tree? |
|---|---|---|
| `adapters/scenario-child-execution.adapter.ts:16` | `scenario.processor.ts` | **gone** |
| `contract/src/scenario-infra-error.ts:308` | `scenario.processor.ts` | **gone** |
| `processes/simulation-run-execution-data.process.ts:72` | `execution-pool.ts` | **gone** |
| `adapters/litellm-model.adapter.ts:5` | `standalone-adapters.ts`, `scenario-worker.ts` | **gone** |
| `contract/src/scenario-infra-error.ts:147, :320` | `http-agent.adapter.ts` | **gone** |
| `contract/src/scenario-execution-data.ts:318` | `job-model-params.ts` | **gone** |
| `contract/src/scenario-execution-data.ts:339` | `serialized-adapter.registry.ts` | **gone** |
| `repositories/clickhouse/clickhouse.simulation-run-state.repository.ts:220-229` | `simulation.clickhouse.repository.ts` | **gone** (file is `simulation-clickhouse…`) |

Incident narratives and rollout notes that belong in an ADR:

- `clickhouse.simulation-run-state.repository.ts:220-229` — "exhausted the server
  memory limit (Code 241) …", and the file it points at for the fix is misnamed.
- `simulation-clickhouse.repository.ts:551-569` — 19 lines on a completed
  migration: "This is the widening the old empty-clause helper did *silently* …
  precisely what byte-identical adoption forbids."
- `simulation-clickhouse.repository.ts:1082-1087` — a manual cross-file sync
  contract, "⚠️ KEEP IN SYNC … run-history-transforms.ts → computeGroupSummary()",
  enforced by nothing.
- `projections/simulation-run-state.projection.ts:197-208` — "a `queued` event
  folded after `finished` used to resurrect Status=QUEUED …".
- `clickhouse.stalled-simulation-run.repository.ts:10-13, :27-36` — rollout notes
  for a one-shot task, referencing a deleted boot reconciler.

The `@see specs/…` links (18 of them) are a different thing and correct — keep
every one.

## 3. What it should look like

```
contract/src/                                                    unchanged shape,
  scenario.service.ts               ~108   29 signatures         84 external files
  simulation.service.ts             ~164   25 signatures         depend on it

server/src/
  app/scenario.app.ts               ~260   the one class BOTH doors call. Gains a
                                           `ScenarioCaller` that carries its label,
                                           so REST can use it. Keeps the three real
                                           rules: attribution, the queued-run metadata
                                           envelope, `readSuiteRunData`.
  services/
    scenario.service.ts             ~400   unchanged but for P11
    simulation.service.ts            ~90   ← was 220. Parses only where a boundary
                                           actually needs it; the rest is the repo.
    scenario-execution-prefetcher.service.ts  ~180
    scenario-prefetch-completion.service.ts   ~358
    scenario-target-prefetch.service.ts       ~402
    scenario-workflow-hydrator.service.ts     ~227
    scenario-execution-lookup.service.ts      ~143
    scenario-model-parameters.service.ts       ~99
    scenario-failure-handler.service.ts       ~138
    scenario-workflow-mapping.service.ts       ~52
    scenario-run-secrets.service.ts            ~34
    scenario-tab-registry.service.ts          ~135  ← was 206
    scenario-processor.service.ts             ~330  ← absorbs the pool
  ports/                                             10 files, was 12
    scenario-clock.port.ts · scenario-id.port.ts (one class)
    scenario-secret-cipher.port.ts · scenario-http.port.ts
    scenario-processor-metrics.port.ts · scenario-tab-store.port.ts
    cancellation-channel.port.ts (publisher only)
    scenario-execution-pool.port.ts
    simulation-execution.port.ts · simulation-windowed-read.port.ts
  repositories/                                      find*/findAll/findById throughout
  adapters/                                          19 real adapters; the 6 wiring
                                                     factories are gone
  projections/ subscribers/ processes/ intents/ stores/   unchanged
  transport/api-rest/ api-trpc/                      both on ScenarioApp
  index.ts                          ~55   named exports only, ~50 symbols
```

**Deleted:** `adapters/prisma.scenario.adapter.ts`,
`adapters/simulation.clickhouse.adapter.ts`,
`ports/scenario-child-bootstrap.port.ts`, `ports/scenario-execution-runner.port.ts`,
`CancellationSubscriberPort`, `services/scenario-execution.service.ts`,
`AppScenarioRuntime` / `AppSimulationRuntime` / `AppScenarioFolderId`
(all in `platform/app/src/runtime/app/features/`), and 37 `export *` lines.

**Added:** `adapters/memory.scenario-tab-store.adapter.ts` (~70 lines, lifted out
of the registry service).

### The caller, so both doors can use the one facade

The app cannot serve REST today because `authorFor` hard-codes `label: "user"`
(`app/scenario.app.ts:137-139`). Widen the caller instead of duplicating the
stamping:

```ts
/** Who a write is attributed to, and on whose behalf it arrived. */
export interface ScenarioCaller {
  readonly id: string | null;
  readonly label: "user" | "api" | "cli";
}

export class ScenarioApp {
  private authorFor(by: ScenarioCaller): ScenarioActor {
    return { userId: by.id, label: by.label };
  }

  create(input: Omit<ScenarioCreateInput, "lastUpdatedById" | "actor">, by: ScenarioCaller): Promise<Scenario> {
    return this.dependencies.scenarios.create({
      ...input,
      lastUpdatedById: by.id,
      actor: this.authorFor(by),
    });
  }
}
```

REST then builds a `ScenarioCaller` from its header and calls the app — losing
`actorFromRequest`'s second job (`scenario-v1.api.ts:145-150`) and gaining the
`lastUpdatedById` stamp it currently drops. Both doors stamp both fields, once,
in one place. `scenario-v1.api.ts` drops from a service-holder to an app-holder,
and its `ports` type shrinks to `{ scenarios: () => ScenarioApp; platformUrl }`.

### The processor owns the pool, and the cycle goes with it

The two-phase `connect()` (P8) exists only because the processor reaches back into
the pool. Let the processor construct it:

```ts
export class ScenarioProcessorService {
  static create(options: {
    execution: ScenarioExecutionServiceContract;
    concurrency: number;
    cancellations: CancellationSubscriber;      // concrete; the port had one impl
    childProcesses: NodeScenarioChildProcessAdapter;
    metrics: ScenarioProcessorServiceMetricsPort;
  }): ScenarioProcessorService {
    return new ScenarioProcessorService(options, ScenarioExecutionPool.create(options.concurrency, /* runner */ undefined!));
  }
}
```

— except that `undefined!` is the same lie. The honest shape is for the pool to
take the work as a callback rather than a collaborator, which removes the field
and both `?.` sites:

```ts
export class ScenarioExecutionPool {
  static create(input: {
    concurrency: number;
    run: (job: ExecutionJobData) => Promise<void>;
    skipCancelled: (job: ExecutionJobData) => void;
  }): ScenarioExecutionPool { … }
}
```

`ScenarioProcessorService.create` then builds its own pool, passing
`(job) => this.execute(job)` and `(job) => this.skipCancelled(job)`. There is no
partially-constructed window, so `:184-188`'s throw and the two `?.` at `:147` and
`:225` all stop existing — and the QUEUED-orphan hole with them.
`ScenarioExecutionRunnerPort` (7 lines) and `ScenarioChildBootstrapPort` (22 lines)
lose their reason to exist. `ScenarioExecutionPoolPort` stays: the
`Unavailable…` null object at `scenario-execution-pool.service.ts:243` is a real
second implementation and `presets.ts:2310` genuinely picks between them.

### The simulation read path, without the re-parse layer

`SimulationService` should hold the two things the repository cannot: what to do
when a read spans suites, and the write commands. Everything else is the
repository's answer, already typed:

```ts
export class SimulationService extends SimulationServiceContract {
  // reads: return the repository's result directly — the mapper built it from
  // typed columns, and re-parsing 200 rows per page buys nothing the compiler
  // has not already checked.
  getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]> {
    return this.repository.findScenarioSetsData(input);
  }

  // writes: parse ON THE WAY IN, because these cross a queue and a process.
  queueRun(input: SimulationQueueRun): Promise<void> {
    return this.execution.queueRun(simulationQueueRunSchema.parse(input));
  }
}
```

Keep the eight write parses (`:189-218`) — those inputs cross a process boundary
and a schema is the only guarantee. Drop the sixteen read parses. That is 220
lines down to ~90, and one fewer validation pass per page of run data.

## 4. Keep list

- **`app/scenario.app.ts`** — the layout requires it, and it holds three real
  rules (attribution, the queued-run metadata envelope at `:287-316` including the
  deliberate secrets-beside-not-inside split, and `readSuiteRunData`). 24 of its 32
  methods being pass-throughs is the shape of a facade, not a defect. P1 and P2 are
  about it being *bypassed*, not about it existing.
- **`projections/`, `subscribers/`, `processes/`, `intents/`, `stores/eventing/`** —
  event-sourcing code correctly inside the server package. Right where it belongs.
- **`contract/`** — 84 non-test files outside the feature import it. The abstract
  service classes are the boundary that lets them do so without depending on the
  server package. Genuine inversion.
- **`SimulationRepository` and `NullSimulationRepository`** — two real
  implementations, and `presets.ts` picks between them on `clickhouseEnabled`
  (`platform/app/src/runtime/app/features/simulation.ts:90-92`).
- **`SimulationRunStateRepository`** — ClickHouse plus memory
  (`repositories/memory/memory.simulation-run-state.repository.ts:7`). Real
  polymorphism.
- **The seven cross-package ports** in the P7 table. Each has exactly one
  implementation and every one of them lives in `platform/app` — the feature must
  not reach into the app, which is what the port is for. `ScenarioHttpPort`
  especially: it is the SSRF-safe egress boundary
  (`scenario-http.port.ts:11-17`), and collapsing it would let the feature fall
  back to a native fetch.
- **The 19 real adapters.** `serialized-{http,code,workflow,prompt-config}-agent`
  is an open set — one adapter per target type, and a new type touches nothing else.
  That is correct, not duplication.
- **`repositories/clickhouse/simulation-clickhouse.repository.ts` (1,592 lines).**
  It is a hot correctness path, `TenantId` scoping is present on every query, the
  partition-key filter is applied through `buildDateFilter` at nine sites, and it is
  inside its quality ceiling. Fix P13's three inlined copies; leave the length alone.
- **`clickhouse.stalled-simulation-run.repository.ts:45`'s missing `TenantId`** —
  a documented cross-tenant sweep (`:31-36`), deliberate.
- **`web/`** — 79 published symbols, 48 used across 33 consumers. A component
  library with a normal export surface. Worth trimming eight internal-only modules
  from `web/src/index.ts` (`media-parts`, `scenario-criteria-input`,
  `scenario-inline-tags-input`, `simulation-chip`, `simulation-results`,
  `sort-scenario-sets`, `thinking-indicator`, `use-sequential-audio-playback`)
  and nothing more.

## 5. Cost and order

Seven commits, smallest risk first, each leaving the suite green.

1. **Comments** (P14). Delete the six dead file references, move the four incident
   narratives to ADRs, fix the misnamed path at
   `clickhouse.simulation-run-state.repository.ts:229`. Correct the
   `readSuiteRunData` docstring at `scenario.app.ts:332-344` to say what the code
   does. No behaviour change.
2. **`qualifiedDedupPredicate`** (P13). Replace the three hand-inlined copies at
   `simulation-clickhouse.repository.ts:744-750, :809-814, :1573-1579` with the call
   the file already makes twice. Assert the generated SQL is byte-identical first.
3. **`cancelBatchRun`** (P11) and **repository naming** (P12). Pass the already-read
   run status into `cancelJob` instead of re-reading; rename 25 `get*` repository
   methods to `find*`. Both are contained inside the package.
4. **Extract `MemoryScenarioTabStoreAdapter`** (P9). Five branches and ~70 lines out
   of the service; `ScenarioTabStorePort` gains its second implementation.
   `presets.ts:2316` picks the adapter instead of passing `null`.
5. **Pool and processor** (P8). The pool takes callbacks, the processor owns it,
   `connect()` and the three inconsistent guards go, and with them the cancelled-run
   QUEUED orphan. Delete `ScenarioExecutionRunnerPort`, `ScenarioChildBootstrapPort`,
   `CancellationSubscriberPort`. **Biggest correctness win; needs the
   `execution-pool` and `scenario-processor` unit tests to be rewritten against the
   new constructor.**
6. **REST onto `ScenarioApp`** (P1, P2). Widen `ScenarioCaller` with a label, move
   `scenario-v1.api.ts`, `simulation-run.api.ts` and `scenario-event.api.ts` onto
   the app, delete `actorFromRequest`, route the four raw suite-read call sites
   through `readSuiteRunData`. Delete `ScenarioExecutionService` (P4) and fold its
   five delegations into the app. **Behavioural change: REST updates begin stamping
   `lastUpdatedById`. Spec it.**
7. **Shrink the boundary** (P3, P5, P6, P10). Drop the sixteen read parses from
   `SimulationService`; collapse `PrismaScenarioAdapter`, `SimulationClickHouseAdapter`,
   `AppScenarioRuntime` and `AppSimulationRuntime` into `presets.ts`; merge
   `ScenarioFolderIdPort` into `ScenarioIdPort`; replace the 37 `export *` lines in
   `index.ts` with the ~50 symbols that are imported.

Commits 1–4 are safe in any order. 5 before 6, because 6 touches the same
transports. 7 last, because it is the one that breaks external imports.

## 6. Blast radius

**24 files outside the feature import `@langwatch/scenario-server`** (15 non-test),
concentrated in three places: `platform/app/src/runtime/` (5 files),
`platform/app/src/server/` (7), and `apps/api/src/` (3).

The 46 symbols they use: `ScenarioApp`, `ScenarioTrpcApi`, `ScenarioTrpcContext`,
`ScenarioTrpcPorts`, `PrismaScenarioAdapter`, `SimulationClickHouseAdapter`,
`SimulationReadClient`, `SimulationExecutionPort`, `SimulationWindowedReadPort`,
`SimulationWindowedReadInput`, `SimulationRunStateStoreAdapter`,
`SimulationRunMetricsStoreAdapter`, `SimulationStalledRunAdapter`,
`SimulationStalledRun`, `SimulationProcessingPipelineAdapter`,
`ScenarioExecutionPoolService`, `UnavailableScenarioExecutionPoolService`,
`ScenarioExecutionService`, `ScenarioExecutionPrefetcherService`,
`ScenarioFailureHandlerService`, `ScenarioProcessorService`,
`ScenarioProcessorServiceMetricsPort`, `ScenarioTabRegistryService`,
`ScenarioClockPort`, `ScenarioIdPort`, `ScenarioFolderIdPort`,
`ScenarioSecretCipherPort`, `ScenarioHttpPort`, `RedisScenarioTabStoreAdapter`,
`RedisCancellationPublisherAdapter`, `RedisCancellationSubscriberAdapter`,
`UnavailableCancellationPublisherAdapter`, `NodeScenarioChildProcessAdapter`,
`SerializedCodeAgentAdapter`, `createScenariosRestApp`,
`createScenarioEventsRestApp`, `createScenarioRunExportRestApp`,
`createSimulationRunsRestApp`, `ScenarioRunPlatformUrlBuilder`,
`ScenarioRunExportPort`, `InlineMediaExtraction`, `ComputeRunMetricsCommand`,
`COMPUTE_METRICS_RETRY_DELAY_MS`, `FinishRunCommand`, `BACKFILL_STALE_THRESHOLD_MS`,
`SIMULATION_RUN_EXECUTION_PROCESS_NAME`, `simulationRunExecutionPM`,
`executeScenarioChild`, `formatScenarioChildError`, `flushScenarioOtelTraces`,
`decodeScenarioLogContext`, `ScenarioLogContext`.

Commit 7 removes `PrismaScenarioAdapter`, `SimulationClickHouseAdapter` and
`ScenarioFolderIdPort` from that list — three imports in
`platform/app/src/runtime/app/features/{scenario,simulation}.ts` and one in
`presets.ts`. Commit 5 removes `RedisCancellationSubscriberAdapter` and
`NodeScenarioChildProcessAdapter` from `platform/app/src/runtime/worker/`. Nothing
in `apps/api/` is touched by any commit: it imports only `ScenarioTrpcApi`,
`ScenarioTrpcContext`, `ScenarioTrpcPorts` and the four REST app factories, whose
signatures do not change.

`@langwatch/scenario-contract` is imported by **84 non-test files outside the
feature** — 17 in `packages/features/suite/web/`, the rest across
`platform/app/src/components/agent-testing/`, `components/suites/`, `hooks/` and
`server/`. No commit above changes a contract signature.
