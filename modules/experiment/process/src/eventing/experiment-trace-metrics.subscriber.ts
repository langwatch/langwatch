import type { ComputeExperimentRunMetricsCommandData } from "@langwatch/experiment-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { spanSchema, type TraceSummaryData } from "@langwatch/trace-contract";
import { z } from "zod";

const logger = createLogger("langwatch:experiment:trace-metrics-sync");

/** Main's 60s quiet window on an experiment trace, keyed per trace. */
export const EXPERIMENT_TRACE_METRICS_SETTLE_MS = 60_000;

/** The span marker an experiment run stamps on its traces. */
const EXPERIMENT_RUN_MARKER = "evaluation.run_id";

/** All of span_received this subscriber reads: the span's attributes, for the run marker. */
export const experimentTraceSpanSchema = z.object({
  span: spanSchema.pick({ attributes: true }),
});

/** Admits only a span carrying a run id, so no other trace mints a job or a read. */
export function carriesExperimentRunMarker(
  data: z.output<typeof experimentTraceSpanSchema>,
): boolean {
  return data.span.attributes.some(
    (attribute) => attribute.key === EXPERIMENT_RUN_MARKER && !!attribute.value.stringValue,
  );
}

/** Only an experiment trace (a hoisted run id) with real cost has metrics to fold. */
function hasExperimentCostMetrics(summary: TraceSummaryData): boolean {
  if (!summary.attributes[EXPERIMENT_RUN_MARKER]) return false;
  return summary.totalCost !== null && summary.totalCost !== 0;
}

interface ExperimentTraceMetricsSyncDeps {
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  findExperimentId: (input: { tenantId: string; runId: string }) => Promise<string | null>;
  computeRunMetrics: (data: ComputeExperimentRunMetricsCommandData) => Promise<void>;
}

/**
 * Experiment's peer reaction to a settled experiment trace (§9): reads trace's fold, resolves
 * the run's experiment, then records the cost on its own run. Throws to be retried.
 */
export function createExperimentTraceMetricsSyncHandler(
  deps: ExperimentTraceMetricsSyncDeps,
): (input: { tenantId: string; traceId: string }) => Promise<void> {
  return async ({ tenantId, traceId }) => {
    const summary = await deps.findSummary({ projectId: tenantId, traceId });
    if (!summary || !hasExperimentCostMetrics(summary)) return;
    const runId = summary.attributes[EXPERIMENT_RUN_MARKER]!;

    const experimentId = await deps.findExperimentId({ tenantId, runId });
    if (!experimentId) {
      logger.warn(
        { traceId, tenantId, runId },
        "No experiment recorded this evaluation.run_id; skipping its trace metrics",
      );
      return;
    }

    await deps.computeRunMetrics({
      tenantId,
      experimentId,
      runId,
      traceId,
      totalCost: summary.totalCost!,
      occurredAt: nowInstant().epochMilliseconds,
    });
  };
}
