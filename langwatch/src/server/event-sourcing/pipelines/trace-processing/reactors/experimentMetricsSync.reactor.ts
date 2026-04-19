import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "../schemas/events";
import type { ComputeExperimentRunMetricsCommandData } from "../../experiment-run-processing/schemas/commands";

const logger = createLogger(
  "langwatch:trace-processing:experiment-metrics-publisher",
);

export interface ExperimentMetricsSyncReactorDeps {
  computeExperimentRunMetrics: (data: ComputeExperimentRunMetricsCommandData) => Promise<void>;
  lookupExperimentId: (tenantId: string, runId: string) => Promise<string | null>;
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
export function createExperimentMetricsSyncReactor(
  deps: ExperimentMetricsSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "experimentMetricsSync",
    options: {
      makeJobId: (payload) =>
        `exp-metrics:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 60_000,
      delay: 60_000,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      const runId = foldState.attributes["evaluation.run_id"];

      if (!runId) return;

      // Only dispatch if there's actual cost data
      if (foldState.totalCost === null || foldState.totalCost === 0) {
        return;
      }

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
        { traceId, tenantId, runId, experimentId, totalCost: foldState.totalCost },
        "Publishing trace metrics to experiment run (ECST)",
      );

      try {
        await deps.computeExperimentRunMetrics({
          tenantId,
          experimentId,
          runId,
          traceId,
          totalCost: foldState.totalCost,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.warn(
          { traceId, tenantId, runId, experimentId, error },
          "Failed to dispatch computeExperimentRunMetrics from trace-side reactor",
        );
      }
    },
  };
}
