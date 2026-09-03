/**
 * Unit tests for the Analytics ClickHouse repository's timeseries forwarding
 * (`clickhouse.analytics.repository.ts`, successor to the legacy analytics
 * shim).
 *
 * The repository is pure forwarding: builder -> CH client -> parser. These
 * tests pin the forwarding contract for the input fields the SQL builder
 * implements — in particular `negateFilters` (the toolbar's Negate Filters
 * toggle) and `traceIds` (trace-scoped graphs), which the shim used to
 * silently drop.
 * See specs/analytics/negate-filters-and-trace-scope.feature.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { buildTimeseriesQuery } from "../../../clickhouse/aggregation-builder";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository";
import type { AnalyticsTimeseriesQuery } from "../../analytics.repository";

vi.mock("../../../clickhouse/aggregation-builder", () => ({
  buildTimeseriesQuery: vi
    .fn()
    .mockReturnValue({ sql: "SELECT 1", params: {} }),
  buildFeedbacksQuery: vi.fn(),
  buildTopDocumentsQuery: vi.fn(),
}));

const buildTimeseriesQueryMock = vi.mocked(buildTimeseriesQuery);

const fakeClient = {
  query: vi.fn().mockResolvedValue({ json: async () => [] }),
};

function makeQuery(
  overrides: Partial<AnalyticsTimeseriesInput> = {},
): AnalyticsTimeseriesQuery {
  const startDate = new Date("2026-07-01T00:00:00.000Z");
  const endDate = new Date("2026-07-16T00:00:00.000Z");
  return {
    table: "trace_summaries",
    tenantId: "project-1",
    startDate,
    endDate,
    previousPeriodStartDate: startDate,
    adjustedTimeScale: 1440,
    maxResultRows: undefined,
    input: {
      filters: { "metadata.labels": ["prod"] },
      series: [
        {
          metric: "evaluations.evaluation_pass_rate",
          aggregation: "avg",
          key: "monitor_123",
        },
      ],
      timeScale: 1440,
      timeZone: "UTC",
      ...overrides,
    } as AnalyticsTimeseriesInput,
  };
}

describe("ClickHouseAnalyticsRepository", () => {
  const repository = ClickHouseAnalyticsRepository.create({
    resolveClient: async () => fakeClient as any,
  });

  beforeEach(() => {
    buildTimeseriesQueryMock.mockClear();
  });

  describe("when the request carries negateFilters", () => {
    /** @scenario Negating filters inverts the data selection */
    it("forwards negateFilters to the query builder", async () => {
      await repository.runTimeseries(makeQuery({ negateFilters: true }));

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ negateFilters: true }),
      );
    });
  });

  describe("when the request is scoped to explicit trace ids", () => {
    /** @scenario A graph scoped to specific traces reads only those traces */
    it("forwards traceIds to the query builder", async () => {
      await repository.runTimeseries(
        makeQuery({ traceIds: ["trace-1", "trace-2"] }),
      );

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ traceIds: ["trace-1", "trace-2"] }),
      );
    });
  });

  describe("when the request carries neither", () => {
    it("forwards the base query fields", async () => {
      await repository.runTimeseries(makeQuery());

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          filters: { "metadata.labels": ["prod"] },
          timeZone: "UTC",
        }),
      );
    });
  });
});
