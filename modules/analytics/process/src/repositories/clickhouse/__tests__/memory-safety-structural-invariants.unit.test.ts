/**
 * Memory safety regression tests for ClickHouse analytics queries.
 * @see specs/analytics/clickhouse-memory-safety.feature (Layer 1: @unit scenarios)
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";

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
  describe("when analytics queries access SpanAttributes", () => {
    /**
     * Regex that matches bare "SpanAttributes" NOT followed by ['key'] access. We
     * check the outermost SELECT by splitting on subquery boundaries.
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
        else if (depth === 0 && sql.slice(i, i + 4) === "FROM") {
          return sql.slice(selectIdx, i);
        }
        i++;
      }
      return sql.slice(selectIdx);
    }

    const metricsRequiringSpans: {
      metric: string;
      aggregation: "avg" | "sum" | "cardinality";
      label: string;
    }[] = [
      {
        metric: "performance.tokens_per_second",
        aggregation: "avg",
        label: "tokens_per_second (accesses SpanAttributes for output_tokens)",
      },
      {
        metric: "events.event_type",
        aggregation: "sum",
        label: "event_type (joins stored_spans for Events)",
      },
      // metadata.span_type with cardinality no longer joins stored_spans
      // (fix: span_type cardinality uses uniq(TraceId) from trace_summaries only).
      // Non-cardinality aggregations still join — covered by the groupBy test below.
    ];

    for (const { metric, aggregation, label } of metricsRequiringSpans) {
      describe(`when generating SQL for ${label}`, () => {
        /** @scenario Analytics queries access SpanAttributes only via key extraction */
        it("does not include bare SpanAttributes in the outermost SELECT", () => {
          const result = buildTimeseriesQuery({
            ...baseInput,
            series: [{ metric, aggregation }],
          });

          const outerSelect = getOutermostSelect(result.sql);
          expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
        });
      });
    }

    describe("when generating SQL for any groupBy that touches stored_spans", () => {
      /** @scenario "Analytics queries access SpanAttributes only via key extraction" */
      it("does not include bare SpanAttributes in the outermost SELECT", () => {
        const result = buildTimeseriesQuery({
          ...baseInput,
          series: [
            {
              metric: "metadata.trace_id",
              aggregation: "cardinality",
            },
          ],
          groupBy: "metadata.span_type",
        });

        const outerSelect = getOutermostSelect(result.sql);
        expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
      });
    });
  });

  // Scenarios 2-4 (topic and field-discovery reads) are trace's reads, proven in trace's own
  // trace-legacy-read.memory-safety.unit.test.ts.

  // -------------------------------------------------------------------------
  // Scenario 5: All query execution paths include memory safety settings
  // -------------------------------------------------------------------------
  describe("when checking that query execution paths include memory safety settings", () => {
    describe("when ANALYTICS_CLICKHOUSE_SETTINGS is inspected in source", () => {
      /** @scenario "Analytics queries include a memory spill-to-disk safety setting" */
      it("defines max_bytes_before_external_group_by with a positive value", () => {
        const servicePath = path.resolve(__dirname, "../../../rules/clickhouse-settings.rules.ts");
        const source = fs.readFileSync(servicePath, "utf-8");

        // Verify the settings constant exists and contains the required key
        expect(source).toContain("ANALYTICS_CLICKHOUSE_SETTINGS");
        expect(source).toContain("max_bytes_before_external_group_by");

        // Verify it has a positive numeric value
        const settingsMatch = source.match(/max_bytes_before_external_group_by:\s*(\d[\d_]*)/);
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
      /** @scenario All query execution paths include memory safety settings */
      it("passes clickhouse_settings to every .query() call in legacy-analytics-backend.clickhouse.repository.ts", () => {
        // The queries moved out of clickhouse-analytics.service.ts (which now
        // delegates to a repository) so the client is reached through the App
        // instead of resolved in the service — see
        // src/server/clickhouse/__tests__/clientAccessBoundary.unit.test.ts.
        const servicePath = path.resolve(__dirname, "../clickhouse.analytics.repository.ts");
        const source = fs.readFileSync(servicePath, "utf-8");

        const queryBlocks = findQueryCallBlocks(source);

        expect(queryBlocks.length).toBeGreaterThan(0);

        for (const block of queryBlocks) {
          expect(block).toContain("clickhouse_settings");
        }
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Every metric prefix in metric-translator has a column-pruning test
  // -------------------------------------------------------------------------
  describe("when checking that every metric prefix has a column-pruning test", () => {
    describe("when comparing metric-translator prefixes to column-pruning tests", () => {
      /** @scenario Every metric prefix in metric-translator has a column-pruning test */
      it("has at least one column-pruning test for every registered metric prefix", () => {
        // Extract metric prefixes from metric-translator.ts by reading the source
        const translatorPath = path.resolve(
          __dirname,
          "..",
          "clickhouse.metric-translator.mapper.ts",
        );
        const translatorSource = fs.readFileSync(translatorPath, "utf-8");

        // Find all metric.startsWith("prefix.") patterns
        const prefixPattern = /metric\.startsWith\("([^"]+)\."\)/g;
        const registeredPrefixes = new Set<string>();
        let prefixMatch = prefixPattern.exec(translatorSource);
        while (prefixMatch !== null) {
          registeredPrefixes.add(prefixMatch[1]!);
          prefixMatch = prefixPattern.exec(translatorSource);
        }

        expect(registeredPrefixes.size).toBeGreaterThan(0);

        // Read the column-pruning test file to find which prefixes are covered
        const pruningTestPath = path.resolve(__dirname, "column-pruning.test.ts");
        const pruningTestSource = fs.readFileSync(pruningTestPath, "utf-8");

        // Find all metric references and groupBy references in the test
        // A prefix is "covered" if it appears as a metric OR groupBy value
        const coveredPrefixes = new Set<string>();

        // Check metrics: "prefix.something"
        const metricRefPattern = /"([a-z_]+)\.[a-z_]+"\s*as\s*AnalyticsSeries\["metric"\]/g;
        let metricRef = metricRefPattern.exec(pruningTestSource);
        while (metricRef !== null) {
          coveredPrefixes.add(metricRef[1]!);
          metricRef = metricRefPattern.exec(pruningTestSource);
        }

        // Check groupBy: groupBy: "prefix.something"
        const groupByPattern = /groupBy:\s*"([a-z_]+)\.[a-z_]+"/g;
        let groupByRef = groupByPattern.exec(pruningTestSource);
        while (groupByRef !== null) {
          coveredPrefixes.add(groupByRef[1]!);
          groupByRef = groupByPattern.exec(pruningTestSource);
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

/** Every `.query({ ... })` argument object in the source, braces balanced. */
function findQueryCallBlocks(source: string): string[] {
  const queryCallPattern = /\.query\(\s*\{/g;
  const queryBlocks: string[] = [];
  let match = queryCallPattern.exec(source);
  while (match !== null) {
    const startIdx = match.index + match[0].length - 1;
    queryBlocks.push(source.slice(startIdx, closingBraceEnd(source, startIdx)));
    match = queryCallPattern.exec(source);
  }
  return queryBlocks;
}

function closingBraceEnd(source: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return i;
}
