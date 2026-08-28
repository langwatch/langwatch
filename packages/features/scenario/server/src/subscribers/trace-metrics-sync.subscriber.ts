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
 * Simulation-side subscriber: on RunFinished, dispatches computeRunMetrics
 * (pull mode) for every traceId carried on the event (ECST).
 *
 * This handles the case where traces arrived before the simulation events
 * and were already processed by the trace pipeline. The command reads
 * the trace summary itself (pull-based).
 *
 * For traces not yet available, the command schedules a deferred retry.
 * Dispatch failures THROW so the GroupQueue retries — this is the last
 * chance (RunFinished pull path); swallowing would permanently lose metrics.
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
            // The run's own time, never the dispatch time. This value becomes
            // the emitted event's `occurredAt`, and that is both the version
            // and the partition key of `simulation_run_metrics`. A clock
            // reading here means a redelivery lands in a different month's
            // partition, where a ReplacingMergeTree cannot collapse it, and
            // one trace keeps two rows forever.
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
