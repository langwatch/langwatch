/**
 * Pins the forwarding contract (builder -> CH client -> parser) for
 * `negateFilters` and `traceIds`, which the legacy shim used to silently
 * drop. See specs/analytics/negate-filters-and-trace-scope.feature.
 */

import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { AnalyticsTimeseriesQuery } from "../../analytics.repository.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

vi.mock("../clickhouse.aggregation-builder.mapper.ts", () => ({
  buildTimeseriesQuery: vi.fn().mockReturnValue({ sql: "SELECT 1", params: {} }),
  buildFeedbacksQuery: vi.fn(),
  buildTopDocumentsQuery: vi.fn(),
}));

const buildTimeseriesQueryMock = vi.mocked(buildTimeseriesQuery);

const fakeClient = {
  query: vi.fn().mockResolvedValue({ json: async () => [] }),
};

function makeQuery(overrides: Partial<AnalyticsTimeseriesInput> = {}): AnalyticsTimeseriesQuery {
  const startDate = Temporal.Instant.from("2026-07-01T00:00:00.000Z");
  const endDate = Temporal.Instant.from("2026-07-16T00:00:00.000Z");
  return {
    table: "trace_summaries",
    authorization: analyticsProof({ projectId: "project-1" }),
    startDate,
    endDate,
    previousPeriodStartDate: startDate,
    adjustedTimeScale: 1440,
    maxResultRows: undefined,
    input: {
      projectId: "project-1",
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
    clickhouse: fakeClient as any,
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

  describe("when the request leaves out trace origins", () => {
    /** @scenario Leaving out an origin keeps the rest of the count intact */
    it("forwards excludeOrigins to the query builder", async () => {
      await repository.runTimeseries(makeQuery({ excludeOrigins: ["langy"] }));

      expect(buildTimeseriesQueryMock).toHaveBeenCalledWith(
        expect.objectContaining({ excludeOrigins: ["langy"] }),
      );
    });
  });

  describe("when the request is scoped to explicit trace ids", () => {
    /** @scenario A graph scoped to specific traces reads only those traces */
    it("forwards traceIds to the query builder", async () => {
      await repository.runTimeseries(makeQuery({ traceIds: ["trace-1", "trace-2"] }));

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

  describe("when the proof was minted for another project", () => {
    /** @scenario "A series asked under another project's proof is refused" */
    it("refuses the read before building or sending anything", async () => {
      fakeClient.query.mockClear();

      const refused = repository
        .runTimeseries({
          ...makeQuery(),
          authorization: analyticsProof({ projectId: "project-2" }),
        })
        .catch((error: unknown) => error);

      await expect(refused).resolves.toMatchObject({ code: "analytics_proof_project_mismatch" });
      expect(buildTimeseriesQueryMock).not.toHaveBeenCalled();
      expect(fakeClient.query).not.toHaveBeenCalled();
    });
  });
});
