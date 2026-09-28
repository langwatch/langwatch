# Experiment run execution on the pipeline

Status: design, every decision ruled (section 10). Ruling: ARCHITECTURE.md §9 (Alex, 2026-09-28):
"An experiment run executes on its pipeline, never in a request". Scenarios:
`experiment-run-loop.feature`.

## 1. Pipeline: extend `experiment_run_processing`

The run's aggregate already exists: `experiment_run`, keyed `makeExperimentRunKey(experimentId, runId)`,
with StartExperimentRun, RecordTargetResult, RecordEvaluatorResult, CompleteExperimentRun and
RequestWorkflowEvaluation on it, and its fold (`experimentRunState`, ClickHouse) and item map
projection already reading those events. §9 keys a process manager and its projections to the
aggregate whose events they read, and the ruling names the run's own pipeline. A second pipeline
would split one aggregate's events across two streams and lose per-aggregate ordering between a
cell's results and the run's start and completion. So: extend it. No new aggregate.

## 2. Events (reuse first; new versions are additive)

| Event | Status | Carries |
| --- | --- | --- |
| `started` | new version | today's fields plus the **plan** (D4): `concurrency`, `origin: workbench \| saved \| workflow`, `persistResults`, `actor`, `scope`, the snapshot (targets, evaluators, dataset columns, the mapping dataset id, pinned prompt and workflow versions), the scoped rows once each, and the ordered cells: phase 1 (`ordinal, rowIndex, targetId, evaluatorIds`, plus an evaluator re-run's precomputed output and trace), then phase 2 (`ordinal, rowIndex, targetId, evaluatorId`, and a setup skip when the comparison cannot be built for any row) |
| `target_result`, `evaluator_result` | reused unchanged | appended by the cell command instead of the api's loop |
| `cell_finished` | **new** | `ordinal, phase, outcome: succeeded \| failed \| stopped \| skipped`, `error` (serialised HandledError) when failed. The cell failure event: one terminal per cell, whatever happened |
| `abort_requested` | **new** (RunAborted) | `requestedBy`, `occurredAt` |
| `completed` | reused, two new fields | `outcome: finished \| stopped \| failed`, and `error` (serialised HandledError) when failed |
| `trace_metrics_computed`, `workflow_evaluation_requested` | unchanged | |

The old `started` version still parses (no plan: a run started before the cut-over is folded, never
driven). Event ids are deterministic per cell (`<runId>:<ordinal>:<phase>:<kind>[:<evaluatorId>]`), so
a re-executed cell appends duplicates the store and the fold's applied-id set drop.

## 3. Commands

