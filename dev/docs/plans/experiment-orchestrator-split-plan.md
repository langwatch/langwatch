# Splitting `experiment-run-orchestrator.service.ts`

Decision 16 of `dev/docs/plans/open-decisions-2026-09-03.md`, option (a):
split the run orchestrator as its own deliberately-designed lane, not as part
of the mechanical `service-quality` burn-down. Lane owner in
`architecture-lint-burn-down-plan.md` is Q3, which explicitly excludes this
file from the ratchet.

The file is
`packages/features/experiment/server/src/services/experiment-run-orchestrator.service.ts`.
Every path below is relative to the repository root unless written in full.

This plan is written so a Sonnet agent can execute it without judgment calls.
Where a choice existed it has already been made here; where a fact was
measured, the measurement is printed rather than described.

---

## 0. Rules the executor follows

| Rule                                       | What it means here                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No compat re-exports                       | The facade never writes `export { x } from "./collaborator"` for a **value**. It declares its own function whose body calls the collaborator. `export type { … } from` for a pure type is not a compat re-export and is allowed (types have no runtime identity, and re-declaring one would duplicate it). |
| No `as unknown as`                         | Two already exist (lines 1174 and 3681). Carry both **verbatim** into their new homes. Add none.                                                                                                                                                                                                           |
| Comments 5 lines max                       | Every comment block in every file this lane touches must be ≤5 lines. This is not stylistic — see §8; it is 61 live lint violations.                                                                                                                                                                       |
| `services/` holds only `<name>.service.ts` | Anything that is not a service goes to `processes/<name>.process.ts`. The rule for which is which: **a module that reaches a port is a service; a pure function of its arguments is a process.**                                                                                                           |
| Named parameters                           | Every new collaborator method takes ONE object and destructures it. The facade's exported functions keep their existing positional signatures and adapt.                                                                                                                                                   |
| No typecheck                               | The executing agent does not run `pnpm typecheck` or `pnpm typecheck:all`. The integrator runs `pnpm typecheck:all` once, after the last slice.                                                                                                                                                            |
| No git surgery                             | No `git add -A`, no `stash`, no `restore`, no `clean`, no `checkout --`. Stage explicit paths only.                                                                                                                                                                                                        |

---

## 1. What was measured

`packages/architecture-lint` run against this one file, today:

```
[service-quality]
  Service module exceeds its quality ceiling
  (lines 3956/500, longest method 791/80, statements 43/24,
   complexity 42/24, line length 174/160).

[comment-block-size]
  61 blocks over the 5-line maximum
  (largest: 23, 22, 21, 20, 20, 19, 17, 17, 17, 15, …)
  30 further blocks in the 4–5 line review tier
```

There is **no** entry for this file in `service-quality-baseline.json`, so it
is measured against the defaults and is red today. The file is in this
branch's changed set (`git diff --name-only <merge-base>...HEAD` lists it), and
`lintCommentBlocks` fails a changed file at 6+ blocks **regardless of the
`comment-block-roots.json` allowlist** — the `packages/features/experiment/server`
entry (263 blocks, expires 2026-10-01) does not exempt it.

Per top-level declaration (`L` = declaration lines, `m` = longest method body,
`s` = max statements in a body, `c` = max cyclomatic complexity). Ceilings are
`m ≤ 80`, `s ≤ 24`, `c ≤ 24`, module `≤ 500`:

```
 254- 439  L 186  m 179  s 11  c 29   generateCells              ✗ m ✗ c
 582-1196  L 615  m 581  s 19  c 35   generateComparisonCells    ✗ m ✗ c
1464-1667  L 204  m 189  s  2  c 21   executeCell                ✗ m
1678-1901  L 224  m 204  s  2  c 29   executeWorkflowCell        ✗ m ✗ c
2306-2414  L 109  m 105  s 10  c 24   buildEvaluatorInputs       ✗ m
2620-2695  L  76  m  63  s  5  c 27   buildTargetMetadata        ✗ c
3100-3892  L 793  m 791  s 43  c 42   runOrchestrator            ✗ m ✗ s ✗ c
```

One source line exceeds 160 characters: **line 1085** (174), the
`logger.debug` message string inside the column-target comparison loop.

**Moving code into new files does not, on its own, clear `service-quality`.**
Seven functions breach a method-level ceiling, and a method-level breach
travels with the method. §7 says what each one becomes.

---

## 2. Current shape

The file has **no class**. It is 61 module-level functions, 8 types, 2
constants and 1 logger, all in one module, with the ports threaded through
signatures as an injected bag.

```
services/experiment-run-orchestrator.service.ts — 3,956 lines, 0 classes
│
├─ planning (pure) ─────────────────────────────────────────────────────┐
│   resolveScopedRowIndices · resolveMappingDatasetId                   │
│   generateCells (186) · countScopedCells                              │
├─ comparison / phase 2 (pure) ─────────────────────────────────────────┤
│   generateComparisonCells (615 lines, 12 inner closures)              │
│   comparisonSkipMessage · formatList · ComparisonSkipReason           │
├─ input assembly + dispatch guards (pure) ─────────────────────────────┤
│   buildTargetInputs · buildEvaluatorInputs · assignMappedInput        │
│   hasNoResolvedInputs · evaluatorTargetHasNoResolvedInputs            │
│   evaluatorTargetFields/DisplayName · declaredEvaluatorFields         │
│   catalogFields · isEmptyInputValue · evaluatorDisplayName            │
│   evaluatorErrorResult · noInputsResolvedResult                       │
│   evaluatorTargetNoInputsResult                                       │
├─ cell execution — studio component target ────────────────────────────┤
│   executeCell (204) · runCellEvaluators · runOneCellEvaluator         │
│   priceMetrics · CellEvaluatorContext                                 │
├─ cell execution — whole studio workflow target ───────────────────────┤
│   executeWorkflowCell (224)                                           │
├─ cell execution — connected agent target (ADR-128) ───────────────────┤
│   executeConnectedCell · connectedTurn · gradeConnectedAnswer         │
│   dispatchWithBusyRetry · busyWaitMs · busyRetryAfterMs               │
│   dispatchAgentOf · connectedTurnParams · connectedFailureEvent       │
│   relayDispatch · ConnectedDispatch · ConnectedCellInput              │
├─ sandbox credential ──────────────────────────────────────────────────┤
│   runExecutesCode · mintRunSandboxApiKey                              │
│   withSandboxApiKey   ← DEFINED, NEVER CALLED (see §12)               │
├─ storage payload builders (pure) ─────────────────────────────────────┤
│   buildTargetMetadata · buildTargetResultDispatch                     │
│   buildEvaluatorResultDispatch                                        │
├─ carried-over board ──────────────────────────────────────────────────┤
│   buildCarriedOverDispatches · recordCarriedOverBoard                 │
│   carriedTargetResult · carriedEvaluatorResults                       │
│   carriedCellFields · isStorableVerdict                               │
└─ the run loop ────────────────────────────────────────────────────────┘
    runOrchestrator (793 lines / 43 statements / complexity 42)
      ├ counters + phase-2 caches            3165-3212
      ├ run registration + carried board     3213-3268
      ├ processEventForStorage (closure)     3270-3400   131 lines
      ├ event queue: push/signal/wait        3418-3458    41 lines
      ├ phase 1 loop (semaphore, executors)  3466-3613   148 lines
      ├ phase 2 block (comparison)           3615-3797   183 lines
      └ consume, finally, summary            3804-3891    88 lines
    getLoadedDataForTarget · requestAbort
```

Collaborators the module reaches, all through one injected bag:

```
ExperimentRunPorts                     threaded through every signature
  studio               ExperimentStudioDispatchPort      every cell dispatch
  cost                 ExperimentModelCostPort           priceMetrics
  abort                ExperimentRunAbortPort            run loop, every cell
  experiments          ExperimentService                 5 command dispatches
  evaluationReporting  ExperimentEvaluationReportingPort evaluator results
  sandboxCredentials   ExperimentSandboxCredentialPort   mint (key then dropped)
+ workflows            WorkflowService                   event enrichment
+ getConnectedAgentRuntime()   module singleton          relay dispatch
+ assertConnectedAgentsRunnable(@langwatch/suite-server)  run admission
```

---

## 3. Target shape

One facade module keeping its exported surface byte-identical, eleven
collaborator services, four processes.

