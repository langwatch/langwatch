# experiment — cleanup review

Follows [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md);
worked example is [`dataset.md`](./dataset.md).

## 1. What is there now

| Package        | Non-test files      | Lines  |
| -------------- | ------------------- | ------ |
| `server/src`   | 40                  | 7,106  |
| `contract/src` | 14                  | 2,402  |
| `web/src`      | 45 (+44 test files) | 13,906 |

**33 operations**, declared at least four times each; the execution four are
declared eight times.

```
  transport/api-trpc/experiment.api.ts   19 procedures   1,046 lines
  transport/api-rest/experiment.api.ts    3 routes         346 lines
        │                     └── 342 of those 1,046 lines are cross-service WRITE rules
        │                         that never reach the app (P2)
        ▼
  app/experiment.app.ts        ExperimentApp        33 members
        │                       ← 25 one-line pass-throughs, 7 hold rules,
        │                         1 getter that hands the service out whole (P1)
        ▼
  contract/experiment.service.ts   abstract ExperimentService   33 signatures
        ▼
  services/experiment.service.ts   ExperimentService            33 methods
        │                          ← real rules: slug allocation, reference
        │                            checking, workbench versioning. Not a layer.
        ├──▶ ports/experiment-execution.port.ts        (4)   ← optional (P3)
        ├──▶ ports/experiment-workbench-updates.port.ts (1)  ← optional (P3)
        ├──▶ ports/experiment-clickhouse.port.ts       (1)   ← 1 impl, same pkg (P5)
        └──▶ ports/experiment-dspy-retention.port.ts   (1)   ← impl in platform/app
        ▼
  adapters/postgres.experiment.adapter.ts   PostgresExperimentAdapter
        │   179 lines, 1 static method — 89 of them restate two ports
        │   structurally, inline (P4)
        ▼
  repositories/
    experiment.repository.ts        abstract  23 methods → prisma/ (531 lines)
    experiment-run.repository.ts    abstract   5 methods → clickhouse/ (770 lines)
    experiment-dspy.repository.ts   abstract   3 methods → clickhouse/ (312 lines)
    experiment-run-state.repository.ts interface 2      → clickhouse/ + memory/

  Event sourcing (correct, keep):
    projections/  2 files, 484 lines    stores/  2 files, 110 lines
    adapters/eventing.*  4 files, 533 lines

  Wrapped outside by platform/app/src/runtime/app/features/experiment.ts:
    AppExperimentRuntime — 1 method, one-line delegation, options type is an
    identity alias (P6).
```

**Detectors.** `no-identity-function-ts` / `no-same-name-delegation-ts` produce
**one** hit in the whole feature —
`services/experiment.service.ts:182` (`getBySlugOrId`). The arrow-property
spelling the rule cannot see has **zero** hits inside the package; it has four
just outside it, at `platform/app/src/runtime/app/features/experiment-eventing.ts:33-40`.
Neither `overengineering-baseline.json` nor `service-quality-baseline.json`
lists an experiment site.

The feature is in decent shape. Nine of nine domain errors are already
`HandledError` (`contract/src/experiment.errors.ts`), the service holds no
database client, and the ClickHouse queries are correct. The problems are
concentrated in the facade, the transport, and the composition seams.

## 2. Problems

### P1 — The app facade is 25/33 pass-throughs and is bypassed for a third of the contract (R3)

`app/experiment.app.ts` is 462 lines and 33 public members. Twenty-five bodies
are one line, and twenty-four of those forward to the same method name:

```
142 list · 147 getPage · 152 getById · 157 tryGetById · 162 getBySlug
174 tryGetBySlug · 186 tryGetBySlugAndType · 193 tryGetIdBySlug · 206 isActive
211 getBySlugOrId · 216 tryGetLatest · 221 findNextDraftName · 226 save
262 listRuns · 267 tryGetRun · 278 getRunsPageBySlug · 316 listDspyRuns
321 getDspyStep · 328 getWorkbenchState · 333 listWorkbenchVersions
415 getDatasets (→ dataset.getByIds) · 422 renameDataset · 429 copyDataset
442 getTenantEmitter · 447 cleanupTenantEmitter
```

