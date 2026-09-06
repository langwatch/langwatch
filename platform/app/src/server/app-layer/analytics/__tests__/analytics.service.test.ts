/**
 * Unit tests for the app-layer AnalyticsService (ADR-034 Phase 3 rewrite).
 *
 * Drives the service with stub repositories + a stub legacy backend so the
 * test exercises ONLY the orchestration logic — routing and dispatch —
 * without touching ClickHouse, Prisma, or the feature flag service.
 *
 * `release_event_sourced_analytics_read` is gone: it is permanently on, so the
 * service no longer asks. Which table answers a query is purely a function of
 * the query's SHAPE, and the legacy shim still serves the shapes the slim and
 * rollup builders cannot express. The only flag left here is the tripwire.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import { featureFlagService } from "~/server/featureFlag";
import { AnalyticsService } from "../analytics.service";

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(false),
  },
}));

const isEnabled = vi.mocked(featureFlagService.isEnabled);

/**
 * Turn the tripwire flag on. The service resolves flags by name, so key off
 * the flag string rather than call order.
 */
function enableTripwire() {
  isEnabled.mockImplementation(
    async (flag: string) =>
      flag === "release_event_sourced_analytics_read_tripwire",
  );
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

  // Both legacy tables (trace_summaries + evaluation_runs) share one shim
  // now (simp5012-002), so the fixture exposes ONE `runLegacy` spy.
  const runLegacy = vi.fn().mockResolvedValue(shimResult);
  const runRollupTimeseries = vi.fn().mockResolvedValue(rollupResult);
  const runSlimTimeseries = vi.fn().mockResolvedValue(slimResult);
  // Phase 6 — eval analytics deps. Not exercised by the existing tests
  // (which use trace metrics), but the AnalyticsService constructor now
  // requires them. All 4 read repos share the same unified interface (a
  // single `run(...)` method) after simp5012-004 consolidated the shape.
  const runEvalRollupTimeseries = vi.fn().mockResolvedValue(rollupResult);
  const runEvalSlimTimeseries = vi.fn().mockResolvedValue(slimResult);
  const getFeedbacks = vi.fn().mockResolvedValue({
    events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
  });
  const getTopUsedDocuments = vi.fn().mockResolvedValue({
    topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
    totalUniqueDocuments: 100,
  });

  return {
    deps: {
      rollupRepository: { run: runRollupTimeseries },
      slimRepository: { run: runSlimTimeseries },
      legacyShim: { run: runLegacy },
      evalRollupRepository: { run: runEvalRollupTimeseries },
      evalSlimRepository: { run: runEvalSlimTimeseries },
      legacyBackend: {
        getTimeseries: vi.fn(),
        getDataForFilter: vi.fn(),
        getTopUsedDocuments,
        getFeedbacks,
        isAvailable: () => true,
      },
    },
    spies: {
      runLegacy,
      runRollupTimeseries,
      runSlimTimeseries,
      runEvalRollupTimeseries,
      runEvalSlimTimeseries,
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

    // Routing must not consult the feature-flag service at all any more: a
    // flag read per query bought nothing once the flag was permanently on,
    // and leaving the call in invites the OFF branch growing back.
    it("routes without asking whether the event-sourced read flag is on", async () => {
      const { deps } = makeDeps();

      await new AnalyticsService(deps).getTimeseries(input);

      const flagsAsked = isEnabled.mock.calls.map(([flag]) => flag);
      expect(flagsAsked).not.toContain("release_event_sourced_analytics_read");
    });

    describe("when the query shape decides the table", () => {
      const sumCost = {
        ...input,
        series: [
          {
            metric: "performance.total_cost" as const,
            aggregation: "sum" as const,
          },
        ],
      };

      it("dispatches an ungrouped additive sum to the rollup repository", async () => {
        const { deps, spies } = makeDeps();
        const result = await new AnalyticsService(deps).getTimeseries(sumCost);

        expect(spies.runRollupTimeseries).toHaveBeenCalledTimes(1);
        expect(spies.runSlimTimeseries).not.toHaveBeenCalled();
        expect(spies.runLegacy).not.toHaveBeenCalled();
        expect(result.currentPeriod[0]?.series_0).toBe(50);
      });

      // Pins the group-by-model routing end-to-end: model group-bys need the
      // legacy builder's span-model partition join (per-span attribution so
      // buckets sum to the ungrouped totals); neither fast-path table can
      // serve them.
      it("dispatches a model-grouped sum to the legacy shim, not slim or the rollup", async () => {
        const { deps, spies } = makeDeps();
        await new AnalyticsService(deps).getTimeseries({
          ...sumCost,
          groupBy: "metadata.model",
        });

        expect(spies.runLegacy).toHaveBeenCalledTimes(1);
        expect(spies.runSlimTimeseries).not.toHaveBeenCalled();
        expect(spies.runRollupTimeseries).not.toHaveBeenCalled();
      });

      it("dispatches a span_type-grouped sum to the legacy shim", async () => {
        const { deps, spies } = makeDeps();
        await new AnalyticsService(deps).getTimeseries({
          ...sumCost,
          groupBy: "metadata.span_type",
        });

        expect(spies.runLegacy).toHaveBeenCalledTimes(1);
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

        expect(spies.runLegacy).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the tripwire flag is ON", () => {
      beforeEach(() => enableTripwire());

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
        expect(spies.runLegacy).toHaveBeenCalledTimes(1);
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
