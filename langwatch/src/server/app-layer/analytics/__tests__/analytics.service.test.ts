/**
 * Unit tests for the app-layer AnalyticsService (ADR-034 Phase 3 rewrite).
 *
 * Drives the service with stub repositories + a stub legacy backend so the
 * test exercises ONLY the orchestration logic — flag check, routing, dispatch
 * — without touching ClickHouse, Prisma, or the feature flag service.
 *
 * The default mock sets the feature flag to OFF, so getTimeseries goes
 * through the legacy shim. Routed paths get separate coverage via the
 * route-table unit + integration tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import { featureFlagService } from "~/server/featureFlag";
import {
  AnalyticsService,
  getAnalyticsService,
  resetAnalyticsService,
} from "../analytics.service";

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(false),
  },
}));

const isEnabled = vi.mocked(featureFlagService.isEnabled);

/**
 * Turn the read flag on (and, optionally, the tripwire flag). The service
 * resolves them by name, so key off the flag string rather than call order.
 */
function enableReadFlag({ tripwire = false }: { tripwire?: boolean } = {}) {
  isEnabled.mockImplementation(async (flag: string) => {
    if (flag === "release_event_sourced_analytics_read") return true;
    if (flag === "release_event_sourced_analytics_read_tripwire")
      return tripwire;
    return false;
  });
}

function fakeResult(value: number): TimeseriesResult {
  return {
    currentPeriod: [{ date: "2024-01-01", series_0: value }],
    previousPeriod: [{ date: "2023-12-31", series_0: value - 10 }],
  };
}

function makeDeps(overrides?: {
  shimResult?: TimeseriesResult;
  rollupResult?: TimeseriesResult;
  slimResult?: TimeseriesResult;
}) {
  const shimResult = overrides?.shimResult ?? fakeResult(100);
  const rollupResult = overrides?.rollupResult ?? fakeResult(50);
  const slimResult = overrides?.slimResult ?? fakeResult(60);

  const runTraceSummariesTimeseries = vi.fn().mockResolvedValue(shimResult);
  const runRollupTimeseries = vi.fn().mockResolvedValue(rollupResult);
  const runSlimTimeseries = vi.fn().mockResolvedValue(slimResult);
  // Phase 6 — eval analytics deps. Not exercised by the existing tests
  // (which use trace metrics), but the AnalyticsService constructor now
  // requires them.
  const runEvalRollupTimeseries = vi.fn().mockResolvedValue(rollupResult);
  const runEvalSlimTimeseries = vi.fn().mockResolvedValue(slimResult);
  const runEvaluationRunsTimeseries = vi.fn().mockResolvedValue(shimResult);
  const getFeedbacks = vi.fn().mockResolvedValue({
    events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
  });
  const getTopUsedDocuments = vi.fn().mockResolvedValue({
    topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
    totalUniqueDocuments: 100,
  });

  return {
    deps: {
      rollupRepository: { runRollupTimeseries },
      slimRepository: { runSlimTimeseries },
      legacyShim: { runTraceSummariesTimeseries },
      evalRollupRepository: { runRollupTimeseries: runEvalRollupTimeseries },
      evalSlimRepository: { runSlimTimeseries: runEvalSlimTimeseries },
      evalLegacyShim: { runEvaluationRunsTimeseries },
      legacyBackend: {
        getTimeseries: vi.fn(),
        getDataForFilter: vi.fn(),
        getTopUsedDocuments,
        getFeedbacks,
        isAvailable: () => true,
      },
    },
    spies: {
      runTraceSummariesTimeseries,
      runRollupTimeseries,
      runSlimTimeseries,
      runEvalRollupTimeseries,
      runEvalSlimTimeseries,
      runEvaluationRunsTimeseries,
      getFeedbacks,
      getTopUsedDocuments,
    },
  };
}