Seven hold real rules and earn their place: `archive` (239, the workflow +
monitor cascade), `withRunAggregates` (293, the `NO_RUNS` default),
`tryGetWorkflow` (401, the `WorkflowNotFoundError` catch), and the four
actor-stamping workbench writes (338, 357, 371, 382).

The layout requires this class, so the pass-throughs are not by themselves a
violation. What is a violation is the escape hatch beside them:

```ts
// app/experiment.app.ts:135
get experimentService(): ExperimentService {
  return this.dependencies.experiments;
}
```

Ten of the contract's 33 operations — `findOrCreateForWorkflow`,
`getRunAggregates`, `getRunsPage`, `startExperimentRun`, `recordTargetResult`,
`recordEvaluatorResult`, `completeExperimentRun`, `upsertDspyStep`,
`listDspySteps`, `recordWorkbenchRunResults` — are not on `ExperimentApp` at
all. They are reached through this getter from **eleven non-test call sites**:

| Site                                                                  | What it takes                                 |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `platform/app/src/server/routes/evaluations-legacy.ts:1534,1617`      | `startExperimentRun`, `completeExperimentRun` |
| `platform/app/src/server/routes/evaluations-legacy.ts:1493,1552,1581` | the service whole                             |
| `platform/app/src/server/routes/experiments-v3.ts:652,773`            | the service whole                             |
| `platform/app/src/server/routes/misc.ts:481,662`                      | the service whole                             |
| `platform/app/src/server/routes/langy-ui-actions.ts:136`              | the service whole                             |
| `platform/app/src/server/api-router.ts:335`                           | the service whole                             |

So the facade's own docblock claim — "the one typed thing a transport is given"
— is untrue for the run-execution half of the feature. The getter's comment
(lines 126-134) is honest about this and names the four callers; it is now
eleven.

### P2 — The writes with cross-service rules live in the tRPC transport, not the app (R3)

`app/experiment.app.ts:11-25` says the app holds "what a door would otherwise
have to know, and did". Four tRPC procedures say otherwise — **342 of the
transport's 1,046 lines (33%)** are orchestration the REST door cannot reach:

| Procedure                  | Lines                                                | What it orchestrates                                                                                                                |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `copy`                     | `transport/api-trpc/experiment.api.ts:841-951` (111) | source-project permission probe, V2/V3 branch, workflow copy, version save, experiment save                                         |
| `saveExperiment`           | `:258-355` (98)                                      | draft naming, workflow lookup/creation, **dataset renaming to follow the experiment name** (293-315), version save, experiment save |
| `getAllForEvaluationsList` | `:631-709` (79)                                      | list + aggregate + workflow join                                                                                                    |
| `saveAsMonitor`            | `:519-572` (54)                                      | DSL parse, evaluator extraction, monitor upsert                                                                                     |

`saveExperiment:293-315` walks `input.dsl.nodes`, filters dataset nodes, reads
them through the app and renames each one whose name starts with the old
experiment name. That is a product rule about what renaming an experiment means.
It exists in exactly one door.

This is the same rule as P1 pointing the other way: the facade forwards reads
and holds no writes, and the writes that need it are upstairs.

### P3 — Two dependencies are optional; production supplies both (R5)

Declared optional twice over:

- `services/experiment.service.ts:93` `execution?: ExperimentExecutionPort`
- `services/experiment.service.ts:104` `updates?: ExperimentWorkbenchUpdatesPort`
- `adapters/postgres.experiment.adapter.ts:70` `execution?: {...}`
- `adapters/postgres.experiment.adapter.ts:147` `updates?: ExperimentWorkbenchUpdatesPort`

The production composition supplies both:

```ts
// platform/app/src/server/app-layer/presets.ts:1477-1488
AppExperimentRuntime.create({
  ...
  execution: AppExperimentEventingAdapter.create(() => commands.experimentRuns).build(),
  updates: AppExperimentWorkbenchUpdatesAdapter.create(broadcast),
}).build(),
```

The only composition that omits them is `createTestApp` (`presets.ts:3596-3611`).
The cost is paid in code that ships:

```ts
// adapters/unavailable-experiment-execution.adapter.ts:11-15
private unavailable(): never {
  throw new Error("Experiment execution is not configured for this application instance");
}
```

