import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { CancellationPublisher } from "~/server/scenarios/cancellation-channel";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import {
  buildProcessEventView,
  handleCancelRequested,
  handleMessageSnapshot,
  handleQueued,
  handleSettled,
  handleStarted,
  handleTextMessageEnd,
  handleTextMessageStart,
  scenarioExecutionWake,
} from "./process-manager/scenarioExecution.process";
import {
  createScenarioExecutionExecuteRunHandler,
  createScenarioExecutionFailRunHandler,
  type ScenarioExecutionDispatchDeps,
} from "./process-manager/scenarioExecutionIntentHandlers";
import {
  INITIAL_SCENARIO_EXECUTION_STATE,
  SCENARIO_EXECUTION_CONCURRENCY,
  SCENARIO_EXECUTION_INTENT_TYPES,
  SCENARIO_EXECUTION_LEASE_DURATION_MS,
  SCENARIO_EXECUTION_MAX_ATTEMPTS,
  SCENARIO_EXECUTION_PROCESS_NAME,
  scenarioExecutionExecuteRunIntentSchema,
  scenarioExecutionFailRunIntentSchema,
} from "./process-manager/scenarioExecutionProcess.types";
import { SIMULATION_RUN_EVENT_TYPES } from "./schemas/constants";
import {
  CancelRunCommand,
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
  QueueRunCommand,
  StartRunCommand,
  TextMessageEndCommand,
  TextMessageStartCommand,
} from "./commands";
import {
  ComputeRunMetricsCommand,
  type ComputeRunMetricsDeps,
} from "./commands/computeRunMetrics.command";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import { createCancellationBroadcastReactor } from "./reactors/cancellationBroadcast.reactor";
import { createSnapshotUpdateBroadcastReactor } from "./reactors/snapshotUpdateBroadcast";
import { createTraceMetricsSyncReactor } from "./reactors/traceMetricsSync.reactor";
import type { SimulationProcessingEvent } from "./schemas/events";

/**
 * ADR-077 Rule 1 — nothing here is a value the builder registers. Every
 * reactor and the one DI'd command are constructed in this file from imported
 * factories, so the topology is readable without the registry. The members are
 * wider than they were and all of them are inert: two fold stores, a broadcast
 * service, a publisher, two function ports, the command bus, and the process's
 * own dispatch bundle.
 */
export interface SimulationProcessingPipelineDeps {
  /** Redis-cached fold store for `simulationRunState`. */
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /**
   * The trace pipeline's summary fold, read by `computeRunMetrics`' pull path
   * when a trace's metrics were not carried on the command.
   */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** SSE fan-out for the run drawer. */
  broadcast: BroadcastService;
  /** Whether a Redis connection backs the broadcast tier. */
  hasRedis: boolean;
  /** Redis pub/sub for cancellation; null when no Redis is configured. */
  cancellationPublisher: CancellationPublisher | null;
  /** Per-role cost/latency for a trace, derived from stored spans. */
  deriveScenarioRoleMetrics: ComputeRunMetricsDeps["deriveScenarioRoleMetrics"];
  /**
   * Re-enqueues `computeRunMetrics` after a delay when the trace summary has
   * not landed yet.
   *
   * Late-bound at the composition root: the retry lane is a job on this
   * pipeline's *runtime* service, which only exists once `register()` has
   * returned, and the static builder has no job declaration. The command bus
   * cannot absorb this one — it keys command classes, and this is not a
   * command.
   */
  scheduleComputeRunMetricsRetry: ComputeRunMetricsDeps["scheduleRetry"];
  /**
   * ADR-077 §5 — identity-keyed command dispatch. Used here for a *self*
   * reference: `traceMetricsSync` dispatches `computeRunMetrics`, which this
   * same pipeline registers. Binding is eager, resolution is not, so the
   * pipeline being mid-construction carries no meaning.
   */
  commands: CommandBus;
  /**
   * Dispatch and terminal-write dependencies for the `scenarioExecution`
   * process (ADR-073).
   */
  scenarioExecutionDispatch: ScenarioExecutionDispatchDeps;
}

/**
 * The `scenarioExecution` process-manager topology, exported standalone so
 * tests can build the exact definition the runtime mounts.
 *
 * `queued` enqueues the dispatch and arms a deadline; every progress event
 * re-arms it; the terminal events clear it; a fired wake writes the terminal
 * state itself. See ADR-073 and `scenarioExecution.process.ts`.
 *
 * The outbox is sized by the dispatch, not by the terminal write: the lease
 * has to outlast a whole child process, and `concurrency` is what bounds how
 * many children a worker holds — the job the pool's deleted `_pending` array
 * used to do.
 */
