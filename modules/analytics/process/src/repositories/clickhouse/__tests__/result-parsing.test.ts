import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { buildMetricAlias } from "../clickhouse.metric-translator.mapper.ts";

/**
 * Column aliases generated in SQL must match what we look up when parsing.
 * SQL emits a backticked alias; ClickHouse's JSONEachRow strips backticks,
 * so the lookup key is the bare alias name.
 */
describe("result-parsing", () => {
  describe("when generating aliases", () => {
    // Test with a single series (index 0)
    it("generates consistent aliases for single metric", () => {
      const series = {
        metric: "performance.total_cost" as AnalyticsSeries["metric"],
        aggregation: "avg" as const,
      };

      // This is the alias used when parsing results (always index 0 for first series)
      const parsingAlias = buildMetricAlias({
        index: 0,
        metric: series.metric,
        aggregation: series.aggregation,
      });

      // Build a query with this metric
      const input = {
        projectId: "test-project",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
        series: [series],
        timeScale: "full" as const,
      };

      const result = buildTimeseriesQuery(input);

      // Verify alias format
      expect(parsingAlias).toBe("0__performance_total_cost__avg");

      // The SQL should contain the alias (possibly quoted with backticks)
      const aliasInSql =
        result.sql.includes(parsingAlias) || result.sql.includes(`\`${parsingAlias}\``);
      expect(aliasInSql).toBe(true);
    });

    // Test with multiple series to verify indices are correct
    it("uses correct indices for multiple metrics", () => {
      const series = [
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality" as const,
        },
        {
          metric: "performance.total_cost" as AnalyticsSeries["metric"],
          aggregation: "avg" as const,
        },
        {
          metric: "performance.completion_time" as AnalyticsSeries["metric"],
          aggregation: "p90" as const,
        },
      ];

      const input = {
        projectId: "test-project",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
        series,
        timeScale: "full" as const,
      };

      const result = buildTimeseriesQuery(input);

      // Check each alias is present
      const expectedAliases = [
        "0__metadata_trace_id__cardinality",
        "1__performance_total_cost__avg",
        "2__performance_completion_time__p90",
      ];

      for (const alias of expectedAliases) {
        const found = result.sql.includes(alias) || result.sql.includes(`\`${alias}\``);
        expect(found).toBe(true);
      }
    });
  });

  describe("when building a UserThreads-like query", () => {
    it("generates correct aliases for all 4 UserThreads metrics", () => {
      const userThreadsSeries: AnalyticsSeries[] = [
        {
          metric: "metadata.thread_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
        },
        {
          metric: "metadata.thread_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "threads.average_duration_per_thread" as AnalyticsSeries["metric"],
          aggregation: "avg",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
      ];

      const input = {
        projectId: "test-project",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
        series: userThreadsSeries,
        timeScale: "full" as const,
      };

      const result = buildTimeseriesQuery(input);

      // Check that each expected alias is in the SQL
      const expectedAliases = [
        "0__metadata_thread_id__cardinality",
        "1__metadata_thread_id__cardinality",
        "2__threads_average_duration_per_thread__avg",
        "3__metadata_trace_id__cardinality",
      ];

      for (const alias of expectedAliases) {
        // Should appear either bare or quoted
        const foundInSql = result.sql.includes(alias);
        expect(foundInSql).toBe(true);
      }

      // Verify we're using the CTE approach
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("UNION ALL");
    });
  });

  describe("when building an LLMSummary-like query", () => {
    it("generates correct aliases for all LLMSummary metrics", () => {
      const llmSummarySeries: AnalyticsSeries[] = [
        {
          metric: "performance.total_tokens" as AnalyticsSeries["metric"],
          aggregation: "avg",
        },
        {
          metric: "performance.total_cost" as AnalyticsSeries["metric"],
          aggregation: "avg",
        },
        {
          metric: "performance.first_token" as AnalyticsSeries["metric"],
          aggregation: "p90",
        },
        {
          metric: "performance.completion_time" as AnalyticsSeries["metric"],
          aggregation: "p90",
        },
      ];

      const input = {
        projectId: "test-project",
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-02T00:00:00Z"),
        previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
        series: llmSummarySeries,
        timeScale: "full" as const,
      };

      const result = buildTimeseriesQuery(input);

      // Check that each expected alias is in the SQL
      const expectedAliases = [
        "0__performance_total_tokens__avg",
        "1__performance_total_cost__avg",
        "2__performance_first_token__p90",
        "3__performance_completion_time__p90",
      ];

      for (const alias of expectedAliases) {
        // Should appear either bare or quoted
        const foundInSql = result.sql.includes(alias);
        expect(foundInSql).toBe(true);
      }

      // All simple metrics - should use CTE approach for timeScale="full"
      expect(result.sql).toContain("WITH");
      expect(result.sql).toContain("simple_metrics_current AS");
      expect(result.sql).toContain("simple_metrics_previous AS");
      expect(result.sql).toContain("UNION ALL");
    });
  });

  describe("when parsing simulated ClickHouse results", () => {
    it("correctly matches simulated ClickHouse JSONEachRow response to aliases", () => {
      // This simulates what ClickHouse would return for a UserThreads query
      // Note: ClickHouse JSONEachRow does NOT include backticks in column names
      const simulatedChResponse = [
        {
          period: "current",
          "0__metadata_thread_id__cardinality": 150,
          "1__metadata_thread_id__cardinality": 3.5,
          "2__threads_average_duration_per_thread__avg": 8280000, // ~2.3 hours in ms
          "3__metadata_trace_id__cardinality": 25.5,
        },
        {
          period: "previous",
          "0__metadata_thread_id__cardinality": 120,
          "1__metadata_thread_id__cardinality": 3.2,
          "2__threads_average_duration_per_thread__avg": 7200000, // 2 hours in ms
          "3__metadata_trace_id__cardinality": 22.0,
        },
      ];

      const series: AnalyticsSeries[] = [
        {
          metric: "metadata.thread_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
        },
        {
          metric: "metadata.thread_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "threads.average_duration_per_thread" as AnalyticsSeries["metric"],
          aggregation: "avg",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
      ];

      // Simulate parsing like parseTimeseriesResults does
      const results: Record<string, Record<string, number | null>> = {
        current: {},
        previous: {},
      };

      for (const row of simulatedChResponse) {
        const period = row.period as "current" | "previous";

        for (let i = 0; i < series.length; i++) {
          const seriesItem = series[i]!;
          const alias = buildMetricAlias({
            index: i,
            metric: seriesItem.metric,
            aggregation: seriesItem.aggregation,
            key: undefined,
            subkey: undefined,
          });

          // This is how parseTimeseriesResults looks up values
          const value = (row as Record<string, unknown>)[alias];
          if (value !== undefined && value !== null) {
            results[period]![alias] = Number(value);
          }
        }
      }

      // Verify all values were correctly parsed
      expect(results.current!["0__metadata_thread_id__cardinality"]).toBe(150);
      expect(results.current!["1__metadata_thread_id__cardinality"]).toBe(3.5);
      expect(results.current!["2__threads_average_duration_per_thread__avg"]).toBe(8280000);
      expect(results.current!["3__metadata_trace_id__cardinality"]).toBe(25.5);

      expect(results.previous!["0__metadata_thread_id__cardinality"]).toBe(120);
      expect(results.previous!["1__metadata_thread_id__cardinality"]).toBe(3.2);
      expect(results.previous!["2__threads_average_duration_per_thread__avg"]).toBe(7200000);
      expect(results.previous!["3__metadata_trace_id__cardinality"]).toBe(22.0);
    });
  });

  describe("when parsing grouped results for summary charts", () => {
    it("produces nested structure from grouped summary rows", () => {
      // Simulate ClickHouse rows for timeScale="full" with group_key
      const simulatedRows = [
        {
          period: "current",
          group_key: "cat_a",
          "0__metadata_trace_id__cardinality": 150,
        },
        {
          period: "current",
          group_key: "cat_b",
          "0__metadata_trace_id__cardinality": 160,
        },
        {
          period: "previous",
          group_key: "cat_a",
          "0__metadata_trace_id__cardinality": 100,
        },
        {
          period: "previous",
          group_key: "cat_b",
          "0__metadata_trace_id__cardinality": 110,
        },
      ];

      const series: AnalyticsSeries[] = [
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
        },
      ];

      const { currentPeriod, previousPeriod } = simulateGroupedParsing(
        simulatedRows,
        series,
        "evaluations.evaluation_label",
      );

      // Verify nested structure exists for current period
      expect(currentPeriod).toHaveLength(1);
      const currentBucket = currentPeriod[0]!;
      expect(currentBucket["evaluations.evaluation_label"]).toBeDefined();

      const currentGroupData = currentBucket["evaluations.evaluation_label"] as Record<
        string,
        Record<string, number>
      >;

      // cat_a gets its value under the series name key
      expect(currentGroupData.cat_a!["0/metadata.trace_id/cardinality"]).toBe(150);
      // cat_b gets its value under the series name key
      expect(currentGroupData.cat_b!["0/metadata.trace_id/cardinality"]).toBe(160);

      // Verify nested structure exists for previous period
      expect(previousPeriod).toHaveLength(1);
      const previousBucket = previousPeriod[0]!;
      const previousGroupData = previousBucket["evaluations.evaluation_label"] as Record<
        string,
        Record<string, number>
      >;

      expect(previousGroupData.cat_a!["0/metadata.trace_id/cardinality"]).toBe(100);
      expect(previousGroupData.cat_b!["0/metadata.trace_id/cardinality"]).toBe(110);
    });

    it("produces flat structure when no groupBy for summary rows", () => {
      // Same data shape but without group_key — all values go into the flat bucket
      const simulatedRows = [
        {
          period: "current",
          "0__metadata_trace_id__cardinality": 310,
        },
        {
          period: "previous",
          "0__metadata_trace_id__cardinality": 210,
        },
      ];

      const series: AnalyticsSeries[] = [
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
        },
      ];

      const { currentPeriod, previousPeriod } = simulateGroupedParsing(
        simulatedRows,
        series,
        undefined, // no groupBy
      );

      expect(currentPeriod).toHaveLength(1);
      // Flat structure: series name directly on the bucket
      expect(currentPeriod[0]!["0/metadata.trace_id/cardinality"]).toBe(310);

      expect(previousPeriod).toHaveLength(1);
      expect(previousPeriod[0]!["0/metadata.trace_id/cardinality"]).toBe(210);
    });

    it("handles mixed group keys with pipeline metrics", () => {
      // Simulate a pipeline metric (avg threads per user) with group_key
      const simulatedRows = [
        {
          period: "current",
          group_key: "group_x",
          "0__metadata_thread_id__cardinality": 3.5,
        },
        {
          period: "current",
          group_key: "group_y",
          "0__metadata_thread_id__cardinality": 7.2,
        },
      ];

      const series: AnalyticsSeries[] = [
        {
          metric: "metadata.thread_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
      ];

      const { currentPeriod } = simulateGroupedParsing(simulatedRows, series, "metadata.user_id");

      expect(currentPeriod).toHaveLength(1);
      const groupData = currentPeriod[0]!["metadata.user_id"] as Record<
        string,
        Record<string, number>
      >;

      // Each group key gets its own metric value under the pipeline series name
      expect(groupData.group_x!["0/metadata.thread_id/cardinality/user_id/avg"]).toBe(3.5);
      expect(groupData.group_y!["0/metadata.thread_id/cardinality/user_id/avg"]).toBe(7.2);
    });

    it("handles empty group_key values by including them in the nested structure", () => {
      const simulatedRows = [
        {
          period: "current",
          group_key: "",
          "0__metadata_trace_id__cardinality": 42,
        },
        {
          period: "current",
          group_key: "known_label",
          "0__metadata_trace_id__cardinality": 88,
        },
      ];

      const series: AnalyticsSeries[] = [
        {
          metric: "metadata.trace_id" as AnalyticsSeries["metric"],
          aggregation: "cardinality",
        },
      ];

      const { currentPeriod } = simulateGroupedParsing(
        simulatedRows,
        series,
        "evaluations.evaluation_label",
      );

      expect(currentPeriod).toHaveLength(1);
      const groupData = currentPeriod[0]!["evaluations.evaluation_label"] as Record<
        string,
        Record<string, number>
      >;

      // Empty string group_key is treated as a valid key (String("") === "")
      expect(groupData[""]!["0/metadata.trace_id/cardinality"]).toBe(42);
      // Non-empty key is also preserved
      expect(groupData.known_label!["0/metadata.trace_id/cardinality"]).toBe(88);
    });
  });
});

