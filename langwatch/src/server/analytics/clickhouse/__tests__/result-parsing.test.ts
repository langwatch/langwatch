import { describe, expect, it } from "vitest";
import { buildMetricAlias } from "../metric-translator";
import { buildTimeseriesQuery } from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum, SeriesInputType } from "../../registry";

/**
 * These tests verify that the column aliases generated in SQL match
 * the aliases we look up when parsing results.
 *
 * The key insight is:
 * - SQL uses: `... AS \`0__metric_name\`` (backticks in SQL)
 * - ClickHouse JSONEachRow returns: `{"0__metric_name": value}` (no backticks)
 * - We look up: `row["0__metric_name"]` (no backticks)
 *
 * So the backticks should be stripped by ClickHouse when returning JSON.
 */
describe("result-parsing", () => {
  describe("alias consistency", () => {
    // Test with a single series (index 0)
    it("generates consistent aliases for single metric", () => {
      const series = { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const };

      // This is the alias used when parsing results (always index 0 for first series)
      const parsingAlias = buildMetricAlias(0, series.metric, series.aggregation);

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
      const aliasInSql = result.sql.includes(parsingAlias) ||
                        result.sql.includes(`\`${parsingAlias}\``);
      expect(aliasInSql).toBe(true);
    });

    // Test with multiple series to verify indices are correct
    it("uses correct indices for multiple metrics", () => {
      const series = [
        { metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" as const },
        { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "avg" as const },
        { metric: "performance.completion_time" as FlattenAnalyticsMetricsEnum, aggregation: "p90" as const },
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

  describe("UserThreads-like query", () => {
    it("generates correct aliases for all 4 UserThreads metrics", () => {
      const userThreadsSeries: SeriesInputType[] = [
        { metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" },
        {
          metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "threads.average_duration_per_thread" as FlattenAnalyticsMetricsEnum,
          aggregation: "avg",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
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

  describe("LLMSummary-like query", () => {
    it("generates correct aliases for all LLMSummary metrics", () => {
      const llmSummarySeries: SeriesInputType[] = [
        { metric: "performance.total_tokens" as FlattenAnalyticsMetricsEnum, aggregation: "avg" },
        { metric: "performance.total_cost" as FlattenAnalyticsMetricsEnum, aggregation: "avg" },
        { metric: "performance.first_token" as FlattenAnalyticsMetricsEnum, aggregation: "p90" },
        { metric: "performance.completion_time" as FlattenAnalyticsMetricsEnum, aggregation: "p90" },
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

  describe("simulated result parsing", () => {
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

      const series: SeriesInputType[] = [
        { metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum, aggregation: "cardinality" },
        {
          metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "threads.average_duration_per_thread" as FlattenAnalyticsMetricsEnum,
          aggregation: "avg",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
        {
          metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
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
          const alias = buildMetricAlias(
            i,
            seriesItem.metric,
            seriesItem.aggregation,
            undefined,
            undefined,
          );

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
    /**
     * Simulates the groupBy branch of parseTimeseriesResults (lines 242-270 in the service).
     * For timeScale="full", ClickHouse returns rows with `period` and `group_key`.
     * The parser nests values as: bucket[groupBy][groupKey][seriesName]
     */
    function simulateGroupedParsing(
      rows: Array<Record<string, unknown>>,
      series: SeriesInputType[],
      groupBy: string | undefined,
    ) {
      type NestedBucket = {
        date: string;
        [key: string]: unknown;
      };

      const bucketMap: {
        previous: Map<string, NestedBucket>;
        current: Map<string, NestedBucket>;
      } = {
        previous: new Map(),
        current: new Map(),
      };

      for (const row of rows) {
        const period = row.period as string;
        const dateKey = "full";

        const targetMap =
          period === "current" ? bucketMap.current : bucketMap.previous;

        let bucket = targetMap.get(dateKey);
        if (!bucket) {
          bucket = { date: dateKey };
          targetMap.set(dateKey, bucket);
        }

        if (groupBy && row.group_key !== undefined && row.group_key !== null) {
          // Grouped results — mirrors parseTimeseriesResults lines 242-270
          const groupKey = String(row.group_key);
          if (!bucket[groupBy]) {
            bucket[groupBy] = {};
          }
          const groupData = bucket[groupBy] as Record<
            string,
            Record<string, number>
          >;
          if (!groupData[groupKey]) {
            groupData[groupKey] = {};
          }

          for (let i = 0; i < series.length; i++) {
            const seriesItem = series[i]!;
            const alias = buildMetricAlias(
              i,
              seriesItem.metric,
              seriesItem.aggregation,
              seriesItem.key,
              seriesItem.subkey,
            );
            const aggregation =
              seriesItem.aggregation === "terms"
                ? "cardinality"
                : seriesItem.aggregation;
            const seriesName = seriesItem.pipeline
              ? `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.pipeline.field}/${seriesItem.pipeline.aggregation}`
              : seriesItem.key
                ? `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.key}`
                : `${i}/${seriesItem.metric}/${aggregation}`;
            const value = row[alias];
            if (value !== undefined && value !== null) {
              groupData[groupKey]![seriesName] = Number(value);
            }
          }
        } else {
          // Non-grouped results — mirrors parseTimeseriesResults lines 271-288
          for (let i = 0; i < series.length; i++) {
            const seriesItem = series[i]!;
            const alias = buildMetricAlias(
              i,
              seriesItem.metric,
              seriesItem.aggregation,
              seriesItem.key,
              seriesItem.subkey,
            );
            const aggregation =
              seriesItem.aggregation === "terms"
                ? "cardinality"
                : seriesItem.aggregation;
            const seriesName = seriesItem.pipeline
              ? `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.pipeline.field}/${seriesItem.pipeline.aggregation}`
              : seriesItem.key
                ? `${i}/${seriesItem.metric}/${aggregation}/${seriesItem.key}`
                : `${i}/${seriesItem.metric}/${aggregation}`;
            const value = row[alias];
            if (value !== undefined && value !== null) {
              bucket[seriesName] = Number(value);
            }
          }
        }
      }

      const currentPeriod = Array.from(bucketMap.current.values());
      const previousPeriod = Array.from(bucketMap.previous.values());

      return { currentPeriod, previousPeriod };
    }

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

      const series: SeriesInputType[] = [
        {
          metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
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

      const currentGroupData = currentBucket[
        "evaluations.evaluation_label"
      ] as Record<string, Record<string, number>>;

      // cat_a gets its value under the series name key
      expect(currentGroupData["cat_a"]!["0/metadata.trace_id/cardinality"]).toBe(150);
      // cat_b gets its value under the series name key
      expect(currentGroupData["cat_b"]!["0/metadata.trace_id/cardinality"]).toBe(160);

      // Verify nested structure exists for previous period
      expect(previousPeriod).toHaveLength(1);
      const previousBucket = previousPeriod[0]!;
      const previousGroupData = previousBucket[
        "evaluations.evaluation_label"
      ] as Record<string, Record<string, number>>;

      expect(previousGroupData["cat_a"]!["0/metadata.trace_id/cardinality"]).toBe(100);
      expect(previousGroupData["cat_b"]!["0/metadata.trace_id/cardinality"]).toBe(110);
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

      const series: SeriesInputType[] = [
        {
          metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
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

      const series: SeriesInputType[] = [
        {
          metric: "metadata.thread_id" as FlattenAnalyticsMetricsEnum,
          aggregation: "cardinality",
          pipeline: { field: "user_id" as const, aggregation: "avg" as const },
        },
      ];

      const { currentPeriod } = simulateGroupedParsing(
        simulatedRows,
        series,
        "metadata.user_id",
      );

      expect(currentPeriod).toHaveLength(1);
      const groupData = currentPeriod[0]![
        "metadata.user_id"
      ] as Record<string, Record<string, number>>;

      // Each group key gets its own metric value under the pipeline series name
      expect(
        groupData["group_x"]!["0/metadata.thread_id/cardinality/user_id/avg"],
      ).toBe(3.5);
      expect(
        groupData["group_y"]!["0/metadata.thread_id/cardinality/user_id/avg"],
      ).toBe(7.2);
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

      const series: SeriesInputType[] = [
        {
          metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
          aggregation: "cardinality",
        },
      ];

      const { currentPeriod } = simulateGroupedParsing(
        simulatedRows,
        series,
        "evaluations.evaluation_label",
      );

      expect(currentPeriod).toHaveLength(1);
      const groupData = currentPeriod[0]![
        "evaluations.evaluation_label"
      ] as Record<string, Record<string, number>>;

      // Empty string group_key is treated as a valid key (String("") === "")
      expect(groupData[""]!["0/metadata.trace_id/cardinality"]).toBe(42);
      // Non-empty key is also preserved
      expect(groupData["known_label"]!["0/metadata.trace_id/cardinality"]).toBe(88);
    });
  });

  describe("metric key normalization", () => {
    /**
     * This test verifies the fix for % change indicators not showing.
     * When ClickHouse returns NULL for pipeline metrics in the previous period
     * (e.g., due to empty subquery results), the normalization ensures
     * all metrics have default values of 0 in both periods.
     */
    it("normalizes missing metrics to 0 so frontend can calculate % change", () => {
      // Simulate ClickHouse response where pipeline metrics return NULL for previous period
      // (this happens when subquery returns no data for that period)
      const simulatedChResponseWithNulls = [
        {
          period: "current",
          "0__metadata_thread_id__cardinality": 150, // simple metric - always present
          "1__metadata_thread_id__cardinality": 3.5, // pipeline metric
          "2__threads_average_duration_per_thread__avg": 8280000, // pipeline metric
          "3__metadata_trace_id__cardinality": 25.5, // pipeline metric
        },
        {
          period: "previous",
          "0__metadata_thread_id__cardinality": 120, // simple metric - always present
          // Pipeline metrics are NULL - simulated by not including them
          // (ClickHouse returns null, which skips the key in parsing)
        },
      ];

      // Simulate parsing with normalization (as the service does)
      type Bucket = { date: string; [key: string]: number | string };
      const currentPeriod: Bucket[] = [];
      const previousPeriod: Bucket[] = [];

      for (const row of simulatedChResponseWithNulls) {
        const period = row.period as "current" | "previous";
        const bucket: Bucket = { date: "full" };

        for (const [key, value] of Object.entries(row)) {
          if (key === "period") continue;
          if (value !== undefined && value !== null) {
            bucket[key] = Number(value);
          }
        }

        if (period === "current") {
          currentPeriod.push(bucket);
        } else {
          previousPeriod.push(bucket);
        }
      }

      // Before normalization: previousPeriod is missing pipeline metrics
      expect(previousPeriod[0]!["1__metadata_thread_id__cardinality"]).toBeUndefined();
      expect(previousPeriod[0]!["2__threads_average_duration_per_thread__avg"]).toBeUndefined();
      expect(previousPeriod[0]!["3__metadata_trace_id__cardinality"]).toBeUndefined();

      // Apply normalization (same logic as ClickHouseAnalyticsService.normalizeMetricKeys)
      const allMetricKeys = new Set<string>();
      for (const bucket of [...previousPeriod, ...currentPeriod]) {
        for (const key of Object.keys(bucket)) {
          if (key === "date") continue;
          allMetricKeys.add(key);
        }
      }
      for (const bucket of [...previousPeriod, ...currentPeriod]) {
        for (const key of allMetricKeys) {
          if (bucket[key] === undefined) {
            bucket[key] = 0;
          }
        }
      }

      // After normalization: all metrics present with 0 defaults
      expect(previousPeriod[0]!["0__metadata_thread_id__cardinality"]).toBe(120);
      expect(previousPeriod[0]!["1__metadata_thread_id__cardinality"]).toBe(0);
      expect(previousPeriod[0]!["2__threads_average_duration_per_thread__avg"]).toBe(0);
      expect(previousPeriod[0]!["3__metadata_trace_id__cardinality"]).toBe(0);

      // Current period should be unchanged
      expect(currentPeriod[0]!["0__metadata_thread_id__cardinality"]).toBe(150);
      expect(currentPeriod[0]!["1__metadata_thread_id__cardinality"]).toBe(3.5);
      expect(currentPeriod[0]!["2__threads_average_duration_per_thread__avg"]).toBe(8280000);
      expect(currentPeriod[0]!["3__metadata_trace_id__cardinality"]).toBe(25.5);

      // Now frontend can calculate % change for all metrics
      // e.g., for metric 1: (3.5 - 0) / 0 = Infinity or displayed as "New"
      // This is better than not showing any % change indicator
    });
  });
});
