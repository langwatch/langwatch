import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ComputeRunMetricsCommandData } from "../../simulation-processing/schemas/commands";
import type { TraceSummarySubscriber } from "./_originGuardedSubscriber";

const logger = createLogger(
  "langwatch:trace-processing:simulation-metrics-publisher",
);

export interface SimulationMetricsSyncReactorDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Trace-side ECST publisher: when a simulation trace stabilises,
 * publishes its metrics to the simulation pipeline.
 *
 * Uses delay+dedup (60s) for terminal detection — fires once per trace
 * after 60s of quiet (no new spans). Carries the metrics data in the
 * command payload (Event-Carried State Transfer) so the simulation
 * pipeline doesn't need to query back.
 *
 * Scenario filtering: only fires for traces with scenario.run_id
 * in their hoisted span attributes.
 */
/**
 * Pure relevance guard, run at the top of the handler against the committed
 * fold state: only simulation traces (scenario.run_id present)
 * with something to aggregate need this reactor. Role cost/latency are
 * no longer accumulated on the fold; computeRunMetrics derives them
 * per-trace from stored_spans, so we dispatch in pull mode rather than
 * carrying metrics.
 */
function hasSimulationMetrics(foldState: TraceSummaryData): boolean {
  if (!foldState.attributes["scenario.run_id"]) return false;
  return !(foldState.spanCount === 0 && foldState.totalCost === null);
}

export function createSimulationMetricsSyncReactor(
  deps: SimulationMetricsSyncReactorDeps,
): TraceSummarySubscriber {
  return {
    name: "simulationMetricsSync",
    spec: {
      fold: "traceSummary",
      ttl: 60_000,
      delay: 60_000,
      handler: async (_event, context) => {
        const { tenantId, state: foldState } = context;
        // Relevance guard needs fold state, so it runs here rather than in a
        // pre-enqueue `when`.
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
            "Failed to dispatch computeRunMetrics from trace-side reactor",
          );
        }
      },
    },
  };
}
