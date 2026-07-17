import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ComputeExperimentRunMetricsCommandData } from "../../experiment-run-processing/schemas/commands";
import type { TraceSummarySubscriber } from "./_originGuardedSubscriber";

const logger = createLogger(
  "langwatch:trace-processing:experiment-metrics-publisher",
);

export interface ExperimentMetricsSyncReactorDeps {
  computeExperimentRunMetrics: (
    data: ComputeExperimentRunMetricsCommandData,
  ) => Promise<void>;
  lookupExperimentId: (
    tenantId: string,
    runId: string,
  ) => Promise<string | null>;
}

/**
 * Trace-side ECST publisher: when an experiment trace stabilises,
 * publishes its cost metrics to the experiment-run-processing pipeline.
 *
 * Uses delay+dedup (60s) for terminal detection — fires once per trace
 * after 60s of quiet (no new spans). Carries the metrics data in the
 * command payload (Event-Carried State Transfer) so the experiment
 * pipeline doesn't need to query back.
 *
 * Filtering: only fires for traces with evaluation.run_id
 * in their hoisted span attributes.
 */
/**
 * Pure relevance guard, run at the top of the handler against the committed
 * fold state: only experiment traces (evaluation.run_id present)
 * with actual cost data need this subscriber. The experiment-ID lookup is
 * stateful and stays in the handler.
 */
function hasExperimentCostMetrics(foldState: TraceSummaryData): boolean {
  if (!foldState.attributes["evaluation.run_id"]) return false;
  return foldState.totalCost !== null && foldState.totalCost !== 0;
}

export function createExperimentMetricsSyncReactor(
  deps: ExperimentMetricsSyncReactorDeps,
): TraceSummarySubscriber {
  return {
    name: "experimentMetricsSync",
    spec: {
      fold: "traceSummary",
      ttl: 60_000,
      delay: 60_000,
      handler: async (_event, context) => {
        const { tenantId, state: foldState } = context;
        // Relevance guard needs fold state, so it runs here rather than in a
        // pre-enqueue `when`.
        if (!hasExperimentCostMetrics(foldState)) return;

        const runId = foldState.attributes["evaluation.run_id"]!;

        const traceId = foldState.traceId;

        // Look up the experiment ID for this run
        const experimentId = await deps.lookupExperimentId(tenantId, runId);
        if (!experimentId) {
          logger.warn(
            { traceId, tenantId, runId },
            "Could not find experimentId for evaluation.run_id — skipping metrics sync",
          );
          return;
        }

        logger.debug(
          {
            traceId,
            tenantId,
            runId,
            experimentId,
            totalCost: foldState.totalCost,
          },
          "Publishing trace metrics to experiment run (ECST)",
        );

        try {
          await deps.computeExperimentRunMetrics({
            tenantId,
            experimentId,
            runId,
            traceId,
            totalCost: foldState.totalCost!,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.warn(
            { traceId, tenantId, runId, experimentId, error },
            "Failed to dispatch computeExperimentRunMetrics from trace-side reactor",
          );
        }
      },
    },
  };
}