- **StartExperimentRun** (api; also the worker's workflow-evaluation subscriber). Validation happens in
  the request first (load data, row bound, ownership), so every 4xx stays synchronous. Appends `started`.
- **ExecuteExperimentCell** (worker, sent by the manager's `executeCell` intent handler). Runs one row x
  target: target dispatch, then its evaluators in order, appending `target_result`, `evaluator_result`s
  and `cell_finished`. A domain failure is an event, never a throw; only infrastructure errors throw,
  and the group queue retries them.
- **AbortExperimentRun** (api). Authorises against the run's tenant in the progress fold (the Redis
  owner record goes), sets the Redis abort flag (section 6) and appends `abort_requested`.
- **CompleteExperimentRun** (existing, sent by the manager's `complete` intent). Appends `completed`
  with the summary the manager hands it.
- **FailExperimentCell** (manager's stall intent, section 4, sent once per unfinished ordinal).
  Appends `cell_finished{failed, experiment_cell_lost}` under the same idempotency key a finishing cell
  uses, so a cell that finishes after all is dropped as a duplicate.

## 4. Process manager `experimentRunExecution`, keyed by the run's aggregate

Keyed by the aggregate id (`makeExperimentRunKey`), not the runId alone: runIds are unique only
within an experiment, and a run without one is keyed by its runId anyway (D3).

- **State:** `concurrency`, the phase-1 and phase-2 cell counts, the next unsent ordinal, a bitmap of
  finished ordinals (base64, n/8 bytes so a 5,000-cell run holds about 1 KB), `aborting`, and
  `lastActivityAt`. Counts only: the plan stays in `started` and the fold (D4).
- **`started`:** emits the first `concurrency` `executeCell` intents (`messageKey cell:<ordinal>:<phase>`),
  each carrying only `ordinal` and `phase` (D4), and arms a stall wake. The cell reads its row, target
  and evaluators from the run's fold, retrying while `started` is not folded yet.
- **`cell_finished`:** sets the ordinal's bit. Setting a set bit is a no-op, so a redelivered event,
  or a duplicate from a re-executed cell, counts once (the process inbox also dedups by event id).
  Re-arms the stall wake.
- **Phase 2 (D5):** the comparison cells are planned at start from the run's configuration and sit in
  the plan after phase 1, with any setup skip (too few variants, golden not set, variant not found)
  already on them. The manager sends none until every phase-1 bit is set, then windows them like phase
  1. Each comparison cell reads its row's variant outputs from the fold (D2) and either runs or finishes
  `skipped`, appending the skip's `evaluator_result` error first. The manager stays pure over counts.
- **Completion:** all bits of the last phase set, so emit `complete{finished}`. When aborting, complete
  once every *started* cell has finished (section 6), with `complete{stopped}`.
- **A worker dying mid-cell:** the group queue stops seeing its heartbeat. After `activeTtlSec` (300 s)
  the job is redelivered and the cell re-runs; the deterministic event ids make that safe. The only
  unavoidable duplicate is the model spend. Repeated deaths trip the queue's poison guard and block the
  lane. The manager's stall wake (default 15 min without a `cell_finished`, precedent: scenario's
  `simulationRunExecutionWake`) then emits FailExperimentCells for every unfinished ordinal, so the run
  completes with errors instead of hanging.

## 5. Concurrency: the manager is the window (D1, ruled (b))

`concurrency = request.concurrency ?? config.runConcurrency ?? 10`. `runConcurrency` is a new leaf on
`experimentConfig` reading `EVAL_V3_CONCURRENCY`, restoring main's knob (the branch hard-codes 10). It
is fixed at start and recorded in `started`. The manager sends the first `concurrency` cell intents on
`started`, then the next unsent ordinal on each `cell_finished`, so at most `concurrency` cells of one
run are in flight; phase 2 opens only once phase 1 has drained. Each cell is its own
queue group (`__routing.groupKey = <run key>:cell:<ordinal>:<phase>`, `dedupId =
<runId>:<ordinal>:<phase>`), which is work-conserving like main's semaphore, and an abort leaves
nothing queued beyond the cells already sent. Emission is serial through the manager.

## 6. Abort

AbortExperimentRun sets `eval_v3_abort:<runId>` (1 h TTL, main's key) through
`RedisExperimentRunAbortRepository`, then appends `abort_requested`. The manager sets `aborting` and
emits nothing more; phase 2 is never planned. Queued cells still dequeue, see the flag and finish at
once with `cell_finished{stopped}` without dispatching. The cell handler reads the **Redis flag** at
main's four points:

1. when the command starts (main: before the slot);
2. after its preparation, before dispatch (main: after the slot);
3. between the engine's events;
4. inside the studio stream, polled each second through `WorkflowApi.postStudioEvent({ isAborted })`.

Why the flag and not the projection: the fold lags the abort behind every result event already queued
on the aggregate, and the per-second read inside the stream must be one cheap key read. The event is
the durable record the manager honours, and the flag is the fast signal. The flag is cleared on `completed`.

## 7. Reads

- **Projection `experimentRunProgress`** (new fold, Redis store under main's key `eval_v3_run:<runId>`,
  24 h TTL). It has the same JSON the pollers read today: `runId, projectId, experimentId,
  experimentSlug, status, progress, total, startedAt, finishedAt, summary, runUrl, error, recentEvents`
  (last 50). It adds `seq` (per-run frame counter), the run's plan from `started` (D4), which every
  cell reads its inputs from, and the `results` draft (`applyRunEvent` over targetOutputs and
  evaluatorResults), which feeds write-back and the comparison cells (D2, D5). **The imperative Redis
  progress store goes.** Its read (`findRunState`) stays over the fold store, and its writers
  (createRun, addEvent, completeRun, failRun, stopRun) are deleted.
- **SSE push path**, precedent: `RedisScenarioEventBroadcastChannel` and notification's
  `broadcast:<type>` Redis publish, relayed by the api process to its open streams.
  - A worker event subscriber (not fold-attached, no delay) maps each run event to its
    `EvaluationV3Event` frame (`execution_started, target_result, evaluator_result, progress, stopped,
    done, error`) and publishes `{seq, frame}` on `experiment_run:<runId>` through a new channel
    `ExperimentRunEventStream`, with Redis and memory twins.
  - `cell_started` is published by the cell command straight onto the same channel, not appended.
    It is ephemeral, as main's was.
  - The api handler **subscribes first, then sends StartExperimentRun, then streams**, so it misses no
    frame. It ends on `done` or `stopped`.
  - Latency: one queue hop and one publish, roughly 50 to 300 ms per frame against main's
    in-process zero.
- **Polled `GET /runs/:runId`** and `/results` read the fold. Wire unchanged.
- **Other tabs:** they poll the same fold, which is what main's `runStateMirror` gave them. A reconnecting
  SSE replays `recentEvents` after its last `seq`, then follows the channel.
- **Board write-back** (main's per-event writer for execute, and `writeCellsBack` for saved-dataset
  runs): a projection subscriber on `experimentRunProgress`, coalesced per run (1 s), writes the
  `results` draft to the saved workbench when `persistResults` is set, with a final write on `completed`.
- **Workflow evaluations:** the api still registers the run and sends RequestWorkflowEvaluation. The
  worker's subscriber now prepares the run (workflow, version, dataset) and sends StartExperimentRun;
  a refusal appends `completed{failed}` with the code.

## 8. Collaborators per handler, and what is deleted

- **ExecuteExperimentCell:** its cell from the progress fold's plan, and for a comparison its row's
  variant outputs from the fold's results; studio (`WorkflowApi.postStudioEvent`), cost (`ExperimentRunModelCostService`),
  evaluator reporting (`EvaluationApi.reportEvaluation`), sandbox key (`ExperimentRunSandboxCredentialService`,
  minted per cell and shared through ApiKey's Redis), connected dispatch (`AgentApi.callConnected`),
  attachments (`ExperimentAttachmentInputService`), and the abort flag.
- **The api's start:** `SuiteApi.assertConnectedAgentsRunnable`, execution-data loading, and the plan:
  phase-1 cells from `ExperimentCellPlanService`, phase-2 cells and setup skips from the comparison
  planner's configuration half.
- **Deleted:**
  - the orchestrator/driver async generator, `createEventStream`'s in-memory queue, `createSemaphore`
    and `ExperimentRunLoopService`;
  - `ExperimentPollingRunService` (`void runExecution`) and `ExperimentRunStateMirrorService`;
  - `ExperimentV3RunLoop.ports`/`startRun` and the collaborators held on the App;
  - `buildExperimentRunLoop`, the Redis owner record, and the uncommitted in-process `startRun`.
  - The collaborators move into the cell command's service unchanged.

## 9. Wire against main

Unchanged: every path, method, status, body, the SSE content type and frame shapes, the polled answer
`{ runId, status: "running", total, runUrl }`, abort's `{ success, runId, message }` and the 404 for a
foreign run, and GET runs' bodies. Differences:

1. Frame latency (section 7).
2. `cell_started` frames are best-effort (ephemeral publish).
3. SSE from a closed tab no longer stops the run. Main's execute stopped when the request died,
   because the generator was the run. The run now continues and completes, and the board still fills.
4. Abort of a queued-but-unstarted cell reports it `stopped` (main never started it and sent no frame).
5. A dead worker's cell is retried after 300 s instead of failing the request.
6. Ownership refusal: unchanged observably. SSE emits the same `error` frame; a polled run answers
   started, then polls `failed` with `agent_owner_only`, as main's background run did.
7. The progress total counts the comparison cells from the start; main's total grew by them after
   phase 1. A skipped comparison row is a cell that finishes `skipped`, still with its
   `evaluator_result` error frame, where main emitted the frame outside the cell count.

## 10. Decisions

Ruled (Alex, 2026-09-28, recorded in ARCHITECTURE.md §9):

- **D1 (b):** the manager is the concurrency window. It sends `concurrency` cell intents, then one per
  `cell_finished`, each cell its own queue group (section 5).
- **D2 (a):** phase 2 reads phase-1 outputs from the run's fold (the `results` draft of section 7),
  retrying while an output is not folded yet. No new state.
- **D3 (a):** a run without an experiment is keyed by runId alone; the ClickHouse projections skip
  it, as main skipped its ClickHouse writes.

Ruled after building began (Alex, 2026-09-28, ARCHITECTURE.md §9):

- **D4 (a):** a cell intent carries only its ordinal and phase. `started` carries the scoped plan, the
  run's fold keeps it, and each cell reads its row, target and evaluators from the fold.
- **D5 (b):** the comparison set is planned from the run's configuration at start, so per-comparison
  setup skips land in the plan. Each comparison cell reads its own row's variant outputs from the
  fold and either runs or finishes skipped. No `comparisons_planned` event, no planning command.

## 11. Tests (installation, through `createApp`: in-memory event and process store, `memoryRedisDouble()`, peer fixtures)

1. Execute to `done`: api boot and worker boot share the event store. SSE frames arrive in order,
   produced by the worker's cell commands.
2. Polled `/:slug/run`: answers started at once; GET `/runs/:runId` reads `completed` from the fold.
3. Worker workflow evaluation: `workflow_evaluation_requested` leads to a StartExperimentRun and completion.
4. Abort mid-run: the rest stop, the stream ends `stopped`, and the fold reads `stopped`.
5. Ownership refusal: `agent_owner_only` before any cell command is sent.
6. Redelivery: `cell_finished` and ExecuteExperimentCell delivered twice count once, and progress ends at the total.
7. A lost cell: a cell command that never finishes, then the stall wake fails it, and the run completes with errors.
8. Concurrency: with concurrency 2, at most two cells of one run are in flight.
9. Refusals: no Redis, no public address, and a row bound exceeded are all refused before any command.
