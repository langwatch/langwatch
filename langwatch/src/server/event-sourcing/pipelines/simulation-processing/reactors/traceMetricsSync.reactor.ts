import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/typeGuards";
import type { ComputeRunMetricsCommandData } from "../schemas/commands";

const logger = createLogger(
  "langwatch:simulation-processing:trace-metrics-sync",
);

export interface TraceMetricsSyncReactorDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Simulation-side reactor: on RunFinished, dispatches computeRunMetrics
 * (pull mode) for any traces that don't have metrics yet.
 *
 * This handles the case where traces arrived before the simulation events
 * and were already processed by the trace pipeline. The command reads
 * the trace summary itself (pull-based).
 *
 * For traces not yet available, the command schedules a deferred retry.
 */
export function createTraceMetricsSyncReactor(
  deps: TraceMetricsSyncReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "traceMetricsSync",

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      if (!isSimulationRunFinishedEvent(event)) return;

      const { tenantId, foldState } = context;
      const traceIds = foldState.TraceIds;

      if (traceIds.length === 0) return;

      const scenarioRunId = foldState.ScenarioRunId;

      for (const traceId of traceIds) {
        // Skip traces we already have metrics for
        if (foldState.TraceMetrics[traceId]) continue;

        try {
          logger.debug(
            { traceId, tenantId, scenarioRunId },
            "Dispatching computeRunMetrics (pull mode) for missing trace metrics",
          );

          await deps.computeRunMetrics({
            tenantId,
            scenarioRunId,
            traceId,
            retryCount: 0,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.warn(
            { traceId, tenantId, scenarioRunId, error },
            "Failed to dispatch computeRunMetrics for trace, skipping",
          );
        }
      }
    },
  };
}
