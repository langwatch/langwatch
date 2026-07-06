import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
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
  type SimulationAnalyticsData,
  SimulationAnalyticsFoldProjection,
} from "./projections/simulationAnalytics.foldProjection";
import {
  SimulationAnalyticsRollupMapProjection,
  type SimulationAnalyticsRollupRow,
} from "./projections/simulationAnalyticsRollup.mapProjection";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /** ADR-034 Phase 7: slim per-simulation-run fold writer (scenarios mirror of
   *  `evaluationAnalyticsStore`). */
  simulationAnalyticsStore: FoldProjectionStore<SimulationAnalyticsData>;
  /** ADR-034 Phase 7: per-simulation-run rollup writer (scenarios mirror of
   *  `evaluationAnalyticsRollupAppendStore`). */
  simulationAnalyticsRollupAppendStore: AppendStore<SimulationAnalyticsRollupRow>;
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
  suiteRunSyncReactor: ReactorDefinition<
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
    .withFoldProjection(
      "simulationAnalytics",
      new SimulationAnalyticsFoldProjection({
        store: deps.simulationAnalyticsStore,
      }),
    )
    .withMapProjection(
      "simulationAnalyticsRollup",
      new SimulationAnalyticsRollupMapProjection({
        store: deps.simulationAnalyticsRollupAppendStore,
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
    .withReactor("simulationRunState", "suiteRunSync", deps.suiteRunSyncReactor)
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
    .build();
}
