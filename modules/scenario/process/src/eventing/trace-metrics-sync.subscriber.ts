import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  type ComputeRunMetricsCommandData,
  type SimulationProcessingEvent,
  SIMULATION_RUN_EVENT_TYPES,
  isSimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";

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

/** Main's 60s settle window on trace's span events, keyed per trace. */
export const TRACE_SPAN_METRICS_SETTLE_MS = 60_000;

export interface TraceSpanMetricsSyncDeps {
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/** Only simulation traces with something to aggregate; role metrics are derived on compute. */
export function hasSimulationMetrics(summary: TraceSummaryData): boolean {
  if (!summary.attributes["scenario.run_id"]) return false;
  return !(summary.spanCount === 0 && summary.totalCost === null);
}

/** Peer reaction to a settled trace (§9): reads trace's fold, then records its own metrics. */
export function createTraceSpanMetricsSyncHandler(
  deps: TraceSpanMetricsSyncDeps,
): (input: { tenantId: string; traceId: string; occurredAt: number }) => Promise<void> {
  return async ({ tenantId, traceId, occurredAt }) => {
    const summary = await deps.findSummary({ projectId: tenantId, traceId });
    if (!summary || !hasSimulationMetrics(summary)) return;
    const scenarioRunId = summary.attributes["scenario.run_id"];
    if (!scenarioRunId) return;
    logger.debug({ traceId, tenantId, scenarioRunId }, "Trace settled; computing run metrics");
    await deps.computeRunMetrics({ tenantId, scenarioRunId, traceId, retryCount: 0, occurredAt });
  };
}
