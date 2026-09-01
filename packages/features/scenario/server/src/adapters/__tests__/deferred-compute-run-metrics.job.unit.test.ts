/**
 * Whether the delayed metrics retry still spells itself the way both graphs
 * staged it.
 *
 * The legacy registry in platform/app keeps its own frozen copy of this
 * description, because the pipeline it retries has not moved yet. Nothing
 * relates the two copies at compile time, and the queue would not complain: a
 * drifted name is a second routing key on `event-sourcing/jobs` that only one
 * of the two consumers ever stages, and a drifted job id stops deduplicating
 * the retries of one run onto one entry. Both failures look like a queue that
 * is simply quiet. Only the delay is safe from drift — both copies read the
 * same exported constant — so everything else is pinned to a literal here, and
 * these literals may only change in a commit that changes the twin as well.
 *
 * Spec: packages/features/scenario/specs/simulation-service.feature
 */
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  scenarioDeferredComputeRunMetricsJob,
} from "../compute-run-metrics.adapter";

function payload(
  overrides: Partial<ComputeRunMetricsCommandData> = {},
): ComputeRunMetricsCommandData {
  return {
    tenantId: "tenant-1",
    scenarioRunId: "run-1",
    traceId: "trace-1",
    retryCount: 2,
    occurredAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("the scenario deferred metrics retry description", () => {
  describe("given the legacy registry holds a frozen copy of it", () => {
    describe("when a graph stages the job", () => {
      /** @scenario "The delayed metrics retry keeps one routing key across both graphs" */
      it("names the routing key the twin names", () => {
        expect(scenarioDeferredComputeRunMetricsJob.name).toBe("deferredComputeRunMetrics");
      });

      /** @scenario "The delayed metrics retry keeps one routing key across both graphs" */
      it("delays by the constant both copies read", () => {
        expect(scenarioDeferredComputeRunMetricsJob.delayMs).toBe(COMPUTE_METRICS_RETRY_DELAY_MS);
      });
    });

    describe("when a retry is scheduled", () => {
      /** @scenario "Retries of one run deduplicate onto one queue entry" */
      it("builds the deduplication id the twin builds", () => {
        expect(scenarioDeferredComputeRunMetricsJob.makeJobId(payload())).toBe(
          "compute-metrics-retry:tenant-1:run-1:trace-1",
        );
      });

      /** @scenario "Retries of one run deduplicate onto one queue entry" */
      it("collapses successive attempts for one run onto one id", () => {
        expect(scenarioDeferredComputeRunMetricsJob.makeJobId(payload({ retryCount: 0 }))).toBe(
          scenarioDeferredComputeRunMetricsJob.makeJobId(payload({ retryCount: 3 })),
        );
      });

      /** @scenario "Retries of one run deduplicate onto one queue entry" */
      it("separates two runs of one tenant", () => {
        expect(
          scenarioDeferredComputeRunMetricsJob.makeJobId(payload({ scenarioRunId: "run-2" })),
        ).not.toBe(scenarioDeferredComputeRunMetricsJob.makeJobId(payload()));
      });

      /** @scenario "The delayed metrics retry keeps one routing key across both graphs" */
      it("reports the retry under the attribute names the twin reports", () => {
        expect(scenarioDeferredComputeRunMetricsJob.spanAttributes(payload())).toEqual({
          "deferred.tenant_id": "tenant-1",
          "deferred.scenario_run_id": "run-1",
          "deferred.trace_id": "trace-1",
          "deferred.retry_count": 2,
        });
      });
    });
  });
});
