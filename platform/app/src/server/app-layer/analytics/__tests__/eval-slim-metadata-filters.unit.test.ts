/**
 * The evaluation slim builder reads a custom metadata filter from the same
 * three storage formats as trace search: `metadata.<key>`, the legacy
 * `langwatch.metadata.<key>` and the bare `<key>`. It used to read only the
 * bare key, so an evaluation graph filtered by SDK metadata counted nothing.
 * The trace builders are exercised end to end in
 * `analytics/clickhouse/__tests__/metadata-filters.integration.test.ts`.
 *
 * @see https://github.com/langwatch/tasks/issues/919
 */

import { describe, expect, it } from "vitest";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";

const base = {
  projectId: "tenant-eval-slim-metadata",
  startDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: new Date("2026-08-02T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-07-31T00:00:00.000Z"),
  series: [
    {
      metric: "evaluations.evaluation_runs" as const,
      aggregation: "sum" as const,
    },
  ],
  timeScale: 60,
};

const STORAGE_KEYS = [
  "metadata.outcome",
  "langwatch.metadata.outcome",
  "outcome",
];

describe("buildEvalSlimTimeseriesQuery", () => {
  describe("when filtered by a metadata key", () => {
    it("reads the key in all three storage formats", () => {
      const { params } = buildEvalSlimTimeseriesQuery({
        ...base,
        filters: { "metadata.key": ["outcome"] },
      });
      expect(Object.values(params)).toEqual(
        expect.arrayContaining(STORAGE_KEYS),
      );
    });
  });

  describe("when filtered by a metadata value", () => {
    it("matches the value under all three storage formats", () => {
      const { sql, params } = buildEvalSlimTimeseriesQuery({
        ...base,
        filters: { "metadata.value": { outcome: ["ok"] } },
      });
      expect(Object.values(params)).toEqual(
        expect.arrayContaining([...STORAGE_KEYS, ["ok"]]),
      );
      expect(sql.match(/ea\.Attributes\[/g)?.length).toBeGreaterThanOrEqual(3);
    });
  });
});