```
                    apps/api · experiment-v3.api.ts · experiment-polling-run.service.ts
                    experiment-workflow-evaluation.service.ts · src/index.ts
                                        │
                                        │  imports EXACTLY the names it imports today
                                        ▼
   services/experiment-run-orchestrator.service.ts        ← the facade, ~230 lines
   declares: ExperimentRunPorts · OrchestratorInput · ConnectedDispatch
   delegates: 21 exported values, one line each (4 types are declared/re-exported)
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
  ExperimentRunLoopService      ExperimentCellPlanService     ExperimentEvaluatorInputService
  the run itself                phase-1 cell plan             what a dispatch is handed
        │                       + SeededTargetOutput          + the dispatch guards
        │
        ├─▶ ExperimentComparisonPlanService     phase-2 cells + typed skip reasons
        ├─▶ ExperimentCellExecutionService      one component cell + the evaluator loop
        ├─▶ ExperimentWorkflowCellService       one execute_flow cell
        ├─▶ ExperimentConnectedCellService      one relay turn, busy-retried
        ├─▶ ExperimentRunSandboxKeyService      the run's one agent-cache credential
        ├─▶ ExperimentResultDispatchService     event → Eventing command payload
        ├─▶ ExperimentCarriedBoardService       the cells a run carries, not produces
        └─▶ ExperimentRunStorageService         everything a produced event does after
                                                it is yielded

  processes/  (pure; no port, no class)
    experiment-comparison-skip.process.ts        skip kinds + the copy for each
    experiment-comparison-candidates.process.ts  candidate text, ids, display names
    experiment-cell-error-events.process.ts      the three "could not run" events
    experiment-run-event-stream.process.ts       push/complete/stream channel
                                                 (sibling of experiment-run-semaphore)
```

Dependency direction is one way: facade → services → processes. No collaborator
imports a value from the facade. Three collaborators import
`ExperimentRunPorts` from the facade **type-only** (`import type`), which is
erased at runtime and creates no cycle; `lintCycles` is package-level and does
not see intra-package edges.

---

## 4. The collaborators

Every method name below is the **current function name, verbatim**, except
where `fallible-result-naming` forces a `try` prefix (marked ⚠). That rule
(`packages/architecture-lint/src/service-results.ts`) applies to public class
methods in a `.service.ts` and refuses:

- a public method with no explicit return type;
- a public method whose return type includes `null` or `undefined` without a
  `try` prefix;
- a `require*` prefix.

So **every method below declares its return type**, private helpers stay
`private` (the rule only reads public members), and the three methods that can
answer with nothing carry `try`.

### S1 — `ExperimentCellPlanService`

`services/experiment-cell-plan.service.ts`

Turns a workbench state plus a run scope into the concrete phase-1 cells a run
executes, and answers how many there will be before the run starts. It is the
one place that decides which dataset rows are in scope, which dataset's mapping
bucket the run reads (the active one, not the first), which targets a scope
expands to once a comparison's dependencies are pulled in, and which cells are
deliberately left for phase 2. It reaches nothing outside itself: given the same
state, rows and scope it returns the same list, which is why the polling run can
call it to publish a total before any cell has run.

```ts
static create(): ExperimentCellPlanService

export type SeededTargetOutput = { output: unknown; cost?: number; duration?: number };

resolveScopedRowIndices({ scope, rowCount }: {
  scope: ExecutionScope;
  rowCount: number;
}): number[]

generateCells({ state, datasetRows, scope, seedTargetOutputs }: {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  datasetRows: Array<Record<string, unknown>>;
  scope: ExecutionScope;
  seedTargetOutputs?: Record<string, SeededTargetOutput>;
}): ExecutionCell[]

countScopedCells({ state, datasetRows, scope, seedTargetOutputs }: {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  datasetRows: Array<Record<string, unknown>>;
  scope: ExecutionScope;
  seedTargetOutputs?: Record<string, SeededTargetOutput>;
}): number
```

`SeededTargetOutput` is declared and exported here because the plan is the
first thing that reads a seeded output; S2, S10 and S12 import the type from
this module. It replaces the object literal that is written out six times in
the current file.

### S2 — `ExperimentComparisonPlanService`

`services/experiment-comparison-plan.service.ts`

Phase 2. For each comparison carrier the workbench holds — a chip evaluator
whose verdict anchors on its first variant, and a column-style comparison
target whose verdict is its own column — it emits one synthetic cell per row
where every configured variant produced usable output, and a typed
`ComparisonSkipReason` for every row and every comparison it could not build.
Nothing is dropped silently: a comparison the user has not finished configuring
produces a setup skip for every scoped row rather than a column that reads "No
verdict yet" forever. It also resolves which judge will actually run for a
column target, because the DB evaluator row — not this cell's in-memory config —
decides whether the legacy two-slot or the N-way payload shape is correct.

```ts
static create({ loadedPrompts, loadedEvaluators }: {
  loadedPrompts?: Map<string, VersionedPrompt>;
  loadedEvaluators?: LoadedEvaluators;
}): ExperimentComparisonPlanService

generateComparisonCells({
  state, datasetRows, completedTargetOutputs,
  completedTargetEvaluatorScores, scopedRowIndices,
}: {
  state: Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators">;
  datasetRows: Array<Record<string, unknown>>;
  completedTargetOutputs: Map<string, SeededTargetOutput>;
  completedTargetEvaluatorScores?: Map<string, VariantEvaluatorScore[]>;
  scopedRowIndices: number[] | undefined;
}): { cells: ExecutionCell[]; skipReasons: ComparisonSkipReason[] }
```

`VariantEvaluatorScore = { name: string; score?: number; label?: string; passed?: boolean }`
is declared and exported here; it is written out three times in the current
file. `LoadedEvaluators` moves to `experiment-execution-data.service.ts` (§6).

`scopedRowIndices` stays required-and-nullable. Its current JSDoc explains why
in eight lines; it becomes ≤5 and keeps the fact: an explicit `undefined` is a
decision, a missing argument is an oversight, and the oversight silently
overwrites verdicts.

### S3 — `ExperimentEvaluatorInputService`

`services/experiment-evaluator-input.service.ts`

What a target or an evaluator is actually handed at dispatch, and whether it
should be dispatched at all. It resolves a cell's mappings into an input record
for a target and for each of its evaluators, applies the comparison branch that
bypasses per-target mappings entirely, and answers the two guard questions the
executors ask before they spend anything: does this evaluator resolve any input,
and does this evaluator COLUMN. Both guards exist because an evaluator that
resolves nothing does not fail — `exact_match` compares "" to "" and reports a
pass, and that pass is counted in the run's pass rate.

```ts
static create({ loadedEvaluators }: {
  loadedEvaluators?: LoadedEvaluators;
}): ExperimentEvaluatorInputService

buildTargetInputs({ cell }: { cell: ExecutionCell }): Record<string, unknown>

buildEvaluatorInputs({ cell, evaluatorId, targetOutput }: {
  cell: ExecutionCell;
  evaluatorId: string;
  targetOutput: Record<string, unknown>;
}): Record<string, unknown>

hasNoResolvedInputs({ cell, evaluator, inputs }: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  inputs: Record<string, unknown>;
}): boolean

evaluatorTargetHasNoResolvedInputs({ cell }: { cell: ExecutionCell }): boolean

evaluatorTargetDisplayName({ target }: { target: TargetConfig }): string
```

### S4 — `ExperimentCellExecutionService`

`services/experiment-cell-execution.service.ts`

Runs one cell whose target is a studio component — a prompt, an HTTP or code
agent, or an evaluator run as its own column — and grades it. It owns the
evaluator dispatch loop the other two executors reuse, because the evaluators
attached to a column are the same evaluators whatever produced the output, and
that loop is all the three executors have in common. One evaluator failing does
not stop the rest: each reports its own error cell, and the target's result is
already yielded by then. It also prices a target's tokens at the project's
canonical model rate, because the engine reports token counts and has no price
table, and a cell's cost has to match its trace's cost.

```ts
static create({ ports, workflows }: {
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
}): ExperimentCellExecutionService

executeCell({ cell, projectId, datasetColumns, loadedData, resultMapperConfig, isAborted }: {
  cell: ExecutionCell;
  projectId: string;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedData: LoadedCellData;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event>

runCellEvaluators({
  cell, projectId, workflow, evaluatorNodeIds, targetOutput,
  traceId, targetNodes, config, isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflow: StudioWorkflow;
  evaluatorNodeIds: Record<string, string>;
  targetOutput: Record<string, unknown>;
  traceId: string;
  targetNodes: Set<string>;
  config: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event>

⚠ tryPriceMetrics({ projectId, metrics }: {
  projectId: string;
  metrics: ExecutionState["metrics"] | undefined;
}): Promise<number | undefined>
```

`LoadedCellData` is the inline `loadedData` shape at current lines 1469-1476,
extracted and exported from this module.

### S5 — `ExperimentWorkflowCellService`

`services/experiment-workflow-cell.service.ts`

Runs one cell whose target is a whole committed Studio workflow. The row goes
through `execute_flow` once, the End node's result becomes the target output,
each of the workflow's own evaluator nodes becomes an evaluator result under the
node's display name, and node costs are summed with LLM nodes priced the same
way `executeCell` prices them. The failure is captured whole rather than
latched field by field, because message, code and upstream status describe one
failure and latching them apart produced a `domainError` whose code came from
one node and whose message from another. Evaluators attached to the column —
which are not part of the workflow and so did not run with it — are then graded
through S4's loop, and only when the workflow produced a result.

