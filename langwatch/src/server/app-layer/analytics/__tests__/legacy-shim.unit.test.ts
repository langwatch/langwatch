/**
 * Unit tests for the legacy analytics shim
 * (`repositories/legacy.shim.ts`).
 *
 * The shim is pure forwarding: builder → CH client → parser. These tests pin
 * the forwarding contract for the input fields the SQL builder implements —
 * in particular `negateFilters` (the toolbar's Negate Filters toggle) and
 * `traceIds` (trace-scoped graphs), which the shim used to silently drop.
 * See specs/analytics/negate-filters-and-trace-scope.feature.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import type { TimeseriesInputType } from "~/server/analytics/registry";
import { ClickHouseLegacyAnalyticsShim } from "../repositories/legacy.shim";

vi.mock("~/server/analytics/clickhouse/aggregation-builder", () => ({
  buildTimeseriesQuery: vi
    .fn()
    .mockReturnValue({ sql: "SELECT 1", params: {} }),
}));

const buildTimeseriesQueryMock = vi.mocked(buildTimeseriesQuery);

const fakeClient = {
  query: vi.fn().mockResolvedValue({ json: async () => [] }),
};

function makeInput(
  overrides: Partial<TimeseriesInputType> = {},
): TimeseriesInputType {
  return {
    projectId: "project-1",
    startDate: new Date("2026-07-01T00:00:00.000Z").getTime(),
    endDate: new Date("2026-07-16T00:00:00.000Z").getTime(),
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
  };
}

describe("ClickHouseLegacyAnalyticsShim", () => {
  const shim = new ClickHouseLegacyAnalyticsShim(async () => fakeClient as any);

  beforeEach(() => {
    buildTimeseriesQueryMock.mockClear();
  });

  describe("when the request carries negateFilters", () => {
    /** @scenario Legacy shim forwards negated filters to the query builder */
    it("forwards negateFilters to the query builder", async () => {
      await shim.run(makeInput({ negateFilters: true }));

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ negateFilters: true }),
      );
    });
  });

  describe("when the request is scoped to explicit trace ids", () => {
    /** @scenario Legacy shim forwards trace scoping to the query builder */
    it("forwards traceIds to the query builder", async () => {
      await shim.run(makeInput({ traceIds: ["trace-1", "trace-2"] }));

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ traceIds: ["trace-1", "trace-2"] }),
      );
    });
  });

  describe("when the request carries neither", () => {
    it("forwards the base query fields", async () => {
      await shim.run(makeInput());

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
