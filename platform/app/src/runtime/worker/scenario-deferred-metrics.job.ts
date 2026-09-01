import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { COMPUTE_METRICS_RETRY_DELAY_MS } from "@langwatch/scenario-server";
import type { ScenarioDeferredMetricsJobSpec } from "@langwatch/worker";

/**
 * Scenario's delayed metrics retry, as one description both graphs register.
 *
 * Every other routing key on `event-sourcing/jobs` travels between the legacy
 * registry and the packaged worker inside a pipeline definition, which is a
 * static description handed across intact. This one does not: the retry is a
 * queue job registered against the pipeline SERVICE after registration, so its
 * name, delay and deduplication are spelled at the registration site rather
 * than declared by `simulation_processing`. Two spellings would be two keys on
 * one queue, and the consumer that did not stage a key never drains it.
 *
 * It belongs to `@langwatch/scenario-server`, where the delay below already
 * lives, and moves there when the pipeline it retries does.
 */
export const scenarioDeferredComputeRunMetricsJob: ScenarioDeferredMetricsJobSpec<ComputeRunMetricsCommandData> =
  {
    name: "deferredComputeRunMetrics",
    delayMs: COMPUTE_METRICS_RETRY_DELAY_MS,
    makeJobId: (payload) =>
      `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`,
    spanAttributes: (payload) => ({
      "deferred.tenant_id": payload.tenantId,
      "deferred.scenario_run_id": payload.scenarioRunId,
      "deferred.trace_id": payload.traceId,
      "deferred.retry_count": payload.retryCount,
    }),
  };
