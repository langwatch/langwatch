import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import type { TraceSummaryData, TraceProcessingEvent } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:simulation-metrics-publisher");

export const SIMULATION_METRICS_SYNC_DELAY_MS = 60_000;
export const SIMULATION_METRICS_SYNC_DEDUP_TTL_MS = 60_000;

export interface SimulationMetricsSyncSubscriberDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Pure relevance guard, shared by `when` and the fail-open handler: only
 * simulation traces with something to aggregate need this. Role
 * cost/latency are derived from stored_spans in pull mode, not carried.
 */
export function hasSimulationMetrics(foldState: TraceSummaryData): boolean {
  if (!foldState.attributes["scenario.run_id"]) return false;
  return !(foldState.spanCount === 0 && foldState.totalCost === null);
}

// Delay+dedup fires once per trace after 60s of quiet; ECST avoids
// querying back for metrics.
export function createSimulationMetricsSyncHandler(
  deps: SimulationMetricsSyncSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, state: foldState } = context;
    if (!hasSimulationMetrics(foldState)) return;

    const scenarioRunId = foldState.attributes["scenario.run_id"]!;

    const traceId = foldState.traceId;

    logger.debug(
      { traceId, tenantId, scenarioRunId },
      "Publishing trace metrics to simulation run (derived on compute)",
    );

    try {
      await deps.computeRunMetrics({
        tenantId,
        scenarioRunId,
        traceId,
        retryCount: 0,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn(
        { traceId, tenantId, scenarioRunId, error },
        "Failed to dispatch computeRunMetrics from the trace-side subscriber",
      );
    }
  };
}
