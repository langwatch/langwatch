/** Spec: specs/trace-processing/trace-token-totals.feature. */
import { describe, expect, it } from "vitest";

import { translateMetric } from "../clickhouse.metric-translator.mapper.ts";
import { buildRollupTimeseriesQuery } from "../clickhouse.rollup-timeseries-query.mapper.ts";
import { buildSlimTimeseriesQuery } from "../clickhouse.slim-timeseries-query.mapper.ts";

const query = {
  projectId: "tenant-a",
  startDate: new Date("2026-06-15T00:00:00.000Z"),
  endDate: new Date("2026-06-16T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-06-14T00:00:00.000Z"),
  series: [{ metric: "performance.total_tokens", aggregation: "sum" as const }],
  timeScale: 60,
};

describe("the analytics total tokens metric", () => {
  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on trace summaries", () => {
    const { selectExpression } = translateMetric({
      metric: "performance.total_tokens",
      aggregation: "sum",
      index: 0,
    });

    expect(selectExpression).toContain("TotalPromptTokenCount");
    expect(selectExpression).toContain("TotalCompletionTokenCount");
    expect(selectExpression).toContain("langwatch.reserved.cache_read_tokens");
    expect(selectExpression).toContain("langwatch.reserved.cache_creation_tokens");
  });

  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on the per-minute rollup", () => {
    const { sql } = buildRollupTimeseriesQuery(query);

    expect(sql).toContain("CacheReadTokensSum");
    expect(sql).toContain("CacheWriteTokensSum");
  });

  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on the slim table", () => {
    const { sql } = buildSlimTimeseriesQuery(query);

    expect(sql).toContain("CacheReadTokens");
    expect(sql).toContain("CacheWriteTokens");
  });
});
