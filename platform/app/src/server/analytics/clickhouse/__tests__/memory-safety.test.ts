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

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TenantClickHouseClient,
  TenantQuery,
} from "~/server/app-layer/clients/clickhouse/tenant-client";
import { clickHouseForProject } from "~/server/app-layer/clients/clickhouse/tenant-resolver";
import type { FlattenAnalyticsMetricsEnum } from "../../registry";
import { buildTimeseriesQuery } from "../aggregation-builder";
import {
  ANALYTICS_CLICKHOUSE_SETTINGS,
  ClickHouseAnalyticsService,
} from "../clickhouse-analytics.service";
import { resetParamCounter } from "../filter-translator";

vi.mock("~/server/app-layer/clients/clickhouse/tenant-resolver", () => ({
  clickHouseForProject: vi.fn(),
}));

const START_MS = new Date("2024-01-01T00:00:00Z").getTime();
const END_MS = new Date("2024-01-02T00:00:00Z").getTime();

/**
 * The service resolves its client ambiently, so the stand-in is installed by
 * mocking the resolver rather than by injection. It records every request and
 * answers with no rows — the reads under test are asserted on what they sent,
 * not on what came back.
 */
function analyticsServiceWithFakeClient(): {
  service: ClickHouseAnalyticsService;
  queries: TenantQuery[];
} {
  const queries: TenantQuery[] = [];
  const client = {
    tenantId: "test-project",
    query: async (request: TenantQuery) => {
      queries.push(request);
      return [];
    },
    insert: vi.fn(),
    queryWindowed: vi.fn(),
  } as unknown as TenantClickHouseClient;

  vi.mocked(clickHouseForProject).mockResolvedValue(client);

  return { service: new ClickHouseAnalyticsService(), queries };
}

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
        else if (depth === 0 && sql.slice(i, i + 4) === "FROM") {
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
          // If SpanAttributes appears in outermost SELECT, it must be with ['key'] access
          if (outerSelect.includes("SpanAttributes")) {
            expect(outerSelect).not.toMatch(bareSpanAttributesPattern);
          }
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
      /** @scenario Topic and field-discovery queries access only specific attributes */
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
      /** @scenario "Topic and field-discovery queries access only specific attributes" */
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

    describe("when the topic counting query SQL is inspected", () => {
      /** @scenario Topic counting query includes a LIMIT clause */
      it("includes a LIMIT clause followed by a number", () => {
        expect(getTopicCountsBody).not.toBeNull();
        expect(getTopicCountsBody![0]).toMatch(/\bLIMIT\s+\d+/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Field discovery query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("field discovery query LIMIT clause", () => {
    const traceServicePath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "traces",
      "clickhouse-trace.service.ts",
    );
    const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

    const getDistinctFieldNamesBody = traceServiceSource.match(
      /async getDistinctFieldNames[\s\S]*?(?=\n {2}async |\n {2}\/\*\*|\n {2}private )/,
    );

    describe("when the field discovery query SQL is inspected", () => {
      // A bounded LIMIT is either a literal number or a named numeric constant
      // interpolated into the query (e.g. `LIMIT ${DISTINCT_FIELD_NAMES_LIMIT}`).
      // Both keep the query bounded, which is what memory-safety requires.
      const BOUNDED_LIMIT = /\bLIMIT\s+(?:\d+|\$\{[A-Z0-9_]+\})/g;

      /** @scenario Field discovery query includes a LIMIT clause */
      it("span names query includes a LIMIT clause followed by a number", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // The body contains two queries (span names + metadata keys).
        // Verify at least two LIMIT occurrences so both are covered.
        const limitMatches = getDistinctFieldNamesBody![0].match(BOUNDED_LIMIT);
        expect(limitMatches).not.toBeNull();
        expect(limitMatches!.length).toBeGreaterThanOrEqual(1);
      });

      it("metadata keys query includes a LIMIT clause followed by a number", () => {
        expect(getDistinctFieldNamesBody).not.toBeNull();
        // Both the span-names and metadata-keys queries must have LIMIT.
        const limitMatches = getDistinctFieldNamesBody![0].match(BOUNDED_LIMIT);
        expect(limitMatches).not.toBeNull();
        expect(limitMatches!.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: All query execution paths include memory safety settings
  // -------------------------------------------------------------------------
  /**
   * These used to read `clickhouse-analytics.service.ts` off disk and assert
   * the string `clickhouse_settings` appeared inside every `.query({...})`
   * block. That proved the characters were present, not that a setting reached
   * ClickHouse — a rename of the field, or a fourth read added without one,
   * would still have matched somewhere in the file. They now run the service's
   * three reads against a stand-in client and assert on what each call carried.
   *
   * The companion check on `clickhouse-trace.service.ts` — "the source mentions
   * `getClickHouseClientForProject`, which wraps with default settings" — is
   * gone rather than renamed. The spill threshold is no longer something a
   * service opts into by importing the right accessor: the app-layer client
   * applies it to every read as a default, and `tenant-client.unit.test.ts`
   * pins both the default and a caller's override of it. Pinning another
   * service's imports by substring from here proved nothing that survives the
   * accessor being renamed.
   */
  describe("memory safety settings on query execution paths", () => {
    describe("when the analytics settings are inspected", () => {
      /** @scenario "Analytics queries include a memory spill-to-disk safety setting" */
      it("caps GROUP BY memory before it spills to disk", () => {
        expect(
          ANALYTICS_CLICKHOUSE_SETTINGS.max_bytes_before_external_group_by,
        ).toBeGreaterThan(0);
      });
    });

    describe("when every analytics read runs", () => {
      /** @scenario All query execution paths include memory safety settings */
      it("carries the analytics settings on each query the service issues", async () => {
        const { service, queries } = analyticsServiceWithFakeClient();

        await service.getDataForFilter(
          "test-project",
          "topics.topics",
          START_MS,
          END_MS,
        );
        await service.getTopUsedDocuments("test-project", START_MS, END_MS);
        await service.getFeedbacks("test-project", START_MS, END_MS);

        // Four reads, not three: topDocuments issues its page and its total
        // count as two separate queries.
        expect(queries).toHaveLength(4);
        for (const query of queries) {
          expect(query.settings).toEqual(ANALYTICS_CLICKHOUSE_SETTINGS);
        }
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Every metric prefix in metric-translator has a column-pruning test
  // -------------------------------------------------------------------------
  describe("metric prefix column-pruning test coverage", () => {
    describe("when comparing metric-translator prefixes to column-pruning tests", () => {
      /** @scenario Every metric prefix in metric-translator has a column-pruning test */
      it("has at least one column-pruning test for every registered metric prefix", () => {
        // Extract metric prefixes from metric-translator.ts by reading the source
        const translatorPath = path.resolve(
          __dirname,
          "..",
          "metric-translator.ts",
        );
        const translatorSource = fs.readFileSync(translatorPath, "utf-8");

        // Find all metric.startsWith("prefix.") patterns
        const prefixPattern = /metric\.startsWith\("([^"]+)\."\)/g;
        const registeredPrefixes = new Set<string>();
        let prefixMatch: RegExpExecArray | null;
        while ((prefixMatch = prefixPattern.exec(translatorSource)) !== null) {
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
        while ((groupByRef = groupByPattern.exec(pruningTestSource)) !== null) {
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