type NestedBucket = { date: string; [key: string]: unknown };

type GroupedValues = Record<string, Record<string, number>>;

/**
 * Simulates the groupBy branch of parseTimeseriesResults. For timeScale="full", ClickHouse
 * returns rows with `period` and `group_key`; values nest as bucket[groupBy][groupKey][seriesName].
 */
function simulateGroupedParsing(
  rows: Record<string, unknown>[],
  series: AnalyticsSeries[],
  groupBy: string | undefined,
) {
  const buckets = {
    previous: new Map<string, NestedBucket>(),
    current: new Map<string, NestedBucket>(),
  };
  const groupsByBucket = new Map<NestedBucket, GroupedValues>();

  for (const row of rows) {
    const bucket = bucketFor(row.period === "current" ? buckets.current : buckets.previous);
    const values = readSeriesValues(row, series);
    if (groupBy && row.group_key !== undefined && row.group_key !== null) {
      const groupKey =
        typeof row.group_key === "string" ? row.group_key : JSON.stringify(row.group_key);
      const groups = groupsFor({ bucket, groupBy, groupsByBucket });
      Object.assign((groups[groupKey] ??= {}), values);
    } else {
      Object.assign(bucket, values);
    }
  }

  return {
    currentPeriod: Array.from(buckets.current.values()),
    previousPeriod: Array.from(buckets.previous.values()),
  };
}

