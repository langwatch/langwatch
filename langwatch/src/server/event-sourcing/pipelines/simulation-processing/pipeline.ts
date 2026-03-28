import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { DeleteRunCommand } from "./commands/deleteRun.command";
import { FinishRunCommand } from "./commands/finishRun.command";
import { MessageSnapshotCommand } from "./commands/messageSnapshot.command";
import { QueueRunCommand } from "./commands/queueRun.command";
import { StartRunCommand } from "./commands/startRun.command";
import { TextMessageStartCommand } from "./commands/textMessageStart.command";
import { TextMessageEndCommand } from "./commands/textMessageEnd.command";
import { SimulationRunStateFoldProjection, type SimulationRunStateData } from "./projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "./schemas/events";

export interface SimulationProcessingPipelineDeps {
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  snapshotUpdateBroadcastReactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
  suiteRunSyncReactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
  traceMetricsSyncReactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
  ComputeRunMetricsCommand: {
    new (): any;
    readonly schema: any;
    getAggregateId(payload: any): string;
    getSpanAttributes?(payload: any): Record<string, string | number | boolean>;
    makeJobId(payload: any): string;
  };
  customerIoSimulationSyncReactor?: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
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
export function createSimulationProcessingPipeline(deps: SimulationProcessingPipelineDeps) {
  let builder = definePipeline<SimulationProcessingEvent>()
    .withName("simulation_processing")
    .withAggregateType("simulation_run")
    .withFoldProjection("simulationRunState", new SimulationRunStateFoldProjection({
      store: deps.simulationRunStore,
    }))
    .withReactor("simulationRunState", "snapshotUpdateBroadcast", deps.snapshotUpdateBroadcastReactor)
    .withReactor("simulationRunState", "suiteRunSync", deps.suiteRunSyncReactor)
    .withReactor("simulationRunState", "traceMetricsSync", deps.traceMetricsSyncReactor);

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
    .withCommand("deleteRun", DeleteRunCommand)
    .withCommand("computeRunMetrics", deps.ComputeRunMetricsCommand, {
      deduplication: {
        makeId: deps.ComputeRunMetricsCommand.makeJobId,
        ttlMs: 60_000,
      },
    })
    .build();
}
