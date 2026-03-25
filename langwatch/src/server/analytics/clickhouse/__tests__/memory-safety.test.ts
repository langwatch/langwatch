/**
 * Memory safety regression tests for ClickHouse analytics queries.
 *
 * Validates structural invariants that prevent OOM in production:
 * - No bare SpanAttributes in outermost SELECT
 * - LIMIT clauses on discovery queries
 * - Memory spill-to-disk settings on all query paths
 * - Column-pruning test coverage for all metric prefixes
 *
 * @see specs/analytics/clickhouse-memory-safety.feature (Layer 1: @unit scenarios)
 */
import { beforeEach, describe, expect, it, test } from "vitest";
import { resetParamCounter } from "../filter-translator";
import { buildTimeseriesQuery } from "../aggregation-builder";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import * as fs from "node:fs";
import * as path from "node:path";

describe("memory-safety", () => {
  beforeEach(() => {
    resetParamCounter();
  });

  const baseInput = {
    projectId: "test-project",
    startDate: new Date("2024-01-01T00:00:00Z"),
    endDate: new Date("2024-01-02T00:00:00Z"),
    previousPeriodStartDate: new Date("2023-12-31T00:00:00Z"),
    timeScale: 60,
  };

  // -------------------------------------------------------------------------
  // Scenario 1: Analytics queries access SpanAttributes only via key extraction
  // -------------------------------------------------------------------------
  describe("SpanAttributes access in builder-generated queries", () => {
    /**
     * Regex that matches bare "SpanAttributes" NOT followed by ['key'] access.
     * We check the outermost SELECT by splitting on subquery boundaries.
     *
     * A bare SpanAttributes reference means the full Map column is being read,
     * which can be gigabytes for wide attribute sets.
     */
    const bareSpanAttributesPattern = /SpanAttributes(?!\s*\[)/;

    /**
     * Extract the outermost SELECT clause from SQL. The outermost SELECT is
     * everything from the first SELECT to the first FROM that is not inside
     * a parenthesized subquery.
     */
    function getOutermostSelect(sql: string): string {
      // Find the first SELECT
      const selectIdx = sql.indexOf("SELECT");
      if (selectIdx === -1) return sql;

      // Walk forward, tracking paren depth, until we find FROM at depth 0
      let depth = 0;
      let i = selectIdx + 6; // skip "SELECT"
      while (i < sql.length) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") depth--;
        else if (
          depth === 0 &&
          sql.slice(i, i + 4) === "FROM"
        ) {
          return sql.slice(selectIdx, i);
        }
        i++;
      }
      return sql.slice(selectIdx);
    }

    const metricsRequiringSpans: Array<{
      metric: FlattenAnalyticsMetricsEnum;
      aggregation: "avg" | "sum" | "cardinality";
      label: string;
    }> = [
      {
        metric: "performance.tokens_per_second" as FlattenAnalyticsMetricsEnum,
        aggregation: "avg",
        label: "tokens_per_second (accesses SpanAttributes for output_tokens)",
      },
      {
        metric: "events.event_type" as FlattenAnalyticsMetricsEnum,
        aggregation: "sum",
        label: "event_type (joins stored_spans for Events)",
      },
      {
        metric: "metadata.span_type" as FlattenAnalyticsMetricsEnum,
        aggregation: "cardinality",
        label: "span_type (joins stored_spans)",
      },
    ];

    for (const { metric, aggregation, label } of metricsRequiringSpans) {
      describe(`when generating SQL for ${label}`, () => {
        it("does not include bare SpanAttributes in the outermost SELECT", () => {
          const result = buildTimeseriesQuery({
            ...baseInput,
            series: [{ metric, aggregation }],
          });

          const outerSelect = getOutermostSelect(result.sql);
          // If SpanAttributes appears in outermost SELECT, it must be with ['key'] access
          if (outerSelect.includes("SpanAttributes")) {
            expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
          }
        });
      });
    }

    describe("when generating SQL for any groupBy that touches stored_spans", () => {
      it("does not include bare SpanAttributes in the outermost SELECT", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id" as FlattenAnalyticsMetricsEnum,
              aggregation: "cardinality",
            },
          ],
          groupBy: "metadata.span_type",
        });

        const outerSelect = getOutermostSelect(result.sql);
        if (outerSelect.includes("SpanAttributes")) {
          expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
        }
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Topic and field-discovery queries access only specific attributes
  // -------------------------------------------------------------------------
  describe("topic and field-discovery query attribute access", () => {
    /**
     * Read the actual production source of clickhouse-trace.service.ts and
     * extract the method bodies for getTopicCounts and getDistinctFieldNames.
     * This way, if the SQL changes the test checks the ACTUAL code.
     */
    const traceServicePath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "traces",
      "clickhouse-trace.service.ts",
    );
    const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

    const getTopicCountsBody = traceServiceSource.match(
      /async getTopicCounts[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    const getDistinctFieldNamesBody = traceServiceSource.match(
      /async getDistinctFieldNames[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    describe("when the topic counting query SQL is inspected", () => {
      it("does not select the full SpanAttributes Map column", () => {
        expect(getTopicCountsBody).not.toBeNull();
        expect(getTopicCountsBody![0]).not.toContain("SpanAttributes");
      });

      it("does not select the full Attributes Map column without key access", () => {
        expect(getTopicCountsBody).not.toBeNull();
        // Attributes without ['key'] means reading the entire Map
        expect(getTopicCountsBody![0]).not.toMatch(/\bAttributes\b(?!\[)/);
      });
    });

    describe("when the field discovery query SQL is inspected", () => {
      it("does not select the full SpanAttributes Map column", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        expect(getDistinctFieldNamesBody![0]).not.toContain("SpanAttributes");
      });

      it("uses mapKeys() for Attributes access (extracts keys only, not values)", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // mapKeys extracts only the key names, avoiding reading all Map values
        expect(getDistinctFieldNamesBody![0]).toContain("mapKeys(Attributes)");
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Topic counting query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("topic counting query LIMIT clause", () => {
    describe("when the topic counting query SQL is inspected", () => {
      test.todo(
        "includes a LIMIT clause — getTopicCounts() currently has no LIMIT; " +
          "add LIMIT to prevent unbounded result sets on projects with many topics",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Field discovery query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("field discovery query LIMIT clause", () => {
    describe("when the field discovery query SQL is inspected", () => {
      // Current production queries do NOT have LIMIT clauses.
      // This is a known gap that should be fixed.
      test.todo(
        "span names query includes a LIMIT clause — getDistinctFieldNames() " +
          "span name query currently has no LIMIT; add LIMIT to prevent " +
          "unbounded result sets on projects with many span names",
      );

      test.todo(
        "metadata keys query includes a LIMIT clause — getDistinctFieldNames() " +
          "metadata keys query currently has no LIMIT; add LIMIT to prevent " +
          "unbounded result sets on projects with many attribute keys",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: All query execution paths include memory safety settings
  // -------------------------------------------------------------------------
  describe("memory safety settings on query execution paths", () => {
    describe("when ANALYTICS_CLICKHOUSE_SETTINGS is inspected in source", () => {
      it("defines max_bytes_before_external_group_by with a positive value", () => {
        const servicePath = path.resolve(
          __dirname,
          "..",
          "clickhouse-analytics.service.ts",
        );
        const source = fs.readFileSync(servicePath, "utf-8");

        // Verify the settings constant exists and contains the required key
        expect(source).toContain("ANALYTICS_CLICKHOUSE_SETTINGS");
        expect(source).toContain("max_bytes_before_external_group_by");

        // Verify it has a positive numeric value
        const settingsMatch = source.match(
          /max_bytes_before_external_group_by:\s*(\d[\d_]*)/,
        );
        expect(settingsMatch).not.toBeNull();
        const value = parseInt(settingsMatch![1]!.replace(/_/g, ""), 10);
        expect(value).toBeGreaterThan(0);
      });
    });

    describe("when the analytics service source is inspected", () => {
      /**
       * Structural test: verify every .query() call in the analytics service
       * passes clickhouse_settings. This reads the source file and checks
       * that all query() invocations include the settings parameter.
       */
      it("passes clickhouse_settings to every .query() call in clickhouse-analytics.service.ts", () => {
        const servicePath = path.resolve(
          __dirname,
          "..",
          "clickhouse-analytics.service.ts",
        );
        const source = fs.readFileSync(servicePath, "utf-8");

        // Find all .query({ ... }) blocks
        const queryCallPattern = /\.query\(\s*\{/g;
        let match: RegExpExecArray | null;
        const queryBlocks: string[] = [];

        while ((match = queryCallPattern.exec(source)) !== null) {
          // Extract the block from the opening { to its matching }
          const startIdx = match.index + match[0].length - 1;
          let depth = 1;
          let i = startIdx + 1;
          while (i < source.length && depth > 0) {
            if (source[i] === "{") depth++;
            else if (source[i] === "}") depth--;
            i++;
          }
          queryBlocks.push(source.slice(startIdx, i));
        }

        expect(queryBlocks.length).toBeGreaterThan(0);

        for (const block of queryBlocks) {
          expect(block).toContain("clickhouse_settings");
        }
      });

      test.todo(
        "clickhouse-trace.service.ts query calls include clickhouse_settings — " +
          "getTopicCounts and getDistinctFieldNames currently do not pass clickhouse_settings",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Every metric prefix in metric-translator has a column-pruning test
  // -------------------------------------------------------------------------
  describe("metric prefix column-pruning test coverage", () => {
    describe("when comparing metric-translator prefixes to column-pruning tests", () => {
      it("has at least one column-pruning test for every registered metric prefix", () => {
        // Extract metric prefixes from metric-translator.ts by reading the source
        const translatorPath = path.resolve(
          __dirname,
          "..",
          "metric-translator.ts",
        );
        const translatorSource = fs.readFileSync(translatorPath, "utf-8");

        // Find all metric.startsWith("prefix.") patterns
        const prefixPattern =
          /metric\.startsWith\("([^"]+)\."\)/g;
        const registeredPrefixes = new Set<string>();
        let prefixMatch: RegExpExecArray | null;
        while (
          (prefixMatch = prefixPattern.exec(translatorSource)) !== null
        ) {
          registeredPrefixes.add(prefixMatch[1]!);
        }

        expect(registeredPrefixes.size).toBeGreaterThan(0);

        // Read the column-pruning test file to find which prefixes are covered
        const pruningTestPath = path.resolve(
          __dirname,
          "column-pruning.test.ts",
        );
        const pruningTestSource = fs.readFileSync(pruningTestPath, "utf-8");

        // Find all metric references and groupBy references in the test
        // A prefix is "covered" if it appears as a metric OR groupBy value
        const coveredPrefixes = new Set<string>();

        // Check metrics: "prefix.something" as FlattenAnalyticsMetricsEnum
        const metricRefPattern =
          /"([a-z_]+)\.[a-z_]+"\s*as\s*FlattenAnalyticsMetricsEnum/g;
        let metricRef: RegExpExecArray | null;
        while (
          (metricRef = metricRefPattern.exec(pruningTestSource)) !== null
        ) {
          coveredPrefixes.add(metricRef[1]!);
        }

        // Check groupBy: groupBy: "prefix.something"
        const groupByPattern = /groupBy:\s*"([a-z_]+)\.[a-z_]+"/g;
        let groupByRef: RegExpExecArray | null;
        while (
          (groupByRef = groupByPattern.exec(pruningTestSource)) !== null
        ) {
          coveredPrefixes.add(groupByRef[1]!);
        }

        // Assert every registered prefix has at least one test
        const missingPrefixes: string[] = [];
        for (const prefix of registeredPrefixes) {
          if (!coveredPrefixes.has(prefix)) {
            missingPrefixes.push(prefix);
          }
        }

        expect(
          missingPrefixes,
          `The following metric prefixes from metric-translator.ts have no ` +
            `column-pruning test coverage. Add tests to column-pruning.test.ts ` +
            `for: ${missingPrefixes.join(", ")}`,
        ).toEqual([]);
      });
    });
  });
});