A plain `Error` — correctly plain, since it is a misconfiguration — reached from
four methods (17, 21, 25, 29), defaulted in two places
(`services/experiment.service.ts:164`, `adapters/postgres.experiment.adapter.ts:176`),
so that one test preset can skip two lines. `NoopExperimentWorkbenchUpdatesAdapter`
is the same trade for the broadcast: a workbench save in the test app silently
publishes nothing.

### P4 — `PostgresExperimentAdapterOptions` restates two ports structurally, inline (R8)

`adapters/postgres.experiment.adapter.ts` is 179 lines. **Eighty-nine of them
are type literals that already exist as ports in the same package:**

- lines 26-41 restate `ExperimentEventingClickHouseClient`
  (`ports/experiment-clickhouse.port.ts:5-20`) — `insert`, `query`,
  `clickhouse_settings`, all of it
- lines 70-142 restate all four `ExperimentExecutionPort` signatures
  (`ports/experiment-execution.port.ts:13-18`), expanding
  `StartExperimentRunInput` / `RecordTargetResultInput` /
  `RecordEvaluatorResultInput` / `CompleteExperimentRunInput` back into raw
  object literals with their `targets` arrays spelled out twice (77-87, 103-113)

Every field is now declared in the contract schema, in the port, and here. The
duplication has already drifted: the port says `StartExperimentRunInput`, the
literal says `metadata?: Record<string, string | number | boolean> | null`. A
`z.infer` change reaches the first two and not the third.

`AppExperimentEventingAdapter` (`platform/app/src/runtime/app/features/experiment-eventing.ts:22-43`)
satisfies this structurally and never extends `ExperimentExecutionPort`, so the
abstract class buys nothing at that seam either.

### P5 — `ExperimentClickHousePort` has one implementation, in the same package (R4)

| Port                                                                              | Implementations                                                               | Verdict                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `ExperimentDspyRetentionPort` (`ports/experiment-dspy-retention.port.ts:1`)       | 1, in `platform/app` (`runtime/app/features/experiment.ts:11`)                | **Keep** — cross-package inversion               |
| `ExperimentWorkbenchUpdatesPort` (`ports/experiment-workbench-updates.port.ts:3`) | 2 — noop in-package, `AppExperimentWorkbenchUpdatesAdapter` in `platform/app` | **Keep**                                         |
| `ExperimentExecutionPort` (`ports/experiment-execution.port.ts:13`)               | 1 in-package (refuses), 1 structural in `platform/app`                        | **Keep the port, drop the optionality** — see P3 |
| `ExperimentClickHousePort` (`ports/experiment-clickhouse.port.ts:28`)             | 1 — `ExperimentClickHouseAdapter`, same package                               | **Delete**                                       |

`ExperimentClickHouseAdapter` (`adapters/experiment-clickhouse.adapter.ts:12-27`)
is 27 lines whose whole job is to turn `(tenantId) => Promise<Client>` into an
object with a `resolveClient` method. Its own consumer proves the abstraction is
not carrying weight:

```ts
// adapters/experiment-run-state-store.adapter.ts:33
const clickhouse: ExperimentClickHousePort = { resolveClient: options.resolveClient };
```

An object literal satisfies the abstract class, so the class is a type alias for
`{ resolveClient }`. The comment above it (lines 21-27) records the incident
this caused: the previous call site passed a bare function where the repository
declared the port, and "the first read would have thrown".

### P6 — Two composition seams build the same fold store; one has a dead discriminant (R3)

```ts
// adapters/eventing.experiment-run-processing.adapter.ts:46-84  — used by pipelineRegistry.ts:1511
ExperimentEventingAdapter.createStateRepository({
  resolveClient,
  clickhouseEnabled,
  defaultRetentionDays,
});
ExperimentEventingAdapter.createStateFoldStore(repository); // :80-84, pure delegation

// adapters/experiment-run-state-store.adapter.ts:20-44  — used by replay-runtime.adapter.ts:104
ExperimentRunStateStoreAdapter.create({
  type: "clickhouse",
  resolveClient,
  defaultRetentionDays,
}).createFoldStore(); // :41-43, pure delegation
```