/** Summary charts have one bucket per period, keyed "full". */
function bucketFor(periodBuckets: Map<string, NestedBucket>): NestedBucket {
  const existing = periodBuckets.get("full");
  if (existing) return existing;
  const bucket: NestedBucket = { date: "full" };
  periodBuckets.set("full", bucket);
  return bucket;
}

function groupsFor({
  bucket,
  groupBy,
  groupsByBucket,
}: {
  bucket: NestedBucket;
  groupBy: string;
  groupsByBucket: Map<NestedBucket, GroupedValues>;
}): GroupedValues {
  const existing = groupsByBucket.get(bucket);
  if (existing) return existing;
  const groups: GroupedValues = {};
  groupsByBucket.set(bucket, groups);
  bucket[groupBy] = groups;
  return groups;
}

/** Each series' value in the row, under the series name the parser reports it by. */
function readSeriesValues(
  row: Record<string, unknown>,
  series: AnalyticsSeries[],
): Record<string, number> {
  const values: Record<string, number> = {};
  series.forEach((seriesItem, i) => {
    const alias = buildMetricAlias({
      index: i,
      metric: seriesItem.metric,
      aggregation: seriesItem.aggregation,
      key: seriesItem.key,
      subkey: seriesItem.subkey,
    });
    const value = row[alias];
    if (value !== undefined && value !== null) {
      values[seriesNameOf(seriesItem, i)] = Number(value);
    }
  });
  return values;
}

function seriesNameOf(seriesItem: AnalyticsSeries, i: number): string {
  const aggregation = seriesItem.aggregation === "terms" ? "cardinality" : seriesItem.aggregation;
  if (seriesItem.pipeline) {
    return `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.pipeline.field}/${seriesItem.pipeline.aggregation}`;
  }
  return seriesItem.key
    ? `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.key}`
    : `${i}/${seriesItem.metric}/${aggregation}`;
}
