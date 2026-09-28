# Experiment run execution on the pipeline

Status: design, for review. Ruling: ARCHITECTURE.md §9 (Alex, 2026-09-28): "An experiment run executes
on its pipeline, never in a request". Scenarios: `experiment-run-execution.feature`.

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
| `started` | new version | today's fields plus the **plan**: `concurrency`, the ordered cell list (`ordinal, rowIndex, targetId, phase: 1`), the run snapshot (targets, evaluators, dataset columns, pinned prompt versions, agent and workflow version ids), `scope`, `actor`, `persistResults`, `origin: workbench \| saved \| workflow` |
| `target_result`, `evaluator_result` | reused unchanged | appended by the cell command instead of the api's loop |
| `cell_finished` | **new** | `ordinal, phase, outcome: succeeded \| failed \| stopped`, `error` (serialised HandledError) when failed. The cell failure event: one terminal per cell, whatever happened |
| `abort_requested` | **new** (RunAborted) | `requestedBy`, `occurredAt` |
| `completed` | reused, one new field | `outcome: finished \| stopped \| failed` |
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
- **FailExperimentCells** (manager's stall intent, section 4). Appends `cell_finished{failed,
  experiment_cell_lost}` for the ordinals it names.

## 4. Process manager `experimentRunExecution`, keyed by runId

- **State:** `phase`, `concurrency`, `planned` count, a bitmap of finished ordinals (base64, n/8 bytes
  so a 5,000-cell run holds about 1 KB), `aborting`, the phase-2 descriptor, and `lastActivityAt`.
- **`started`:** emits one `executeCell` intent per phase-1 cell (`messageKey cell:<ordinal>:1`), each
  carrying its row, target config, evaluators and pinned entities (never the sandbox key), and arms a stall wake.
- **`cell_finished`:** sets the ordinal's bit. Setting a set bit is a no-op, so a redelivered event,
  or a duplicate from a re-executed cell, counts once (the process inbox also dedups by event id).
  Re-arms the stall wake.
- **Phase 2:** when every phase-1 bit is set and the run has a pairwise comparison, the manager plans
  the comparison cells (ordinals after phase 1) with `ExperimentComparisonPlanService`'s pure rules and
  emits their intents. Its inputs are which variants succeeded per row, which the manager holds as bits.
  The outputs themselves come from the fold (decision D2).
- **Completion:** all bits of the last phase set, so emit `complete{finished}`. When aborting, complete
  once every *started* cell has finished (section 6), with `complete{stopped}`.
- **A worker dying mid-cell:** the group queue stops seeing its heartbeat. After `activeTtlSec` (300 s)
  the job is redelivered and the cell re-runs; the deterministic event ids make that safe. The only
  unavoidable duplicate is the model spend. Repeated deaths trip the queue's poison guard and block the
  lane. The manager's stall wake (default 15 min without a `cell_finished`, precedent: scenario's
  `simulationRunExecutionWake`) then emits FailExperimentCells for every unfinished ordinal, so the run
  completes with errors instead of hanging.

## 5. Concurrency: the group queue's, per run

`concurrency = request.concurrency ?? config.runConcurrency ?? 10`. `runConcurrency` is a new leaf on
`experimentConfig` reading `EVAL_V3_CONCURRENCY`, restoring main's knob (the branch hard-codes 10). It
is fixed at start and recorded in `started`. The queue runs one job per group at a time, so
ExecuteExperimentCell routes through `__routing.groupKey = <experimentId>:<runId>:lane:<ordinal mod
concurrency>`, with `score` = ordinal (FIFO within a lane) and `dedupId = <runId>:<ordinal>:<phase>`.
That gives at most `concurrency` cells of one run in flight, and runs don't contend beyond the global
worker concurrency. The difference from main's semaphore: lanes are static, so one slow cell delays
the rest of its lane while other lanes may already be idle (decision D1).

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
  (last 50). It adds `seq` (per-run frame counter) and the `results` draft (`applyRunEvent` over
  targetOutputs and evaluatorResults), which feeds write-back and phase 2. **The imperative Redis
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

- **ExecuteExperimentCell:** studio (`WorkflowApi.postStudioEvent`), cost (`ExperimentRunModelCostService`),
  evaluator reporting (`EvaluationApi.reportEvaluation`), sandbox key (`ExperimentRunSandboxCredentialService`,
  minted per cell and shared through ApiKey's Redis), connected dispatch (`AgentApi.callConnected`),
  attachments (`ExperimentAttachmentInputService`), and the abort flag.
- **The api's start:** `SuiteApi.assertConnectedAgentsRunnable` plus execution-data loading.
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

## 10. Decisions for Alex

- **D1 Concurrency shape.**
  - (a) Static lanes per the ruling: simple, but head-of-line blocking within a lane.
  - (b) The manager is the window: it emits `concurrency` intents, then one per `cell_finished`, each
    cell its own group. Work-conserving like main, and abort leaves nothing queued, but emission is
    serial through the manager.
  - I'd pick (b) if main's throughput on uneven cells matters. It reads "the queue's" as the queue
    enforcing one-per-group.
- **D2 Where phase 2 reads phase-1 outputs.**
  - (a) The fold's `results` draft, retrying while an output is not folded yet. Recommended: no new state.
  - (b) A Redis run-output hash the cell command writes.
  - (c) The manager's state: pure, but its size grows with outputs.
- **D3 Runs without an experiment** (execute's `experimentId` is optional).
  - (a) Key the aggregate by runId alone and have the ClickHouse projections skip rows without an
    experiment, as main skipped its ClickHouse writes.
  - (b) Require an experiment, creating one on first run.

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