Both end at `createExperimentRunStateFoldStore(new ExperimentRunStateRepositoryClickHouse(...))`.
`options.type` is declared at line 30 and **never read** — a discriminant with
one arm that nothing branches on.

`ExperimentEventingAdapter` is a static-only class of four factories, three of
which are one-line forwards (`createItemStore` 70-78, `createStateFoldStore`
80-84, `createStateRepository` 46-57 adds the enabled/memory branch).

Outside the package, `AppExperimentRuntime`
(`platform/app/src/runtime/app/features/experiment.ts:27-37`) is pure wiring:

```ts
export type AppExperimentRuntimeOptions = PostgresExperimentAdapterOptions;  // :9  identity alias
build(): ExperimentService { return PostgresExperimentAdapter.create(this.options); }  // :34-36
```

### P7 — Identity type aliases and wildcard exports (R8)

```ts
// adapters/eventing.experiment-run-processing.adapter.ts:40-43
export type ExperimentRunEventingStateRepository = ExperimentRunStateRepository;
export type ExperimentRunEventingIdLookup = ExperimentIdLookup;
export type ExperimentRunEventingResultRecord = ClickHouseExperimentRunResultRecord;
export type ExperimentRunEventingState = ExperimentRunStateData;
```

Four renames, no narrowing. All four are re-exported from `server/src/index.ts:7-10`
and imported by `platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:161-166`
under the alias, so the real name is invisible to the only consumer.

`contract/src/index.ts` is **13 `export *` lines**. The contract publishes **216
symbols; 61 have zero users outside the contract package** — including
`InvalidWorkbenchStateError`, `EXPERIMENT_TYPES`, `WORKBENCH_ACTOR_LABELS`,
`createInitialDataset`, and every `dSPy*Schema`.

`server/src/index.ts:1` is `export * from "./adapters/postgres.experiment.adapter"`;
the two symbols it publishes have one external consumer each.

### P8 — `processes/` is `utils/`, and one of its files is in an import cycle (R2, R8)

Four files, 122 lines, none of which is a process:

- `processes/experiment-run-duration.process.ts:5` — `normalizeDurationMs`, a
  two-line clamp. Two callers, both projections. Correct as a shared utility;
  wrong directory.
- `processes/experiment-run-key.process.ts:10,14` — `makeExperimentRunKey` /
  `parseExperimentRunKey`. Six callers. Correct as a shared utility.
- `processes/experiment-run-id.process.ts:50-52` — one function wrapped in a
  namespace object:
  ```ts
  export const IdUtils = { generateDeterministicResultId } as const;
  ```
  The name collides with `IdUtils` in
  `packages/features/trace/server/src/services/span-record-identity.rules.ts:105`,
  which `trace/server/src/index.ts:88` exports. Two different `IdUtils` in one
  repo, neither namespaced by feature.
- `processes/experiment-run-event-guards.process.ts` — five type guards that
  import six types **from** `adapters/eventing.experiment-run-events.adapter.ts`
  (lines 2-9), which then re-exports all five **back** at lines 187-193. A
  circular import whose only purpose is to keep the guards in a directory they
  do not belong in. No non-test consumer imports them from `processes/`;
  `isTraceMetricsComputedEvent` (line 29) has no consumer at all outside that
  re-export.

### P9 — Repository method names, and a ClickHouse repository that queries Postgres (R1)

R1: repositories are `findAll` / `findById`; services are `getAll` / `getById`.
Eleven repository methods break it:

| File:line                                                  | Method                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `repositories/experiment.repository.ts:55`                 | `getBySlugOrId`                                                     |
| `repositories/experiment.repository.ts:56`                 | `tryGetRowState`                                                    |
| `repositories/experiment.repository.ts:83`                 | `getWorkbenchState`                                                 |
| `repositories/experiment.repository.ts:119`                | `getWorkbenchVersion`                                               |
| `repositories/experiment-run.repository.ts:13,14,17,21,22` | `list`, `getAggregates`, `getPage`, `tryGet`, `getWorkflowVersions` |
| `repositories/experiment-dspy.repository.ts:10,11`         | `list`, `tryGet`                                                    |