```ts
static create({ ports, workflows, cells }: {
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  cells: ExperimentCellExecutionService;
}): ExperimentWorkflowCellService

executeWorkflowCell({
  cell, projectId, workflowDsl, datasetColumns,
  loadedEvaluators, resultMapperConfig, isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  workflowDsl: StudioWorkflow;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: LoadedEvaluators;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event>
```

### S6 — `ExperimentConnectedCellService`

`services/experiment-connected-cell.service.ts`

Runs one cell whose target is a connected agent (ADR-128). The agent runs in
the customer's own process, so the engine has no node for it: the row is one
turn through the relay dispatcher, sent from here and answered in place. Each
row is its own conversation with no session, so what one row said can never
reach another, and the agent adopts the cell's trace context so its spans land
in the row's trace. Every instance being full is a queue rather than a failure,
so the turn is retried while the agent says it is busy, inside a bounded budget
and with jitter, and a stopped run waits for nothing. The answer is then graded
through S4's loop, so a connected column scores, costs and traces the way every
other column does.

```ts
static create({ ports, workflows, cells, dispatch, sleep, now }: {
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  cells: ExperimentCellExecutionService;
  dispatch?: ConnectedDispatch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): ExperimentConnectedCellService

executeConnectedCell({
  cell, projectId, agent, datasetColumns,
  loadedEvaluators, resultMapperConfig, isAborted,
}: {
  cell: ExecutionCell;
  projectId: string;
  agent: TypedAgent;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: LoadedEvaluators;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
}): AsyncGenerator<EvaluationV3Event>
```

`dispatch`, `sleep` and `now` move from the per-call input to `create`, because
they are properties of the service's world and not of a cell. The facade's
`executeConnectedCell(input)` keeps taking them on the input object and forwards
them into `create`, so `experiment-run-orchestrator.connected-cell.integration.test.ts`
does not change.

### S7 — `ExperimentRunSandboxKeyService`

`services/experiment-run-sandbox-key.service.ts`

The one agent-cache credential a run lends to the code it executes. Minted only
when some target of the run actually runs Python — a code agent, or a workflow
with a code node — and one key for the whole run rather than one per row, so the
rows share the cache entries the run writes and no ledger of live credentials is
left behind. A run that cannot get one still runs, and every row does its own
work. The key is set on a studio event's workflow after `addEnvs` rather than
inside it, so a one-off Studio run with no run behind it carries no key.

```ts
static create({ sandboxCredentials }: {
  sandboxCredentials: ExperimentSandboxCredentialPort;
}): ExperimentRunSandboxKeyService

⚠ tryMintRunSandboxApiKey({ projectId, loadedAgents, loadedWorkflows }: {
  projectId: string;
  loadedAgents: Map<string, TypedAgent>;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): Promise<string | undefined>

withSandboxApiKey({ event, sandboxApiKey }: {
  event: StudioClientEvent;
  sandboxApiKey: string | undefined;
}): StudioClientEvent
```

`withSandboxApiKey` has **no caller today**. Move it, do not delete it, and read
§12 before touching it.

### S8 — `ExperimentResultDispatchService`

`services/experiment-result-dispatch.service.ts`

Turns what a run produced into the Eventing command payloads that store it: the
per-target metadata recorded once at run start, the target row, and the
evaluator row. Model attribution is pinned at run start rather than read live,
because an evaluator's config can be edited afterwards and reading it later
would retroactively misattribute every historical run — and the recorded model
is what the leaderboard's self-preference check reads. A falsy target output
(`false`, `0`, `""`) persists as a value; only null and undefined become a null
prediction. The stored row carries the failure's code as well as its string,
because the row is what the grid renders after a reload. An evaluation that
declined to score still reports what it spent.

```ts
static create(): ExperimentResultDispatchService

buildTargetMetadata({ targets, loadedPrompts, loadedAgents, loadedEvaluators, loadedWorkflows }: {
  targets: EvaluationsV3State["targets"];
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  loadedEvaluators?: LoadedEvaluators;
  loadedWorkflows?: Map<string, LoadedWorkflow>;
}): ESBatchEvaluationTarget[]

⚠ tryBuildTargetResultDispatch({ tenantId, runId, experimentId, event, datasetEntry, occurredAt }: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: EvaluationV3Event;
  datasetEntry: Record<string, unknown>;
  occurredAt: number;
}): RecordTargetResultCommandData | null

buildEvaluatorResultDispatch({ tenantId, runId, experimentId, event, result, evaluatorName, occurredAt }: {
  tenantId: string;
  runId: string;
  experimentId: string;
  event: {
    rowIndex: number;
    targetId: string;
    evaluatorId: string;
    duration?: number | null;
    inputs?: Record<string, unknown> | null;
  };
  result: SingleEvaluationResult;
  evaluatorName: string | null;
  occurredAt: number;
}): RecordEvaluatorResultCommandData
```

The facade keeps `buildTargetResultDispatch` (no `try`), since it is a module
function and the rule does not reach it; only the collaborator's method takes
the prefix.

### S9 — `ExperimentCarriedBoardService`

`services/experiment-carried-board.service.ts`

The board cells a run carries rather than produces, so opening a run shows what
the person was looking at instead of the one column they clicked. The rows go
through the same two dispatch builders a live cell goes through, so a carried
cell and a produced cell are the same row in every respect but `carriedOver` —
the flag that keeps the run's cost, duration and progress about the run's own
work. A cell with neither an output nor a failure gets no target row, and a
verdict whose status the store does not know is dropped, because writing them
would read as a result rather than as an empty cell. Deliberately not routed
through the storage path and deliberately not put on the stream: the first would
re-report old verdicts into the evaluations pipeline, the second would let a
carried cell overwrite workbench cells this run never produced. A row that fails
to write is logged and dropped, because losing part of the context must not stop
the run the person started.

```ts
static create({ commands, dispatches }: {
  commands: ExperimentService;
  dispatches: ExperimentResultDispatchService;
}): ExperimentCarriedBoardService

buildCarriedOverDispatches({ tenantId, runId, experimentId, cells, datasetRows, evaluatorNameFor, occurredAt }: {
  tenantId: string;
  runId: string;
  experimentId: string;
  cells: CarriedOverCell[];
  datasetRows: Array<Record<string, unknown>>;
  evaluatorNameFor: (evaluatorId: string) => string | null;
  occurredAt: number;
}): {
  targetResults: RecordTargetResultCommandData[];
  evaluatorResults: RecordEvaluatorResultCommandData[];
}

recordCarriedOverBoard({ projectId, runId, experimentId, cells, datasetRows, state, loadedEvaluators }: {
  projectId: string;
  runId: string;
  experimentId: string;
  cells: CarriedOverCell[];
  datasetRows: Array<Record<string, unknown>>;
  state: EvaluationsV3State;
  loadedEvaluators?: LoadedEvaluators;
}): Promise<void>
```

### S10 — `ExperimentRunStorageService`

`services/experiment-run-storage.service.ts`

Everything one produced event does after it has been yielded. It keeps the run's
trace-id ledger so an evaluator result can name the trace its target wrote; it
caches the per-row target outputs and evaluator scores phase 2 reads, and knows
which of those this run produced rather than inherited; it reports each
evaluator result into the evaluation processing pipeline; and it dispatches the
target and evaluator rows to ClickHouse, counting its own failures so the run
can report how many of its writes did not land. It also owns the run's two
lifecycle commands. Everything it does is best-effort except the run's own
registration: a write that fails is counted and logged, because a lost row must
not end a run, while a run that cannot register has nothing to write into.

```ts
static create({ ports, dispatches, projectId, runId, experimentId, state, loadedEvaluators, datasetRows }: {
  ports: ExperimentRunPorts;
  dispatches: ExperimentResultDispatchService;
  projectId: string;
  runId: string;
  experimentId?: string;
  state: EvaluationsV3State;
  loadedEvaluators?: LoadedEvaluators;
  datasetRows: Array<Record<string, unknown>>;
}): ExperimentRunStorageService

seedTargetOutputs({ seeded }: {
  seeded: Record<string, SeededTargetOutput> | undefined;
}): void

seedTraceIds({ cells }: { cells: ExecutionCell[] }): void

startRun({ workflowVersionId, total, targets, occurredAt }: {
  workflowVersionId: string | null;
  total: number;
  targets: ESBatchEvaluationTarget[];
  occurredAt: number;
}): Promise<void>

record({ event }: { event: EvaluationV3Event }): Promise<void>

completeRun({ finishedAt, stoppedAt, occurredAt }: {
  finishedAt: number | null;
  stoppedAt: number | null;
  occurredAt: number;
}): Promise<void>

targetOutputs(): ReadonlyMap<string, SeededTargetOutput>

evaluatorScores(): ReadonlyMap<string, VariantEvaluatorScore[]>

hasProduced(key: string): boolean

dispatchFailures(): { failures: number; total: number }
```

