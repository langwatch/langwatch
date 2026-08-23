import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ComputeRunMetricsCommandData } from "../../simulation-processing/schemas/commands";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:simulation-metrics-publisher",
);

export const SIMULATION_METRICS_SYNC_DELAY_MS = 60_000;
export const SIMULATION_METRICS_SYNC_DEDUP_TTL_MS = 60_000;

export interface SimulationMetricsSyncSubscriberDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Pure relevance guard, shared by `when` (pre-enqueue, sees the committed
 * fold state) and the handler (fail-open path): only simulation traces
 * (scenario.run_id present) with something to aggregate need this
 * subscriber. Role cost/latency are no longer accumulated on the fold;
 * computeRunMetrics derives them per-trace from stored_spans, so we dispatch
 * in pull mode rather than carrying metrics.
 */
export function hasSimulationMetrics(foldState: TraceSummaryData): boolean {
  if (!foldState.attributes["scenario.run_id"]) return false;
  return !(foldState.spanCount === 0 && foldState.totalCost === null);
}

/**
 * Trace-side ECST publisher: when a simulation trace stabilises, publishes
 * its metrics to the simulation pipeline.
 *
 * Uses delay+dedup (60s) for terminal detection — fires once per trace
 * after 60s of quiet (no new spans). Carries the metrics data in the
 * command payload (Event-Carried State Transfer) so the simulation
 * pipeline doesn't need to query back.
 *
 * Scenario filtering: only fires for traces with scenario.run_id
 * in their hoisted span attributes.
 */
export function createSimulationMetricsSyncHandler(
  deps: SimulationMetricsSyncSubscriberDeps,
): (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void> {
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
        occurredAt: Date.now(),
      });
    } catch (error) {
      logger.warn(
        { traceId, tenantId, scenarioRunId, error },
        "Failed to dispatch computeRunMetrics from the trace-side subscriber",
      );
    }
  };
}