`getBySlugOrId` is the one detector hit in the feature, and the name is the
symptom of something worse. Every other lookup on the service parses first:

```ts
// services/experiment.service.ts:169-171
async getById(input: ExperimentLookup): Promise<Experiment> {
  const lookup = experimentLookupSchema.parse(input);
```

`getBySlugOrId` does not:

```ts
// services/experiment.service.ts:182-184
getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment> {
  return this.options.repository.getBySlugOrId(input);
}
```

The REST route at `transport/api-rest/experiment.api.ts:272-275` takes
`c.req.param("slug")` and hands it through `ExperimentApp:211` to that method —
transport to SQL with no validation on the path, and the raise lives in the
repository rather than the service.

Separately, `repositories/clickhouse/clickhouse.experiment-run.repository.ts`
holds a Prisma slice and runs a Prisma query:

```ts
:34    type ExperimentRunVersionDatabase = Pick<PrismaClient, "workflowVersion">;
:549   const rows = await this.options.database.workflowVersion.findMany({ ... });
```

A file named `clickhouse.*` that reads Postgres. R1 permits a repository to
speak to a datastore; it does not make one repository the right home for two.
(The query itself is tenant-scoped — `where: { projectId, ... }` — so this is a
naming and cohesion problem, not a correctness one.)

### P10 — Eight knowable failures reach the client as `TRPCError` prose (R6)

The contract's own errors are exemplary; the transport does not use them:

| `transport/api-trpc/experiment.api.ts` | Message                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `:287`                                 | `"Workflow not found"`                                                     |
| `:551`                                 | `"Experiment is not ready to be saved as a monitor"`                       |
| `:594`                                 | `"Either experimentId or experimentSlug must be provided"`                 |
| `:862`                                 | `"You do not have permission to manage evaluations in the source project"` |
| `:884`, `:892`                         | `"Experiment workflow not found"`                                          |
| `:926`                                 | `"Failed to create workflow"`                                              |

Each is a named cause the caller can act on, so each should be a `HandledError`
with a `code`, a `codes.ts` entry and a `presentation.ts` entry. As written the
customer sees the raw string and the client has nothing to key on.

`:771-772` is the one surviving `instanceof` ladder —
`error instanceof ExperimentDspyStepNotFoundError` — where the sibling
`mapExperimentError` (`:219-227`) already does the same job on `error.code`.
`mapExperimentError` itself is fine and correctly documented: two codes that
have to change shape, everything else travels on.

### P11 — Four comments name files that do not exist (R7)

- `adapters/eventing.experiment-run-commands.adapter.ts:14` — "Event data
  schemas (in events.ts) are the single source of truth". There is no `events.ts`;
  the file was renamed to `eventing.experiment-run-events.adapter.ts`.
- `contract/src/experiment-workbench-persistence.ts:17` — "Uses
  targetRowMetadataSchema from types.ts". No `types.ts` in the contract package;
  the schema is at `experiment-workbench.ts:431`.
- `contract/src/experiment-workbench-persistence.ts:30` — "Reuses schemas from
  types.ts". Same.
- `contract/src/experiment-workbench.ts:744-745` — an incident narrative naming
  `EvaluationsV3Table.tsx`, `DatasetSection/TableCell.tsx` and "the #3441 sweep".
  Two paths in `platform/app` that a contract package must not know about, plus
  a superseded design. Belongs in an ADR or nowhere.

### P12 — The spec binds nothing

`specs/experiment-service.feature` has **6 scenarios and 0 binding tags**. Per
CLAUDE.md, `check-feature-parity.ts` only counts scenarios carrying `@unit`,
`@integration`, `@e2e` or `@regression`, so this file reports
`0/0 scenarios bound` / `✓ all bound` and reads green while enforcing nothing.
Scenario 4 ("Archive does not cross persistence boundaries") describes exactly
the cascade at `app/experiment.app.ts:239-260`, which the cleanup below moves;
it should be tagged before anything else changes.

## 3. What it should look like