`startRun` rethrows on failure exactly as today (the current code increments the
counter, logs, clears the running flag and rethrows); the clearing of the
running flag stays in the run loop, which is what set it.

### S11 — `ExperimentRunLoopService`

`services/experiment-run-loop.service.ts`

The run itself. It refuses a run that names another person's development agent
before any cell exists, plans the phase-1 cells, registers the run and carries
the board in, then executes cells in parallel under a semaphore, checking the
abort flag before each cell, after acquiring a slot, and between the events of a
cell. When phase 1 finishes it generates the comparison cells from the outputs
phase 1 produced, folds their count into the run total so progress stays honest,
emits one synthetic error row per comparison it could not build, back-fills the
candidate outputs the run reused rather than executed, and runs the comparison
cells through the same loop. It emits the run's lifecycle events — started,
progress, stopped, done with a summary — and clears the run's flags whatever
happened.

```ts
static create({ ports, workflows }: {
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
}): ExperimentRunLoopService

run(input: OrchestratorInput): AsyncGenerator<EvaluationV3Event>
```

`create` builds the run-independent collaborators (S1, S4, S5, S6, S7, S8).
S2, S3, S9 and S10 need per-run data — the loaded maps, the run id, the
experiment id — and are built inside `run` from the input. This mirrors
`LangyTurnService`, which builds its collaborators in its private constructor
from the deps it was given.

### P1 — `processes/experiment-comparison-skip.process.ts`

The five reasons a comparison row cannot be built, and the sentence a customer
reads for each. Pure. Exports `ComparisonSkipReason`, `ComparisonSetupSkip`,
`formatList`, `comparisonSkipMessage`. The copy lives here rather than on the
service so a test can pin the wording and the `error_type` without running an
orchestration, which is exactly why `comparisonSkipMessage` was exported in the
first place.

### P2 — `processes/experiment-comparison-candidates.process.ts`

Turning a variant's stored output into the text a judge reads, and naming the
candidates. Pure. Exports `pickOutputPath`, `toCandidateText`,
`evaluatorScoresBlock`, `variantIdentifierFor`, `buildVariantIdentifiers`,
`variantDisplayNameFor`, `buildVariantDisplayNames`. These are the seven inner
closures of `generateComparisonCells` that read nothing but their arguments;
moving them is what brings S2 under the module ceiling.

### P3 — `processes/experiment-cell-error-events.process.ts`

The three `EvaluationV3Event`s a cell emits for itself when it could not run:
`evaluatorErrorResult`, `noInputsResolvedResult`, `evaluatorTargetNoInputsResult`.
Pure. Shared by S3 and S4, which is why they are not private to either.

### P4 — `processes/experiment-run-event-stream.process.ts`

The producer/consumer channel that lets parallel cell executions push events
while the run's generator yields them in arrival order. Same shape as its
sibling `experiment-run-semaphore.process.ts`:

```ts
export type RunEventStream = {
  push: (event: EvaluationV3Event) => void;
  complete: () => void;
  stream: () => AsyncGenerator<EvaluationV3Event>;
};

export const createRunEventStream = (): RunEventStream => { … };
```

`stream()` replaces the `while (true) { const event = await waitForEvent(); if
(event === null) break; yield event; }` loop; the null sentinel stays internal.

---

## 5. Line-range map

Every top-level declaration of the current file, assigned to exactly one
target. Line ranges are as the file stands today.

