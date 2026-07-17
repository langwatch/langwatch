import { createLogger } from "@langwatch/observability";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { ComputeRunMetricsCommandData } from "../schemas/commands";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:trace-metrics-sync",
);

export interface TraceMetricsSyncSubscriberDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Simulation-side subscriber: on RunFinished, dispatches computeRunMetrics
 * (pull mode) for any traces that don't have metrics yet.
 *
 * This handles the case where traces arrived before the simulation events
 * and were already processed by the trace pipeline. The command reads
 * the trace summary itself (pull-based).
 *
 * For traces not yet available, the command schedules a deferred retry.
 */
export function createTraceMetricsSyncSubscriber(
  deps: TraceMetricsSyncSubscriberDeps,
): { name: string; spec: SubscriberSpec<SimulationProcessingEvent> } {
  return {
    name: "traceMetricsSync",
    spec: {
      fold: "simulationRunState",
      events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],

      handler: async (
        _event: SimulationProcessingEvent,
        context: TriggerContext<SimulationRunStateData>,
      ): Promise<void> => {
        const { tenantId, state } = context;
        const traceIds = state.TraceIds;

        if (traceIds.length === 0) return;

        const scenarioRunId = state.ScenarioRunId;

        for (const traceId of traceIds) {
          // Skip traces we already have metrics for
          if (state.TraceMetrics[traceId]) continue;

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
            // Rethrow so the GroupQueue retries the subscriber job.
            // This is the last chance (RunFinished pull path) — swallowing
            // the error would permanently lose metrics for this trace.
            logger.error(
              { traceId, tenantId, scenarioRunId, error },
              "Failed to dispatch computeRunMetrics for trace, will retry",
            );
            throw error;
          }
        }
      },
    },
  };
}