```
contract/src/
  index.ts                              ~55   named exports, not 13 export *
  experiment.service.ts                 ~99   unchanged
  experiment.errors.ts                 ~124   unchanged — already correct
  (61 unused exports dropped or made internal)

server/src/
  app/experiment.app.ts                ~340   32 members: the 25 forwards stay
                                              (the layout requires the facade),
                                              PLUS saveFromWizard, copy,
                                              publishAsMonitor, and the ten
                                              contract operations the getter
                                              used to leak. No `experimentService`.
  services/
    experiment.service.ts              ~430   experiments · slugs · workbench
    experiment-run.service.ts          ~120   runs · aggregates · execution dispatch
    experiment-dspy.service.ts         ~110   steps · runs summary
  ports/
    experiment-execution.port.ts        ~18   kept, no longer optional
    experiment-workbench-updates.port.ts ~12  kept — 2 impls
    experiment-dspy-retention.port.ts    ~3   kept — impl in platform/app
  adapters/
    eventing.experiment-run-commands.adapter.ts
    eventing.experiment-run-events.adapter.ts   ← guards move in here
    eventing.experiment-run-event-types.adapter.ts
    eventing.experiment-run-processing.adapter.ts  ~110  one composition seam
  repositories/                                edit names only
    experiment.repository.ts           ~124   findBySlugOrId · tryFindRowState ·
                                              findWorkbenchState · findWorkbenchVersion
    experiment-run.repository.ts        ~26   findAllByExperiment · findAggregates ·
                                              findPage · tryFindById
    experiment-workflow-version.repository.ts ~20  the Prisma read, moved out of
                                                   clickhouse.experiment-run.repository.ts
    experiment-dspy.repository.ts       ~12   findAll · tryFindById
    clickhouse/ · prisma/ · memory/
  projections/  stores/  transport/            unchanged
  utils/
    experiment-run-key.ts               ~24   was processes/
    experiment-run-duration.ts           ~7   was processes/
    experiment-run-id.ts                ~48   was processes/, no IdUtils wrapper
  index.ts                              ~60   no export *

DELETED: ports/experiment-clickhouse.port.ts · adapters/experiment-clickhouse.adapter.ts
         adapters/experiment-run-state-store.adapter.ts
         adapters/unavailable-experiment-execution.adapter.ts
         adapters/noop-experiment-workbench-updates.adapter.ts
         adapters/postgres.experiment.adapter.ts
         processes/experiment-run-event-guards.process.ts
         platform/app/src/runtime/app/features/experiment.ts (AppExperimentRuntime half)

≈37 files, ≈6,300 server lines. Six composition classes become one.
```

### The composition — required dependencies, one seam

`PostgresExperimentAdapter` and `AppExperimentRuntime` both exist to call
`ExperimentService.create`. Give the service the constructor and delete both:

```ts
export class ExperimentService extends ExperimentServiceContract {
  static create(options: {
    database: ExperimentDatabase & Pick<PrismaClient, "workflowVersion">;
    resolveClickHouseClient: ExperimentClickHouseResolver; // the function, no port
    dspyRetention: ExperimentDspyRetentionPort;
    execution: ExperimentExecutionPort; // required (P3)
    updates: ExperimentWorkbenchUpdatesPort; // required (P3)
    tupleParam: (values: string[]) => unknown;
    runHistoryTelemetry: ExperimentRunHistoryTelemetry;
    slugify: (value: string) => string;
    newId: () => string;
    now?: () => Date;
    references: ExperimentReferences;
  }): ExperimentService;
}
```

`resolveClickHouseClient` travels as the resolver function it already is —
`ExperimentClickHouseAdapter` was only converting it back and forth, and the one
object literal at `experiment-run-state-store.adapter.ts:33` proves nothing
needed the class. The 89 restated lines in
`PostgresExperimentAdapterOptions` (P4) become the port and contract types they
were copied from.

`presets.ts:1477` becomes `ExperimentService.create({ ... })` with the same
arguments; `presets.ts:3596` (the test app) must now pass `execution` and
`updates`, which is the point — two lines of test wiring in exchange for four
production `never` throws and two silent no-ops that ship.

### The transport's writes move into the app