describe("AnalyticsService", () => {
  describe("getTimeseries", () => {
    const input = {
      projectId: "test-project",
      startDate: Date.now() - 86400000,
      endDate: Date.now(),
      filters: {},
      series: [
        {
          metric: "metadata.trace_id" as const,
          aggregation: "cardinality" as const,
        },
      ],
      timeZone: "UTC",
    };

    it("falls back to the legacy trace_summaries shim when the flag is OFF", async () => {
      const { deps, spies } = makeDeps();
      const service = new AnalyticsService(deps);

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
      expect(spies.runTraceSummariesTimeseries).toHaveBeenCalledTimes(1);
      expect(spies.runRollupTimeseries).not.toHaveBeenCalled();
      expect(spies.runSlimTimeseries).not.toHaveBeenCalled();
    });

    describe("when release_event_sourced_analytics_read is ON", () => {
      const sumCost = {
        ...input,
        series: [
          {
            metric: "performance.total_cost" as const,
            aggregation: "sum" as const,
          },
        ],
      };

      beforeEach(() => enableReadFlag());

      it("dispatches an ungrouped additive sum to the rollup repository", async () => {
        const { deps, spies } = makeDeps();
        const result = await new AnalyticsService(deps).getTimeseries(sumCost);

        expect(spies.runRollupTimeseries).toHaveBeenCalledTimes(1);
        expect(spies.runSlimTimeseries).not.toHaveBeenCalled();
        expect(spies.runTraceSummariesTimeseries).not.toHaveBeenCalled();
        expect(result.currentPeriod[0]?.series_0).toBe(50);
      });

      // Pins the ADR-034 group-by-model decision end-to-end: the rollup's
      // per-span Model attribution never serves a model-grouped read.
      it("dispatches a model-grouped sum to the slim repository, not the rollup", async () => {
        const { deps, spies } = makeDeps();
        const result = await new AnalyticsService(deps).getTimeseries({
          ...sumCost,
          groupBy: "metadata.model",
        });

        expect(spies.runSlimTimeseries).toHaveBeenCalledTimes(1);
        expect(spies.runRollupTimeseries).not.toHaveBeenCalled();
        expect(result.currentPeriod[0]?.series_0).toBe(60);
      });

      it("dispatches a span_type-grouped sum to the legacy shim", async () => {
        const { deps, spies } = makeDeps();
        await new AnalyticsService(deps).getTimeseries({
          ...sumCost,
          groupBy: "metadata.span_type",
        });

        expect(spies.runTraceSummariesTimeseries).toHaveBeenCalledTimes(1);
        expect(spies.runRollupTimeseries).not.toHaveBeenCalled();
        expect(spies.runSlimTimeseries).not.toHaveBeenCalled();
      });

      it("still uses the legacy shim for a shape neither table can serve", async () => {
        const { deps, spies } = makeDeps();
        await new AnalyticsService(deps).getTimeseries({
          ...input,
          series: [
            {
              metric: "performance.total_cost" as const,
              aggregation: "sum" as const,
              pipeline: { field: "user_id", aggregation: "avg" },
            },
          ],
        } as never);

        expect(spies.runTraceSummariesTimeseries).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the tripwire flag is ON", () => {
      beforeEach(() => enableReadFlag({ tripwire: true }));

      it("runs BOTH the routed query and the legacy query, returning the routed one", async () => {
        const { deps, spies } = makeDeps();
        const result = await new AnalyticsService(deps).getTimeseries({
          ...input,
          series: [
            {
              metric: "performance.total_cost" as const,
              aggregation: "sum" as const,
            },
          ],
        });

        expect(spies.runRollupTimeseries).toHaveBeenCalledTimes(1);
        expect(spies.runTraceSummariesTimeseries).toHaveBeenCalledTimes(1);
        // The routed value wins — the tripwire only logs.
        expect(result.currentPeriod[0]?.series_0).toBe(50);
      });
    });
  });

  describe("getTopUsedDocuments", () => {
    it("delegates to the legacy backend", async () => {
      const { deps, spies } = makeDeps();
      const service = new AnalyticsService(deps);

      const result = await service.getTopUsedDocuments(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {},
      );

      expect(result.topDocuments).toHaveLength(1);
      expect(spies.getTopUsedDocuments).toHaveBeenCalledTimes(1);
    });
  });

  describe("getFeedbacks", () => {
    it("delegates to the legacy backend", async () => {
      const { deps, spies } = makeDeps();
      const service = new AnalyticsService(deps);

      const result = await service.getFeedbacks(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {},
      );

      expect(result.events).toHaveLength(1);
      expect(spies.getFeedbacks).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getAnalyticsService", () => {
  beforeEach(() => {
    resetAnalyticsService();
  });

  it("returns a singleton instance", () => {
    const service1 = getAnalyticsService();
    const service2 = getAnalyticsService();

    expect(service1).toBe(service2);
  });
});
