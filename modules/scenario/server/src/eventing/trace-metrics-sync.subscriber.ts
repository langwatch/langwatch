import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { isSimulationRunFinishedEvent } from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:simulation-processing:trace-metrics-sync");

export interface TraceMetricsSyncSubscriberDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * On RunFinished, dispatches computeRunMetrics (pull mode) for every traceId.
 * Handles pre-arrived traces. Throws dispatch failures so GroupQueue retries (last chance).
 */
export function createTraceMetricsSyncSubscriber(
  deps: TraceMetricsSyncSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> & {
  fold?: never;
  map?: never;
} {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],

    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (!isSimulationRunFinishedEvent(event)) return;

      const tenantId = String(event.tenantId);
      const scenarioRunId = event.aggregateId;
      const traceIds = event.data.traceIds ?? [];

      for (const traceId of traceIds) {
        try {
          logger.debug(
            { traceId, tenantId, scenarioRunId },
            "Dispatching computeRunMetrics (pull mode) for trace",
          );

          await deps.computeRunMetrics({
            tenantId,
            scenarioRunId,
            traceId,
            retryCount: 0,
            // The run's own time, never the dispatch time: this becomes the
            // emitted event's `occurredAt`, both the version and partition
            // key of `simulation_run_metrics`. A clock reading here would
            // land a redelivery in a different month, keeping two rows forever.
            occurredAt: event.occurredAt,
          });
        } catch (error) {
          logger.warn(
            { traceId, tenantId, scenarioRunId, error },
            "Failed to dispatch computeRunMetrics for trace, will retry",
          );
          throw error;
        }
      }
    },
  };
}