```ts
export class ExperimentApp {
  /** The wizard save: names the draft, finds or creates its workflow, keeps its
   *  datasets named after it, writes the version, then saves the experiment. */
  async saveFromWizard(
    input: {
      projectId: string;
      experimentId?: string;
      workbenchState: unknown;
      dsl: StudioWorkflow;
      commitMessage?: string;
    },
    by: ExperimentCaller,
  ): Promise<Experiment>;

  /** Copies an experiment into another project, with its workflow and,
   *  optionally, its datasets. The caller has already been authorised for BOTH
   *  projects — the app does not read a session. */
  async copyTo(input: {
    experimentId: string;
    sourceProjectId: string;
    targetProjectId: string;
    copyDatasets?: boolean;
  }): Promise<{ experiment: Experiment; workflow: { id: string } }>;

  /** Publishes an experiment's real-time configuration as a monitor. */
  async publishAsMonitor(input: { projectId: string; experimentId: string }): Promise<void>;
}
```

`transport/api-trpc/experiment.api.ts` drops from 1,046 to roughly 700 lines and
holds parsing, the permission probe on the _second_ project (which is genuinely
transport-shaped, `:852-865`), and the call. The dataset-renaming rule stops
being reachable from one door only.

The seven raw `TRPCError` throws that survive become handled errors:

```ts
export class ExperimentWorkflowMissingError extends NotFoundError {
  declare readonly code: "experiment_workflow_not_found";
  constructor(experimentId: string) {
    super("experiment_workflow_not_found", "Experiment workflow", experimentId, {
      meta: { experimentId },
    });
    this.name = "ExperimentWorkflowMissingError";
  }
}
```

with `codes.ts` and `presentation.ts` entries in the same change.

### The guards move to the file whose union they narrow

`processes/experiment-run-event-guards.process.ts` moves verbatim into
`adapters/eventing.experiment-run-events.adapter.ts`, below
`ExperimentRunProcessingEvent`. The six-type import and the five-symbol
re-export both disappear, and so does the cycle. `IdUtils` becomes a plain
`export function generateDeterministicExperimentResultId`, ending the name
collision with `trace/server`.

## 4. Keep list

- **`projections/` and `stores/`.** Event sourcing inside the server package is
  correct. `experiment-run-state.projection.ts` (311 lines) and
  `experiment-run-result-storage.projection.ts` (173) stay where they are.
- **Every ClickHouse query.** Checked against
  `dev/docs/best_practices/clickhouse-queries.md`: `TenantId` is the first
  predicate in all nine (`clickhouse.experiment-run.repository.ts:213, 266, 279,
284, 338, 344, 366, 382, 433, 438, 586, 593`), dedup uses the IN-tuple form
  (`:281-287, 371-388, 435-441, 590-596`) not `LIMIT 1 BY`, the item and trace
  reads carry `OccurredAt` partition bounds on **both** the outer and inner
  scopes (`:369-370, 385-386, 588-589, 593-595`), and sort keys use
  `argMax(CreatedAt, UpdatedAt)` (`:211`) rather than `max()`. Nothing to change.
- **`contract/src/experiment.errors.ts`.** All nine are `HandledError`
  subclasses with stable codes, correct `fault` (note `InvalidExperimentConfigurationError:46`
  correctly declares `fault: "platform"` for its 400), and useful `meta`. This
  is the model the transport should be following.
- **The `web/` package.** 45 modules, one statistical concern each
  (`bt-leaderboard`, `bootstrap-ci`, `pareto`, `judge-bias`, `sample-adequacy`,
  `score-separation`, `comparability`), 44 test files, and
  `batch-evaluation-results.types.ts` has 19 importers so it is genuinely
  shared. An open set whose members vary independently — the category
  `overengineering.md` explicitly protects.
- **`ExperimentRunStateRepositoryMemory`** (14 lines) and
  `NullExperimentIdLookupRepository` — real second implementations for the
  no-ClickHouse deployment, branched on at
  `eventing.experiment-run-processing.adapter.ts:51-56, 63-67`.
- **`services/experiment.service.ts`.** 749 lines, but the rules are real: slug
  allocation with unique-conflict retry (`:234-262, 550-596, 723-745`), workbench
  reference checking across five features (`:663-721`), version restore
  semantics (`:506-529`). It does not appear in `overengineering-baseline.json`,
  and it holds no database client. Split it three ways for size, not for shape.
