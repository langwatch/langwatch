/**
 * Tests delayed metrics retry job name/ID matches both graphs' expectations;
 * pinned literals here must match twin in legacy registry.
 */
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  scenarioDeferredComputeRunMetricsJob,
} from "../compute-run-metrics.commands.ts";

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
