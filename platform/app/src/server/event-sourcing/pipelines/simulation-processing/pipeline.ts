import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
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
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  type SimulationRunExecutionDispatchDeps,
  simulationRunExecutionPM,
} from "./process-manager";
import {
  SimulationRunMetricsMapProjection,
  type SimulationRunMetricsProjectionRecord,
} from "./projections/simulationRunMetrics.mapProjection";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import { SIMULATION_PROCESSING_EVENT_TYPES } from "./schemas/constants";
import type { SimulationProcessingEvent } from "./schemas/events";
import {
  createSnapshotUpdateBroadcastSubscriber,
  type SnapshotUpdateBroadcastSubscriberDeps,
} from "./subscribers/snapshotUpdateBroadcast.subscriber";
import {
  createSuiteRunSyncSubscriber,
  type SuiteRunSyncSubscriberDeps,
} from "./subscribers/suiteRunSync.subscriber";
import {
  createTraceMetricsSyncSubscriber,
  type TraceMetricsSyncSubscriberDeps,
} from "./subscribers/traceMetricsSync.subscriber";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /** Append store backing the simulationRunMetrics map projection. */
  simulationRunMetricsStore: AppendStore<SimulationRunMetricsProjectionRecord>;
  /** Pre-constructed with `loadPriorEvents` for ECST backfill. */
  finishRunCommand: FinishRunCommand;
  computeRunMetricsCommand: ComputeRunMetricsCommand;
  /** Dispatch deps for the simulationRunExecution process manager (ADR-052). */
  simulationRunExecution: SimulationRunExecutionDispatchDeps;
  snapshotUpdateBroadcast: SnapshotUpdateBroadcastSubscriberDeps;
  suiteRunSync: SuiteRunSyncSubscriberDeps;
  traceMetricsSync: TraceMetricsSyncSubscriberDeps;
}

/**
 * Creates the simulation processing pipeline definition.
 *
 * This pipeline uses simulation_run aggregates (aggregateId = scenarioRunId).
 * It tracks the lifecycle of simulation runs:
 * - queued -> started -> message snapshots -> finished (or deleted)
 *
 * Architecture (event-carried state, ADR-052):
 * - Commands append facts to the ClickHouse event_log; FinishRunCommand
 *   backfills ECST identity/traceIds from the run's prior events.
 * - Fold projection simulationRunState tracks run state (status, messages,
 *   verdict, etc.) in the simulation_runs ClickHouse table.
 * - Map projection simulationRunMetrics appends one row per
 *   metrics_computed event (metrics are computed upstream by
 *   ComputeRunMetricsCommand and carried on the event).
 * - Subscribers own side effects (SSE broadcast, suite-run sync, trace
 *   metrics pull) from event payloads only.
 * - The simulationRunExecution process manager owns the execution
 *   lifecycle: dispatch to the worker pool, cancellation broadcast with a
 *   force-terminal backstop, and the stall watchdog.
 *
 * Commands:
 * - queueRun: Emits SimulationRunQueuedEvent when a run is scheduled
 * - startRun: Emits SimulationRunStartedEvent when run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent for message updates
 * - finishRun: Emits SimulationRunFinishedEvent when run completes
 * - deleteRun: Emits SimulationRunDeletedEvent for soft-delete
 * - computeRunMetrics: Computes cost/latency metrics from traces (ECST + pull)
 */
export function createSimulationProcessingPipeline(
  deps: SimulationProcessingPipelineDeps,
) {
  return definePipeline<SimulationProcessingEvent>({
    name: "simulation_processing",
    aggregate: defineAggregate({
      type: "simulation_run",
      events: defineEvents(SIMULATION_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      new SimulationRunStateFoldProjection({
        store: deps.simulationRunStore,
      }),
    )
    .withClickHouseMapProjection(
      new SimulationRunMetricsMapProjection({
        store: deps.simulationRunMetricsStore,
      }),
    )
    .withEventSubscriber(
      "snapshotUpdateBroadcast",
      createSnapshotUpdateBroadcastSubscriber(deps.snapshotUpdateBroadcast),
    )
    .withEventSubscriber("suiteRunSync", createSuiteRunSyncSubscriber(deps.suiteRunSync))
    .withEventSubscriber(
      "traceMetricsSync",
      createTraceMetricsSyncSubscriber(deps.traceMetricsSync),
    )
    .withProcessManager(
      SIMULATION_RUN_EXECUTION_PROCESS_NAME,
      simulationRunExecutionPM(deps.simulationRunExecution),
    )
    .withCommand("queueRun", QueueRunCommand)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("textMessageStart", TextMessageStartCommand)
    .withCommand("textMessageEnd", TextMessageEndCommand)
    .withCommandInstance("finishRun", FinishRunCommand, deps.finishRunCommand)
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
    .build();
}
