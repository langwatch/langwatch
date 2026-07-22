import { definePipeline } from "../../";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  buildProcessEventView,
  handleCancelRequested,
  handleMessageSnapshot,
  handleQueued,
  handleSettled,
  handleStarted,
  handleTextMessageEnd,
  handleTextMessageStart,
  INITIAL_SCENARIO_EXECUTION_STATE,
  scenarioExecutionWake,
} from "./process-manager/scenarioExecution.process";
import {
  createScenarioExecutionFailRunHandler,
  type ScenarioExecutionDispatchDeps,
} from "./process-manager/scenarioExecutionIntentHandlers";
import {
  SCENARIO_EXECUTION_INTENT_TYPES,
  SCENARIO_EXECUTION_LEASE_DURATION_MS,
  SCENARIO_EXECUTION_MAX_ATTEMPTS,
  SCENARIO_EXECUTION_PROCESS_NAME,
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
import { ComputeRunMetricsCommand } from "./commands/computeRunMetrics.command";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  snapshotUpdateBroadcastReactor: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  cancellationBroadcastReactor: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  scenarioExecutionReactor: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  traceMetricsSyncReactor: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  customerIoSimulationSyncReactor?: ReactorDefinition<
    SimulationProcessingEvent,
    SimulationRunStateData
  >;
  /** Terminal-write dependencies for the `scenarioExecution` process (ADR-062). */
  scenarioExecutionDispatch: ScenarioExecutionDispatchDeps;
}

/**
 * The `scenarioExecution` process-manager topology, exported standalone so
 * tests can build the exact definition the runtime mounts.
 *
 * Every progress event re-arms the deadline; the terminal events clear it; a
 * fired wake writes the terminal state itself. See ADR-062 and
 * `scenarioExecution.process.ts`.
 */
export function scenarioExecutionPM(
  dispatch: ScenarioExecutionDispatchDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SCENARIO_EXECUTION_STATE)
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
  let builder = definePipeline<SimulationProcessingEvent>()
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
      deps.snapshotUpdateBroadcastReactor,
    )
    .withReactor(
      "simulationRunState",
      "cancellationBroadcast",
      deps.cancellationBroadcastReactor,
    )
    .withReactor(
      "simulationRunState",
      "traceMetricsSync",
      deps.traceMetricsSyncReactor,
    )
    .withReactor(
      "simulationRunState",
      "scenarioExecution",
      deps.scenarioExecutionReactor,
    );

  if (deps.customerIoSimulationSyncReactor) {
    builder = builder.withReactor(
      "simulationRunState",
      "customerIoSimulationSync",
      deps.customerIoSimulationSyncReactor,
    );
  }

  return builder
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
      deps.computeRunMetricsCommand,
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
