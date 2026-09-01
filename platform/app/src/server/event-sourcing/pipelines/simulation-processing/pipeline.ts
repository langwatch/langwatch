import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import {
  CancelRunCommand,
  DeleteRunCommand,
  FinishRunCommand,
  MessageSnapshotCommand,
  QueueRunCommand,
  RecordAgentInstanceCommand,
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
import type { SimulationProcessingEvent } from "./schemas/events";
import {
  type CustomerIoSimulationSyncSubscriberDeps,
  createCustomerIoSimulationSyncSubscriber,
} from "./subscribers/customerIoSimulationSync.subscriber";
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
  customerIoSimulationSync?: CustomerIoSimulationSyncSubscriberDeps;
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
 *   metrics pull, Customer.io sync) from event payloads only.
 * - The simulationRunExecution process manager owns the execution
 *   lifecycle: dispatch to the worker pool, cancellation broadcast with a
 *   force-terminal backstop, and the stall watchdog.
 *
 * Commands:
 * - queueRun: Emits SimulationRunQueuedEvent when a run is scheduled
 * - startRun: Emits SimulationRunStartedEvent when run begins
 * - messageSnapshot: Emits SimulationMessageSnapshotEvent for message updates
 * - finishRun: Emits SimulationRunFinishedEvent when run completes
 * - recordAgentInstance: Emits SimulationRunAgentInstanceRecordedEvent with
 *   the connected agent instance that served the run
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
    .withMapProjection(
      "simulationRunMetrics",
      new SimulationRunMetricsMapProjection({
        store: deps.simulationRunMetricsStore,
      }),
    )
    .withSubscriber(
      "snapshotUpdateBroadcast",
      createSnapshotUpdateBroadcastSubscriber(deps.snapshotUpdateBroadcast),
    )
    .withSubscriber(
      "suiteRunSync",
      createSuiteRunSyncSubscriber(deps.suiteRunSync),
    )
    .withSubscriber(
      "traceMetricsSync",
      createTraceMetricsSyncSubscriber(deps.traceMetricsSync),
    )
    .withProcessManager(
      SIMULATION_RUN_EXECUTION_PROCESS_NAME,
      simulationRunExecutionPM(deps.simulationRunExecution),
    );

  if (deps.customerIoSimulationSync) {
    builder = builder.withSubscriber(
      "customerIoSimulationSync",
      createCustomerIoSimulationSyncSubscriber(deps.customerIoSimulationSync),
    );
  }

  return builder
    .withCommand("queueRun", QueueRunCommand)
    .withCommand("startRun", StartRunCommand)
    .withCommand("messageSnapshot", MessageSnapshotCommand)
    .withCommand("textMessageStart", TextMessageStartCommand)
    .withCommand("textMessageEnd", TextMessageEndCommand)
    .withCommandInstance("finishRun", FinishRunCommand, deps.finishRunCommand)
    .withCommand("recordAgentInstance", RecordAgentInstanceCommand)
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
