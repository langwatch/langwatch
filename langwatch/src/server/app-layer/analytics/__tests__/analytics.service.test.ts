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
  const getFeedbacks = vi.fn().mockResolvedValue({
    events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
  });
  const getTopUsedDocuments = vi.fn().mockResolvedValue({
    topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
    totalUniqueDocuments: 100,
  });

  return {
    deps: {
      prisma: {} as never,
      rollupRepository: { runRollupTimeseries },
      slimRepository: { runSlimTimeseries },
      legacyShim: { runTraceSummariesTimeseries },
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