export function scenarioExecutionPM(
  dispatch: ScenarioExecutionDispatchDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SCENARIO_EXECUTION_STATE)
      .intent(
        SCENARIO_EXECUTION_INTENT_TYPES.EXECUTE_RUN,
        scenarioExecutionExecuteRunIntentSchema,
        createScenarioExecutionExecuteRunHandler(dispatch),
      )
      .intent(
        SCENARIO_EXECUTION_INTENT_TYPES.FAIL_RUN,
        scenarioExecutionFailRunIntentSchema,
        createScenarioExecutionFailRunHandler(dispatch),
      )
      .on(SIMULATION_RUN_EVENT_TYPES.QUEUED, handleQueued)
      .on(SIMULATION_RUN_EVENT_TYPES.STARTED, handleStarted)
      .on(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT, handleMessageSnapshot)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START, handleTextMessageStart)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END, handleTextMessageEnd)
      .on(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED, handleCancelRequested)
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleSettled)
      .on(SIMULATION_RUN_EVENT_TYPES.DELETED, handleSettled)
      .onWake(scenarioExecutionWake)
      .toPayload(buildProcessEventView)
      .outbox({
        maxAttempts: SCENARIO_EXECUTION_MAX_ATTEMPTS,
        leaseDurationMs: SCENARIO_EXECUTION_LEASE_DURATION_MS,
        concurrency: SCENARIO_EXECUTION_CONCURRENCY,
        batchSize: SCENARIO_EXECUTION_CONCURRENCY,
      });
}

/**
 * Creates the simulation processing pipeline definition.
 *
 * This pipeline uses simulation_run aggregates (aggregateId = scenarioRunId).
 * It tracks the lifecycle of simulation runs:
 * - started -> message snapshots -> finished (or deleted)
 *
 * Fold Projection: simulationRunState
 * - Tracks simulation run state (status, messages, verdict, etc.)
 * - Stored in simulation_runs ClickHouse table
 *
 * Commands:
 * - startRun: Emits SimulationRunStartedEvent when run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent for message updates
 * - finishRun: Emits SimulationRunFinishedEvent when run completes
 * - deleteRun: Emits SimulationRunDeletedEvent for soft-delete
 * - computeRunMetrics: Computes cost/latency metrics from traces (ECST + pull)
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
) {
  return definePipeline<SimulationProcessingEvent>()
    .withName("simulation_processing")
    .withAggregateType("simulation_run")
    .withFoldProjection(
      "simulationRunState",
      new SimulationRunStateFoldProjection({
        store: deps.simulationRunStore,
      }),
    )
    .withReactor(
      "simulationRunState",
      "snapshotUpdateBroadcast",
      createSnapshotUpdateBroadcastReactor({
        broadcast: deps.broadcast,
        hasRedis: deps.hasRedis,
      }),
    )
    .withReactor(
      "simulationRunState",
      "cancellationBroadcast",
      createCancellationBroadcastReactor({
        publisher: deps.cancellationPublisher,
      }),
    )
    // Self-dispatch (ADR-077 §5): on RunFinished this reactor sends
    // `computeRunMetrics`, a command registered a few lines below. The port
    // binds now and resolves on first dispatch, so a pipeline dispatching into
    // itself needs no late-binding step from the composition root.
    .withReactor(
      "simulationRunState",
      "traceMetricsSync",
      createTraceMetricsSyncReactor({
        computeRunMetrics: deps.commands.port(ComputeRunMetricsCommand),
      }),
    )
    .withCommand("queueRun", QueueRunCommand)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("textMessageStart", TextMessageStartCommand)
    .withCommand("textMessageEnd", TextMessageEndCommand)
    .withCommand("finishRun", FinishRunCommand)
    .withCommand("cancelRun", CancelRunCommand)
    .withCommand("deleteRun", DeleteRunCommand)
    .withCommandInstance(
      "computeRunMetrics",
      ComputeRunMetricsCommand,
      new ComputeRunMetricsCommand({
        traceSummaryStore: deps.traceSummaryStore,
        scheduleRetry: deps.scheduleComputeRunMetricsRetry,
        deriveScenarioRoleMetrics: deps.deriveScenarioRoleMetrics,
      }),
      {
        deduplication: {
          makeId: ComputeRunMetricsCommand.makeJobId,
          ttlMs: 60_000,
        },
      },
    )
    .withProcessManager(
      SCENARIO_EXECUTION_PROCESS_NAME,
      scenarioExecutionPM(deps.scenarioExecutionDispatch),
    )
    .build();
}