|       Lines | Symbol                               | Kind    | Target                                                                          |
| ----------: | ------------------------------------ | ------- | ------------------------------------------------------------------------------- |
|        1-11 | module JSDoc                         | comment | facade (rewritten, ≤5 lines)                                                    |
|         115 | `EVALUATION_KSUID_RESOURCE`          | const   | **S10**                                                                         |
|         117 | `logger`                             | const   | every new module (§11)                                                          |
|     128-141 | `ExperimentRunPorts`                 | type    | **facade** (stays)                                                              |
|     146-188 | `OrchestratorInput`                  | type    | **facade** (stays)                                                              |
|     201-229 | `resolveScopedRowIndices`            | fn      | **S1**                                                                          |
|     241-249 | `resolveMappingDatasetId`            | fn      | **S1** (private)                                                                |
|     254-439 | `generateCells`                      | fn      | **S1**                                                                          |
|     452-463 | `countScopedCells`                   | fn      | **S1**                                                                          |
|     487-518 | `ComparisonSkipReason`               | type    | **P1**                                                                          |
|     521-524 | `ComparisonSetupSkip`                | type    | **P1**                                                                          |
|     530-533 | `formatList`                         | fn      | **P1**                                                                          |
|     542-580 | `comparisonSkipMessage`              | fn      | **P1**                                                                          |
|    582-1196 | `generateComparisonCells`            | fn      | **S2** — split as below                                                         |
|   — 629-648 | `pickOutputPath` (inner)             | closure | **P2**                                                                          |
|   — 659-674 | `evaluatorScoresBlock` (inner)       | closure | **P2**                                                                          |
|   — 690-700 | `toCandidateText` (inner)            | closure | **P2**                                                                          |
|   — 711-717 | `variantIdentifierFor` (inner)       | closure | **P2**                                                                          |
|   — 736-741 | `buildVariantIdentifiers` (inner)    | closure | **P2**                                                                          |
|   — 753-765 | `variantDisplayNameFor` (inner)      | closure | **P2**                                                                          |
|   — 773-774 | `buildVariantDisplayNames` (inner)   | closure | **P2**                                                                          |
|   — 789-823 | `resolveVariants` (inner)            | closure | **S2** (private)                                                                |
|   — 832-833 | `anchorVariantId` (inner)            | closure | **S2** (private)                                                                |
|   — 836-858 | `pushSetupSkips` (inner)             | closure | **S2** (private)                                                                |
|   — 883-889 | `isLegacyPairwiseBacked` (inner)     | closure | **S2** (private)                                                                |
|   — 897-947 | `buildCandidates` (inner)            | closure | **S2** (private)                                                                |
|  — 949-1011 | chip-comparison loop                 | block   | **S2** `planChipComparisons` (private)                                          |
| — 1013-1194 | column-comparison loop               | block   | **S2** `planColumnComparisons` (private)                                        |
|   1206-1221 | `priceMetrics`                       | fn      | **S4** → `tryPriceMetrics`                                                      |
|   1224-1235 | `CellEvaluatorContext`               | type    | **S4** (private)                                                                |
|   1244-1319 | `runOneCellEvaluator`                | fn      | **S4** (private)                                                                |
|   1322-1342 | `evaluatorErrorResult`               | fn      | **P3**                                                                          |
|   1356-1384 | `runCellEvaluators`                  | fn      | **S4**                                                                          |
|   1390-1404 | `runExecutesCode`                    | fn      | **S7** (private)                                                                |
|   1414-1431 | `mintRunSandboxApiKey`               | fn      | **S7** → `tryMintRunSandboxApiKey`                                              |
|   1441-1458 | `withSandboxApiKey`                  | fn      | **S7** (§12)                                                                    |
|   1464-1667 | `executeCell`                        | fn      | **S4** — split as below                                                         |
| — 1469-1476 | `loadedData` inline shape            | type    | **S4** → exported `LoadedCellData`                                              |
| — 1488-1506 | evaluator-column guard               | block   | **S4** (private `refuseUnmappedColumn`)                                         |
| — 1536-1552 | precomputed-output branch            | block   | **S4** (private `precomputedTargetOutput`)                                      |
| — 1553-1630 | target dispatch + mapping            | block   | **S4** (private `dispatchTarget`)                                               |
|   1678-1901 | `executeWorkflowCell`                | fn      | **S5** — split as below                                                         |
| — 1771-1834 | event fold loop                      | block   | **S5** (private `foldFlowEvents`)                                               |
| — 1836-1859 | target result event                  | block   | **S5** (private `targetResultEvent`)                                            |
| — 1863-1885 | attached evaluators                  | block   | **S5** (private `gradeAttachedEvaluators`)                                      |
|   1904-1909 | `ConnectedDispatch`                  | type    | **facade** (stays)                                                              |
|   1912-1913 | `relayDispatch`                      | const   | **S6** (private default)                                                        |
|   1920-1931 | `dispatchAgentOf`                    | fn      | **S6** (private)                                                                |
|   1937-1971 | `connectedTurnParams`                | fn      | **S6** (private)                                                                |
|   1979-2015 | `connectedFailureEvent`              | fn      | **S6** (private)                                                                |
|   2018-2034 | `ConnectedCellInput`                 | type    | **facade** (the facade's own arg shape)                                         |
|   2048-2094 | `executeConnectedCell`               | fn      | **S6**                                                                          |
|   2102-2141 | `connectedTurn`                      | fn      | **S6** (private)                                                                |
|   2149-2189 | `gradeConnectedAnswer`               | fn      | **S6** (private)                                                                |
|   2199-2232 | `dispatchWithBusyRetry`              | fn      | **S6** (private)                                                                |
|   2243-2261 | `busyWaitMs`                         | fn      | **S6** (private)                                                                |
|   2264-2268 | `busyRetryAfterMs`                   | fn      | **S6** (private)                                                                |
|   2276-2291 | `assignMappedInput`                  | fn      | **S3** (private)                                                                |
|   2306-2414 | `buildEvaluatorInputs`               | fn      | **S3** — split as below                                                         |
| — 2326-2394 | comparison branch                    | block   | **S3** (private `comparisonEvaluatorInputs`)                                    |
| — 2396-2412 | mapping branch                       | block   | **S3** (private `mappedEvaluatorInputs`)                                        |
|        2417 | `NO_INPUTS_RESOLVED`                 | const   | **P3**                                                                          |
|   2420-2421 | `isEmptyInputValue`                  | fn      | **S3** (private)                                                                |
|   2428-2431 | `catalogFields`                      | fn      | **S3** (private)                                                                |
|   2437-2441 | `declaredEvaluatorFields`            | fn      | **S3** (private)                                                                |
|   2444-2445 | `evaluatorDisplayName`               | fn      | **P3**                                                                          |
|        2448 | `LoadedEvaluators`                   | type    | `experiment-execution-data.service.ts` (§6)                                     |
|   2455-2468 | `evaluatorTargetFields`              | fn      | **S3** (private)                                                                |
|   2471-2480 | `evaluatorTargetDisplayName`         | fn      | **S3**                                                                          |
|   2494-2509 | `evaluatorTargetHasNoResolvedInputs` | fn      | **S3**                                                                          |
|   2512-2524 | `evaluatorTargetNoInputsResult`      | fn      | **P3**                                                                          |
|   2538-2558 | `hasNoResolvedInputs`                | fn      | **S3**                                                                          |
|   2561-2583 | `noInputsResolvedResult`             | fn      | **P3**                                                                          |
|   2591-2608 | `buildTargetInputs`                  | fn      | **S3**                                                                          |
|   2620-2695 | `buildTargetMetadata`                | fn      | **S8** — split as below                                                         |
| — 2621-2672 | model attribution                    | block   | **S8** (private `targetModel`)                                                  |
| — 2674-2683 | name attribution                     | block   | **S8** (private `targetName`)                                                   |
|   2717-2773 | `buildTargetResultDispatch`          | fn      | **S8** → `tryBuildTargetResultDispatch`                                         |
|   2786-2833 | `buildEvaluatorResultDispatch`       | fn      | **S8**                                                                          |
|   2840-2846 | `carriedCellFields`                  | fn      | **S9** (private)                                                                |
|   2849-2852 | `isStorableVerdict`                  | fn      | **S9** (private)                                                                |
|   2861-2895 | `carriedTargetResult`                | fn      | **S9** (private, `tryCarriedTargetResult` not needed — private)                 |
|   2898-2935 | `carriedEvaluatorResults`            | fn      | **S9** (private)                                                                |
|   2958-3008 | `buildCarriedOverDispatches`         | fn      | **S9**                                                                          |
|   3024-3094 | `recordCarriedOverBoard`             | fn      | **S9**                                                                          |
|   3100-3892 | `runOrchestrator`                    | fn      | **S11** — split as below                                                        |
| — 3101-3131 | destructure + agent admission        | block   | **S11** `run`                                                                   |
| — 3133-3163 | concurrency, runId, plan, register   | block   | **S11** `run`                                                                   |
| — 3165-3212 | counters, caches, trace seed         | block   | **S10** (`create` + `seedTargetOutputs` + `seedTraceIds`)                       |
| — 3213-3226 | target metadata + mapper config      | block   | **S11** `run` (calls S8)                                                        |
| — 3228-3235 | sandbox key mint                     | block   | **S11** `run` (calls S7)                                                        |
| — 3237-3268 | `startExperimentRun` + carried board | block   | **S10** `startRun` + **S9** `recordCarriedOverBoard`                            |
| — 3270-3400 | `processEventForStorage`             | closure | **S10** `record`                                                                |
| — 3402-3417 | execution_started + run counters     | block   | **S11** `run`                                                                   |
| — 3418-3458 | event queue                          | block   | **P4**                                                                          |
| — 3459-3464 | semaphore + activeCells              | block   | **S11** (private `executePhaseOne`)                                             |
| — 3466-3613 | phase 1 loop                         | block   | **S11** (private `executePhaseOne`, `executeOneCell`, `pickExecutor`)           |
| — 3615-3797 | phase 2 block                        | block   | **S11** (private `executePhaseTwo`, `emitSkipReasons`, `backfillSeededOutputs`) |
| — 3804-3845 | consume + finally                    | block   | **S11** `run`                                                                   |
| — 3847-3891 | failure log + done summary           | block   | **S11** (private `summary`)                                                     |
|   3897-3942 | `getLoadedDataForTarget`             | fn      | **S11** (private `loadedDataForTarget`)                                         |
|   3947-3955 | `requestAbort`                       | fn      | **facade** (stays; it is already one line onto the port)                        |

Nothing in the current file is unassigned. `requestAbort` stays on the facade
because wrapping a three-line delegation to `ExperimentRunAbortPort.requestAbort`
in a service class would be the pass-through layer the `overengineering` rule
exists to refuse.

---

## 6. Two type moves outside the file

1. `LoadedEvaluators` (line 2448) moves to
   `packages/features/experiment/server/src/services/experiment-execution-data.service.ts`
   and is exported from there. That module already loads the evaluators and
   already exports `LoadedWorkflow`, `promptLoadKey` and `workflowLoadKey`,
   which this file imports from it; the type belongs beside the load that
   produces it. Eight of the new modules import it.
   Add the export; change nothing else in that file.

2. `SeededTargetOutput` and `VariantEvaluatorScore` are **new** named types for
   object literals written out six and three times respectively. They are
   declared and exported by S1 and S2 in that order.

Neither is added to `src/index.ts`.

---

## 7. Method-level decomposition the ceilings require

Moving a method does not shrink it. These seven must also come apart, and the
splits are named in §5's sub-rows. Targets after the split:

| Function                  | Now          | After           | How                                                                                                                                                                                        |
| ------------------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `generateCells`           | m179 c29     | ≤80 / ≤24       | `generateCells` keeps the two precomputed-scope branches as `cellsForEvaluatorScope` / `cellsForEvaluatorAllRowsScope`, and the target expansion as `scopedTargetIds`; the row loop stays. |
| `generateComparisonCells` | m581 c35     | ≤80 / ≤24       | Seven closures to P2, five to private methods, the two loops become `planChipComparisons` and `planColumnComparisons`, the synthetic column evaluator becomes `syntheticColumnEvaluator`.  |
| `executeCell`             | m189 c21     | ≤80             | Three private methods per §5.                                                                                                                                                              |
| `executeWorkflowCell`     | m204 c29     | ≤80 / ≤24       | Three private methods per §5.                                                                                                                                                              |
| `buildEvaluatorInputs`    | m105 c24     | ≤80             | Two private methods per §5.                                                                                                                                                                |
| `buildTargetMetadata`     | m63 c27      | ≤24             | `targetModel` and `targetName` per §5.                                                                                                                                                     |
| `runOrchestrator`         | m791 s43 c42 | ≤80 / ≤24 / ≤24 | S10, P4 and the private methods per §5.                                                                                                                                                    |

One more: **line 1085** is 174 characters. Wrap the `logger.debug` message
across two string literals so no line exceeds 160. Do not shorten the sentence.

Projected module lines per new file, after the comment pass of §8 (all under
the 500 ceiling):

```
facade ~230 · S1 ~170 · S2 ~280 · S3 ~190 · S4 ~250 · S5 ~170
S6 ~270 · S7 ~55 · S8 ~145 · S9 ~180 · S10 ~175 · S11 ~390
P1 ~95 · P2 ~130 · P3 ~70 · P4 ~55
```

S11 is the tightest. If it lands over 500, move `loadedDataForTarget` and
`pickExecutor` to `processes/experiment-run-executor-choice.process.ts` — both
are pure functions of a `TargetConfig` and the loaded maps. Do not invent any
other escape.

---

## 8. The comment pass

61 blocks in this file exceed the 5-line maximum; 30 more are in the 4–5 line
review tier. They fail today and they will fail in whichever new file they land
in, because a changed file is checked at 6+ whatever the allowlist says.

**Follow the six-step procedure already written in
`dev/docs/plans/architecture-lint-burn-down-plan.md` § "What an agent does with
one block".** Do not invent a different rule. In summary, per block:

1. History (`used to`, `before #NNNN`, `the old`, incident narrative, the
   reasoning that led to the current shape) → delete. If it records a decision
   that still governs and no ADR states it, append a dated section to
   `packages/features/experiment/adrs/` and leave one line.
2. Restating the code or the types → delete.
3. The invariant a reader needs in order not to break the code → keep, ≤3
   lines, directly above the statement it guards.
4. JSDoc on an exported symbol → one summary line.
5. `@scenario` blocks, lint directives, licence and generated headers →
   untouched (already exempt).
6. `TODO`/`FIXME` → one line with the issue number, or delete.

Two things this file has a lot of, and how to treat them:

- **Issue numbers** (`#5100`, `#5101`, `#5131`, `#5378`, `#5528`, `#5789`,
  bugbash `2026-07-14`). Keep the number in the one line that survives. The
  number is how someone finds the history the paragraph is being trimmed of.
- **Reasons a guard exists** — "an evaluator that resolves nothing reports a
  pass, and that pass is counted in the run's pass rate", "a comparison cell
  for an out-of-scope row overwrites a verdict nobody asked to re-run". These
  are step 3, not step 1. They stay, at ≤3 lines, above the guard.

If a block genuinely needs more than five lines of durable narrative, it is an
ADR. Before claiming an ADR number, check for collisions across every branch:

```bash
git log --all --name-only --pretty=format: -- 'packages/features/experiment/adrs/*' | sort -u
```

`001-experiment-service-boundary.md` is the only one on this branch.

Do not "comply" by splitting a paragraph with blank lines to break the block
counter. The rule is about the amount of prose, not its shape.

---

## 9. The test split

Five test files import from this module today, plus two transport tests that
`vi.mock` its path. Every `@scenario` annotation and every `describe` / `it`
title below moves **verbatim** — same words, same punctuation, same nesting.
`check-feature-parity.ts` binds a scenario to a test by that annotation and
title, so changing either silently unbinds a spec.

### Files that move

**`experiment-run-orchestrator.generate-cells.unit.test.ts`** (366 lines) splits
three ways:

| Current describe / it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Goes to                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `describe("generateCells with evaluator-all-rows scope")`<br> `@scenario "Running evaluator on all rows creates one execution per row with target output"`<br> `it("creates one cell per row that has a pre-computed target output")`<br> `@scenario "Running evaluator on all rows creates one execution per row with target output"`<br> `it("skips target execution for each cell")`                                                                                                                                                                                                                                                                                                                                                     | `__tests__/experiment-cell-plan.unit.test.ts`                    |
| `describe("generateComparisonCells given a comparison the user has not finished configuring")`<br> `describe("when fewer than two columns are picked")` → `it("reports every scoped row instead of skipping in silence")`<br> `describe("when the golden answer is on but no column is picked for it")` → `it("reports the golden field as the thing to fix")`<br> `describe("when a picked column no longer exists")` → `it("reports the missing column rather than judging what is left")`<br> `describe("when the carrier is a chip evaluator on a variant column")` → `it("anchors the error on the first column it still has")`<br> (all four carry `@scenario "A comparison the user has not finished configuring says what to fix"`) | `__tests__/experiment-comparison-plan.unit.test.ts`              |
| `describe("given two datasets where the active one is not the first")`<br> `describe("when the run builds its cells")`<br> `@scenario "The run reads its mappings from the dataset the rows come from"` `it("reads the mapping bucket of the active dataset")`<br> `@scenario "The run reads its mappings from the dataset the rows come from"` `it("resolves the evaluator's inputs instead of dispatching an empty payload")`                                                                                                                                                                                                                                                                                                             | `__tests__/experiment-run-orchestrator.seams.unit.test.ts` (new) |

The last one crosses two collaborators — it builds a cell with S1 and reads its
inputs with S3 — so it becomes the facade's seam test and imports both names
from the facade. That is what proves the facade's delegation is wired, not just
present.

The shared fixture helpers at the head of the file (`createTestDataset`,
`twoDatasetState`, the state builders) are duplicated into each destination
rather than extracted to a shared module: they are 20-line literals, and a
shared fixture module under `__tests__` that three files import is a worse
coupling than the duplication.

**`experiment-run-orchestrator.storage-dispatch.unit.test.ts`** (109 lines) →
`__tests__/experiment-result-dispatch.unit.test.ts`, whole file, unchanged
except the import path:

- `describe("buildTargetMetadata given an evaluator target")` → `@scenario "The judge model is the one that actually ran"` `it("records the judging model from the evaluator's settings")`
- `describe("buildEvaluatorResultDispatch")`
  - `describe("given a judge that spent money and then declined to score")` → `@scenario "An inconclusive row still reports what it cost"` `it("records what the row cost, with no score to go with it")`
  - `describe("given a judge that declined without spending anything")` → `it("records no cost rather than a zero")`

**`build-target-metadata.unit.test.ts`** (141 lines) →
`__tests__/experiment-result-dispatch.target-metadata.unit.test.ts`, whole file:

- `describe("buildTargetMetadata — the judge model recorded on a run")`
  - `describe("given an evaluator target with no unsaved edits")` → `it("records the saved config's model")`
  - `describe("given the judge model was switched without saving")` → `it("records what execution will actually run, not the saved config")`
  - `describe("given an unsaved edit whose settings name no model")` → `it("records nothing, matching what execution resolves")`
  - `describe("given two columns pinned to different versions of one prompt")` → `@scenario "Two columns pinned to different versions of one prompt each run their own version"` `it("records each column's own version, not whichever loaded last")`

**`experiment-run-orchestrator.evaluator-dispatch-guard.integration.test.ts`**
(302 lines) → `__tests__/experiment-cell-execution.integration.test.ts`, whole
file. All six titles verbatim, including the two `@scenario` texts
`"An evaluator with no resolved inputs reports an error instead of a pass"` and
`"An evaluator column with no resolved inputs reports an error instead of passing"`.

**`experiment-run-orchestrator.execute-workflow-cell.integration.test.ts`**
(357 lines) → `__tests__/experiment-workflow-cell.integration.test.ts`, whole
file. All eight titles verbatim, including the six `@scenario` texts under
`describe("executeWorkflowCell")`.

**`experiment-run-orchestrator.connected-cell.integration.test.ts`** (440
lines) → `__tests__/experiment-connected-cell.integration.test.ts`, whole file.
All twelve titles verbatim. This one keeps importing `runOrchestrator`,
`OrchestratorInput` and `ExperimentRunPorts` **from the facade** — the two
`describe("given a personal development agent of another person")` cases run a
whole orchestration to prove the admission refusal, and that is a facade-level
behaviour.

### Files that do NOT move

`packages/features/experiment/server/src/transport/api-rest/__tests__/experiment-v3.execute-writes-cells.integration.test.ts`
and `…/experiment-v3.execute-run-state.integration.test.ts` each carry:

```ts
vi.mock("../../../services/experiment-run-orchestrator.service", () => ({
  requestAbort: vi.fn(),
  runOrchestrator: vi.fn(async function* () { … }),
}));
```

Because the facade keeps that path and keeps both names, these two files change
nothing. **Verify this rather than assume it** — a stale `vi.mock` path mocks
nothing and the test then runs the real orchestrator against fakes, which is a
failure mode that reads as a flake. Slice 12 greps for it.

### New seam tests required

Three, all in `__tests__/experiment-run-orchestrator.seams.unit.test.ts`:

1. The relocated `describe("given two datasets where the active one is not the
first")` above, verbatim.
2. `describe("given the facade's exported surface")` →
   `it("exports every name src/index.ts and the transport import")` — asserts
   the 25 exported names of §10 are present and are values or types, so a
   delegation dropped during a later slice fails here rather than at a caller.
3. `describe("given a run whose target is a connected agent")` →
   `it("forwards the injected dispatcher, clock and sleep into the connected
cell service")` — the one behaviour that moves from a per-call argument to a
   `create` dependency (S6), and therefore the one place the split can silently
   change what a caller gets.

No other new tests. Everything else is a move.

---

## 10. What must NOT change

**The facade's exported surface.** These 25 names (4 types, 21 values), with these exact signatures,
stay exported from
`packages/features/experiment/server/src/services/experiment-run-orchestrator.service.ts`:

```ts
export type ExperimentRunPorts
export type OrchestratorInput
export type ComparisonSkipReason        // re-exported type from P1
export type ConnectedDispatch
export const resolveScopedRowIndices = ({ scope, rowCount }) => number[]
export const generateCells = (state, datasetRows, scope, options = {}) => ExecutionCell[]
export const countScopedCells = ({ state, datasetRows, scope, seedTargetOutputs }) => number
export const formatList = (names: string[]) => string
export const comparisonSkipMessage = (reason) => { detail; errorType }
export const generateComparisonCells = ({ … }) => { cells; skipReasons }
export const priceMetrics = async (cost, projectId, metrics) => number | undefined
export async function* executeCell(cell, projectId, ports, datasetColumns, loadedData, workflows, resultMapperConfig?, isAborted?)
export async function* executeWorkflowCell({ … })
export async function* executeConnectedCell(input: ConnectedCellInput)
export const buildEvaluatorInputs = (cell, evaluatorId, targetOutput) => Record<string, unknown>
export const NO_INPUTS_RESOLVED = "NoInputsResolved"
export const evaluatorTargetDisplayName = ({ target, loadedEvaluators }) => string
export const evaluatorTargetHasNoResolvedInputs = ({ cell, loadedEvaluators }) => boolean
export const hasNoResolvedInputs = ({ cell, evaluator, inputs }) => boolean
export const buildTargetMetadata = ({ … }) => ESBatchEvaluationTarget[]
export const buildTargetResultDispatch = ({ … }) => RecordTargetResultCommandData | null
export const buildEvaluatorResultDispatch = ({ … }) => RecordEvaluatorResultCommandData
export const buildCarriedOverDispatches = ({ … }) => { targetResults; evaluatorResults }
export async function* runOrchestrator(input: OrchestratorInput)
export const requestAbort = async ({ abort, runId }) => Promise<void>
```

Positional stays positional. `generateCells`, `executeCell`, `priceMetrics` and
`buildEvaluatorInputs` keep their positional arguments at the facade even though
their collaborator methods take an object — the facade adapts. Changing them
would touch `src/index.ts`, `experiment-v3.api.ts`,
`experiment-polling-run.service.ts`, `experiment-workflow-evaluation.service.ts`
and `apps/api`, and this lane touches none of those files.

`src/index.ts` re-exports nine of these (`countScopedCells`, `executeCell`,
`executeWorkflowCell`, `priceMetrics`, `requestAbort`, `resolveScopedRowIndices`,
`runOrchestrator`, `ExperimentRunPorts`, `OrchestratorInput`) and does not
change.

**Event names.** Every `type:` string on an `EvaluationV3Event` — `cell_started`,
`target_result`, `evaluator_result`, `progress`, `execution_started`, `stopped`,
`done`, `error` — is a wire format read by the SSE stream, the polling runner
and the workbench. None of them changes.

**Command names.** The five `ExperimentService` calls — `startExperimentRun`,
`recordTargetResult`, `recordEvaluatorResult`, `completeExperimentRun` — and
`ExperimentEvaluationReportingPort.reportEvaluation`. Same names, same payload
field names, same order of dispatch. `carriedOver: true` stays on exactly the
rows it is on today.

**ClickHouse queries.** This file writes no SQL; it dispatches commands. The
payload field names those commands carry (`tenantId`, `runId`, `experimentId`,
`index`, `targetId`, `evaluatorId`, `predicted`, `cost`, `duration`, `error`,
`domainError`, `traceId`, `occurredAt`, `status`, `score`, `label`, `passed`,
`details`, `inputs`, `evaluatorName`, `carriedOver`) are column names on the
other side of the projection. None of them changes.

**Error copy and codes.** `comparisonSkipMessage`'s five `errorType` values
(`MissingVariantOutput`, `EmptyVariantOutput`, `TooFewComparisonVariants`,
`GoldenFieldNotSet`, `ComparisonVariantNotFound`), `NO_INPUTS_RESOLVED`,
`EvaluatorNoInputsResolvedError`, `UNNAMED_FAILURE`, and every `detail` string.
These are read by customers and pinned by tests.

**Log lines.** Every `logger.*` call keeps its message and its structured
fields. See §11 for the logger name.

**The KSUID prefix.** `EVALUATION_KSUID_RESOURCE = "eval"` and the reason it is
stated rather than imported.

---

## 11. The logger

The current file has one logger: `createLogger("langwatch:experiment:run-orchestrator")`.

**Every new module in this lane uses that same name**, unchanged. A fan-out into
twelve names would move every log query that names the run orchestrator, and the
observability stack is where this loop is debugged. Twelve modules sharing a
logger name is the right trade here; renaming them is a separate change with its
own dashboard work, and this lane is not it.

---

## 12. Findings recorded, not fixed

Three things this reading turned up. **Do not fix them in this lane** — a
refactor that also changes behaviour cannot be verified by "the tests still
pass". Record each one and move on.

1. **The run's sandbox credential is minted and then dropped.**
   `mintRunSandboxApiKey` (1414) mints a real key when a target runs Python.
   `withSandboxApiKey` (1441) is the function that would put it on the studio
   event's workflow, and it **has no caller anywhere in the repository**. The
   key is threaded into `loadedData.sandboxApiKey` (1474, 3497, 3755) and
   `buildCellWorkflow` never reads it
   (`processes/experiment-cell-workflow.process.ts` names no `sandboxApiKey` or
   `sandbox_api_key`). So a run with a code node mints a credential, pays for
   the mint, and executes with none.
   Carry `withSandboxApiKey` onto S7 as a public method, add a one-line comment
   naming the gap, and open a follow-up issue. Deleting it would remove the
   evidence that the seam was ever intended, which is how a wiring bug becomes
   permanent.

2. **Nine exported names have no consumer.** `formatList`,
   `buildTargetResultDispatch`, `buildCarriedOverDispatches`,
   `NO_INPUTS_RESOLVED`, `evaluatorTargetDisplayName`,
   `evaluatorTargetHasNoResolvedInputs`, `hasNoResolvedInputs`, and (outside the
   package) `priceMetrics` and `resolveScopedRowIndices` — the last two are
   exported from `src/index.ts` and imported by nothing in `apps/*`.
   They stay exported in this lane, because §10 freezes the surface and
   narrowing it is a separate, reviewable change. List them in the PR body so
   the narrowing can be scheduled.

3. **`countScopedCells` counts phase 1 only.** Its JSDoc says so, and the
   polling run publishes that number as the run's total before phase 2 exists.
   Behaviour preserved; noted because the split makes the two counts sit in two
   different files and the relationship becomes easier to lose.

---

## 13. Ordered slices

Each slice is one collaborator, leaves the package's tests green, and leaves the
facade's exported surface unchanged. Run the commands at the end of every slice
before starting the next.

**Commands used below** (all from the repository root):

```bash
# unit lane for this package
pnpm --filter @langwatch/experiment-server test

# integration lane, scoped to one file (the whole lane needs Postgres)
pnpm --filter @langwatch/experiment-server test:integration \
  src/services/__tests__/<file>.integration.test.ts

# architecture lint — not queued, no typecheck, prints "[policy] file:line"
pnpm --filter @langwatch/architecture-lint lint 2>&1 \
  | grep -E 'experiment/server/src/(services|processes)'

# formatter, once per slice
pnpm format
```

Never run `pnpm typecheck`, `pnpm typecheck:all`, or `tsc` in any form. Never
run bare `npx vitest` — the package scripts carry the guardrails. If a vitest
run is interrupted, sweep with `pkill -f "vitest/dist/workers"` before the next
one.

---

### Slice 1 — the comment pass, in place

No code moves. Bring all 61 over-limit blocks in
`experiment-run-orchestrator.service.ts` to ≤5 lines by §8's procedure, and wrap
line 1085 to ≤160 characters.

Done when:

```bash
pnpm --filter @langwatch/architecture-lint lint 2>&1 \
  | grep 'experiment-run-orchestrator.service.ts' \
  | grep comment-block-size          # expect: no output
pnpm --filter @langwatch/experiment-server test
```

Some suites read source text, so a comment edit can fail a test — that is a real
signal, not noise. Commit as `git commit -- packages/features/experiment/server/src/services/experiment-run-orchestrator.service.ts`.

### Slice 2 — S8 `ExperimentResultDispatchService`

Move lines 2620-2695, 2717-2773, 2786-2833 into
`services/experiment-result-dispatch.service.ts`. Split `buildTargetMetadata`
per §7. Rename to `tryBuildTargetResultDispatch` on the class only. Add three
delegating functions to the facade.

Move the two tests per §9 to `experiment-result-dispatch.unit.test.ts` and
`experiment-result-dispatch.target-metadata.unit.test.ts`.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 3 — S9 `ExperimentCarriedBoardService`

Move 2840-2846, 2849-2852, 2861-2895, 2898-2935, 2958-3008, 3024-3094 into
`services/experiment-carried-board.service.ts`. It takes S8 through `create`.
The facade's `buildCarriedOverDispatches` delegates; `recordCarriedOverBoard`
was never exported and stops being module-level.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 4 — P3 + S3 `ExperimentEvaluatorInputService`

First `processes/experiment-cell-error-events.process.ts` (1322-1342, 2417,
2444-2445, 2512-2524, 2561-2583), then
`services/experiment-evaluator-input.service.ts` (2276-2291, 2306-2414,
2420-2431, 2437-2441, 2455-2468, 2471-2480, 2494-2509, 2538-2558, 2591-2608).
Split `buildEvaluatorInputs` per §7. `LoadedEvaluators` moves to
`experiment-execution-data.service.ts` in this slice (§6).

Five facade delegations: `buildEvaluatorInputs`, `hasNoResolvedInputs`,
`evaluatorTargetHasNoResolvedInputs`, `evaluatorTargetDisplayName`, and
`NO_INPUTS_RESOLVED` (a const re-declared, not re-exported).

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 5 — S1 `ExperimentCellPlanService`

Move 201-229, 241-249, 254-439, 452-463 into
`services/experiment-cell-plan.service.ts`. Split `generateCells` per §7.
Declare and export `SeededTargetOutput`.

Create `__tests__/experiment-cell-plan.unit.test.ts` with the
`evaluator-all-rows` describe from §9, and
`__tests__/experiment-run-orchestrator.seams.unit.test.ts` with the two-dataset
describe.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 6 — P1 + P2 + S2 `ExperimentComparisonPlanService`

`processes/experiment-comparison-skip.process.ts` (487-524, 530-533, 542-580),
then `processes/experiment-comparison-candidates.process.ts` (the seven inner
closures listed in §5), then
`services/experiment-comparison-plan.service.ts` (the rest of 582-1196).
Declare and export `VariantEvaluatorScore`. Carry the `as unknown as
EvaluatorConfig` at line 1174 verbatim.

Facade: `formatList`, `comparisonSkipMessage`, `generateComparisonCells`
delegate; `export type { ComparisonSkipReason } from "../processes/experiment-comparison-skip.process"`. `ConnectedCellInput` stays declared on the facade and stays un-exported, as it is today.

Create `__tests__/experiment-comparison-plan.unit.test.ts` with the four
setup-skip describes from §9.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

This is the largest slice. If `experiment-comparison-plan.service.ts` lands
over 500 lines, the cause is comment prose that survived slice 1 — trim it, do
not add a fifth module.

### Slice 7 — S4 `ExperimentCellExecutionService`

Move 1206-1221, 1224-1235, 1244-1319, 1356-1384, 1464-1667 into
`services/experiment-cell-execution.service.ts`. Split `executeCell` per §7.
Export `LoadedCellData`. Rename to `tryPriceMetrics` on the class only.

Facade: `priceMetrics` and `executeCell` delegate, both keeping their positional
signatures.

Move `experiment-run-orchestrator.evaluator-dispatch-guard.integration.test.ts`
to `__tests__/experiment-cell-execution.integration.test.ts`.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm --filter @langwatch/experiment-server test:integration \
  src/services/__tests__/experiment-cell-execution.integration.test.ts
pnpm format
```

### Slice 8 — S5 `ExperimentWorkflowCellService`

Move 1678-1901 into `services/experiment-workflow-cell.service.ts`. It takes S4
through `create`. Split per §7.

Move `experiment-run-orchestrator.execute-workflow-cell.integration.test.ts` to
`__tests__/experiment-workflow-cell.integration.test.ts`.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm --filter @langwatch/experiment-server test:integration \
  src/services/__tests__/experiment-workflow-cell.integration.test.ts
pnpm format
```

### Slice 9 — S6 `ExperimentConnectedCellService`

Move 1912-1913, 1920-1931, 1937-1971, 1979-2015, 2048-2094, 2102-2141,
2149-2189, 2199-2232, 2243-2261, 2264-2268 into
`services/experiment-connected-cell.service.ts`. `ConnectedDispatch` and
`ConnectedCellInput` stay declared on the facade. `dispatch`, `sleep` and `now`
move to `create`; the facade's `executeConnectedCell(input)` forwards them.

Move `experiment-run-orchestrator.connected-cell.integration.test.ts` to
`__tests__/experiment-connected-cell.integration.test.ts`, and add seam test 3
of §9.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm --filter @langwatch/experiment-server test:integration \
  src/services/__tests__/experiment-connected-cell.integration.test.ts
pnpm format
```

### Slice 10 — S7 `ExperimentRunSandboxKeyService`

Move 1390-1404, 1414-1431, 1441-1458 into
`services/experiment-run-sandbox-key.service.ts`. Read §12 item 1 first. Neither
function is exported from the facade today and neither becomes exported.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 11 — P4 + S10 `ExperimentRunStorageService`

`processes/experiment-run-event-stream.process.ts` (3418-3458), then
`services/experiment-run-storage.service.ts` (115, 3165-3212, 3237-3251,
3270-3400, and the `completeExperimentRun` dispatch at 3831-3845). Nothing here
is exported from the facade.

At the end of this slice `runOrchestrator` is still in the facade, now roughly
420 lines, calling into S10 and P4. That is expected and temporary.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm format
```

### Slice 12 — S11 `ExperimentRunLoopService`; the facade becomes thin

Move what is left of 3100-3892 plus 3897-3942 into
`services/experiment-run-loop.service.ts`. Split per §5 and §7. Carry the `as
unknown as SingleEvaluationResult` at line 3681 verbatim.

The facade is now: the four exported types, `ConnectedCellInput`, 21 delegating values, and nothing else.

```bash
pnpm --filter @langwatch/experiment-server test
pnpm --filter @langwatch/experiment-server test:integration src/services
pnpm format
```

### Slice 13 — verification sweep

No code changes unless something below fails.

```bash
# 1. Every architecture policy on the new files
pnpm --filter @langwatch/architecture-lint lint 2>&1 \
  | grep -E 'experiment/server/src/(services|processes)'
#    expect: no service-quality, no comment-block-size, no
#    feature-source-layout, no fallible-result-naming on any new file

# 2. The two transport vi.mock paths still resolve to a real module
grep -rn 'vi.mock("../../../services/experiment-run-orchestrator.service"' \
  packages/features/experiment/server/src/transport/api-rest/__tests__/
ls packages/features/experiment/server/src/services/experiment-run-orchestrator.service.ts

# 3. No stale vi.mock anywhere in the repo naming a moved module
grep -rn 'vi.mock(' --include='*.test.ts' packages/features/experiment apps/api \
  | grep -i orchestrator

# 4. The package barrel is untouched
git diff --stat -- packages/features/experiment/server/src/index.ts   # expect: empty

# 5. Spec parity did not move
pnpm --filter @langwatch/architecture-lint check:feature-parity

# 6. No new double casts
grep -rn 'as unknown as' packages/features/experiment/server/src/services \
  packages/features/experiment/server/src/processes
#    expect: exactly two, in experiment-comparison-plan.service.ts and
#    experiment-run-loop.service.ts

# 7. No compat re-export of a value from the facade
grep -n 'export {' packages/features/experiment/server/src/services/experiment-run-orchestrator.service.ts
#    expect: no output (only `export type { … } from` is allowed, and only for
#    ComparisonSkipReason)

# 8. Whole package, both lanes
pnpm --filter @langwatch/experiment-server test
pnpm --filter @langwatch/experiment-server test:integration
pnpm format
```

Then hand to the integrator, who runs `pnpm typecheck:all` and `pnpm lint` once
for the whole repository.

---

## 14. Lint effect

**Cleared by this lane:**

| Policy                        | File                                     | Finding today                                                                                    | After                                                                                                                           |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `service-quality`             | `experiment-run-orchestrator.service.ts` | `lines 3956/500, longest method 791/80, statements 43/24, complexity 42/24, line length 174/160` | gone — the facade lands at ~230 lines, longest method ~3, complexity ~2, and every new `.service.ts` is under all five defaults |
| `comment-block-size`          | same file                                | 61 violations (largest 23 lines)                                                                 | gone after slice 1                                                                                                              |
| comment-block **review** tier | same file                                | 30 blocks at 4–5 lines                                                                           | reduced by slice 1; the tier is a review item, not a failure                                                                    |

`service-quality-baseline.json` is **not** touched. The file has no entry today
and gains none — the baseline is shrink-only and
`compareServiceQualityBaselines` refuses an added entry outright
(`Service quality baseline cannot add <file>`). Option (b) of decision 16 —
baselining it at its current size — is the option this lane replaces.

`comment-block-roots.json` is not touched by this lane either, but the
`packages/features/experiment/server` entry (263 blocks, expires 2026-10-01) can
be lowered by 61 in the C2 wave once this lands, which is the burn-down's own
accounting.

**New policies the split brings into range, all satisfied by §4's shape:**

| Policy                   | Applies because                                                            | How §4 satisfies it                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `fallible-result-naming` | it reads public methods of `.service.ts`, and this file has no class today | every method declares its return type; the three that can answer with nothing carry `try`; nothing is prefixed `require` |
| `feature-source-layout`  | eleven new `services/*.service.ts` and four new `processes/*.process.ts`   | all are `experiment-<kebab>.<artifact>.ts` under an allowed directory                                                    |
| `feature-source-subject` | new filenames claim a subject                                              | every name starts `experiment-`, the subject this package owns                                                           |
| `private-runtime-export` | `src/index.ts` is an entrypoint                                            | `src/index.ts` does not change; no new collaborator is exported from it                                                  |
| `test-colocation`        | six test files move                                                        | every destination is `services/__tests__/` beside its subject                                                            |

**Not affected:** `prisma-containment` and `typed-prisma-seam` (this file names
no `PrismaClient`), `package-cycle` (package-level, and no manifest changes),
`frontend-boundary` (no new import reaches a browser package), `overengineering`
(no new port, no identity function, no optional dependency nobody supplies —
`requestAbort` deliberately stays a facade function rather than becoming a
one-method service, for exactly that reason).
