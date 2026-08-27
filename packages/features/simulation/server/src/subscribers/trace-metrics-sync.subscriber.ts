import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ComputeRunMetricsCommandData } from "../adapters/simulation-run.adapter";
import { SIMULATION_RUN_EVENT_TYPES } from "../adapters/simulation-run.adapter";
import type { SimulationProcessingEvent } from "../adapters/simulation-run.adapter";
import { isSimulationRunFinishedEvent } from "../adapters/simulation-run.adapter";

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
            occurredAt: Date.now(),
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