- **The `ExperimentApp` pass-throughs themselves.** The layout requires the one
  facade and `layer-class` exempts it. What goes is the getter beside them.

## 5. Cost and order

Six commits, each leaving the suite green.

1. **Tag the spec.** Add `@unit`/`@integration` to the six scenarios in
   `specs/experiment-service.feature` and `@scenario` annotations on the tests
   that already cover them. Nothing is enforced until this lands, and every
   commit below changes code those scenarios describe. Zero risk.
2. **Comments and names.** Fix the four stale paths (P11), rename the eleven
   repository methods (P9), drop the `IdUtils` wrapper, move `processes/` to
   `utils/`, move the event guards into the events adapter and delete the cycle
   (P8). Mechanical, type-checked, no behaviour.
3. **The seven `TRPCError` throws become `HandledError`s** (P10), with
   `codes.ts` + `presentation.ts` entries and the `instanceof` at `:771` folded
   into `mapExperimentError`. Biggest customer-visible win; no structural risk.
4. **Collapse the composition.** Delete `ExperimentClickHousePort`,
   `ExperimentClickHouseAdapter`, `PostgresExperimentAdapter`,
   `ExperimentRunStateStoreAdapter` and the `AppExperimentRuntime` wrapper; give
   `ExperimentService.create` the real constructor; make `execution` and
   `updates` required and delete the two fallback adapters (P3, P4, P5, P6).
   Touches `presets.ts:1477` and `:3596`, `replay-runtime.adapter.ts:104`,
   `pipelineRegistry.ts:1511`. This is the commit that needs care.
5. **Move the four write orchestrations into `ExperimentApp`** and give the app
   the ten operations the getter was leaking; delete `get experimentService`
   and update the eleven call sites (P1, P2). Largest diff, spread across
   `evaluations-legacy.ts`, `experiments-v3.ts`, `misc.ts`,
   `langy-ui-actions.ts`, `api-router.ts`.
6. **Shrink the export surface.** Named exports in both `index.ts` files; drop
   the four identity aliases and the 61 unused contract exports (P7).

## 6. Blast radius

**12 files outside the feature import `@langwatch/experiment-server`** (3 in
`apps/api`, 9 in `platform/app`). **33 import `@langwatch/experiment-contract`.
13 import `@langwatch/experiment-web`.**

Symbols taken from `experiment-server`:

| Symbol                                                                                                                                      | External files                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `handledErrorEnvelopeSchema` and 19 sibling REST schemas                                                                                    | 13 (re-exported wholesale by `apps/api/src/index.ts:102-125`) |
| `createExperimentsRestApp`                                                                                                                  | 11                                                            |
| `ExperimentEventingAdapter`                                                                                                                 | 6                                                             |
| `ExperimentApp`                                                                                                                             | 5                                                             |
| `EXPERIMENT_RUN_EVENT_TYPES`                                                                                                                | 4                                                             |
| `ExperimentTrpcApi`, `ExperimentTrpcContext`, `ExperimentTrpcPorts`                                                                         | 3                                                             |
| `createExperimentRunProcessingPipeline`, `workbenchActorFrom`                                                                               | 3                                                             |
| `PostgresExperimentAdapter` + `…Options`, `ExperimentDspyRetentionPort`, `ExperimentWorkbenchUpdatesPort`, `ExperimentRunStateStoreAdapter` | 2 each                                                        |
| The four `ExperimentRunEventing*` aliases                                                                                                   | 2 each                                                        |
| `createBlankWorkbenchState`                                                                                                                 | 1                                                             |

Zero external users: `ExperimentAppDependencies`, `ExperimentBroadcast`,
`ExperimentCaller`, `ExperimentMonitorCascade`, `ExperimentWithRuns`,
`ExperimentRunProcessingPipelineDeps`, `EXPERIMENT_RUN_PROCESSING_EVENT_TYPES`.

Commit 4 is the only one that reaches outside the feature structurally, and it
touches five files: `presets.ts` (two composition sites),
`runtime/app/features/experiment.ts`, `runtime/app/replay-runtime.adapter.ts`,
`event-sourcing/registration/pipelineRegistry.ts`. Commit 5 touches six more,
all of them `platform/app` route modules already reading `experimentService`.
