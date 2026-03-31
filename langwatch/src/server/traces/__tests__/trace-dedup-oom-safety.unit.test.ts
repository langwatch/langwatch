/**
 * Structural regression tests for LIMIT 1 BY deduplication patterns.
 *
 * ClickHouse LIMIT 1 BY reads all selected columns (including heavy blobs
 * like ComputedInput, ComputedOutput, SpanAttributes) for every row in a
 * granule before deduplicating. On parts with large payloads this causes OOM.
 *
 * The safe alternative is an IN-tuple subquery:
 *   WHERE (key, UpdatedAt) IN (SELECT key, max(UpdatedAt) ... GROUP BY key)
 * which resolves dedup using only lightweight columns.
 *
 * These tests verify that the affected query methods no longer use LIMIT 1 BY
 * and instead use the max(UpdatedAt) GROUP BY pattern.
 *
 * @regression
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/** Read source file once and extract a named method body. */
function extractMethodBody(source: string, methodName: string): string {
  const pattern = new RegExp(
    `(?:async\\s+|private\\s+async\\s+|private\\s+)${methodName}[\\s\\S]*?(?=\\n {2}(?:async |private |/\\*\\*|\\}$))`,
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `Could not extract method "${methodName}" from source. ` +
        `Pattern: ${pattern.source}`,
    );
  }
  return match[0];
}

/** Read source file once and extract a named function body (top-level). */
function extractFunctionBody(source: string, functionName: string): string {
  const pattern = new RegExp(
    `(?:async\\s+)?function\\s+${functionName}[\\s\\S]*?(?=\\n(?:async\\s+)?function |\\n(?:export\\s+)|$)`,
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `Could not extract function "${functionName}" from source. ` +
        `Pattern: ${pattern.source}`,
    );
  }
  return match[0];
}

describe("trace dedup OOM safety", () => {
  const traceServicePath = path.resolve(
    __dirname,
    "..",
    "clickhouse-trace.service.ts",
  );
  const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

  const collectUsageStatsPath = path.resolve(
    __dirname,
    "..",
    "..",
    "collectUsageStats.ts",
  );
  const collectUsageStatsSource = fs.readFileSync(
    collectUsageStatsPath,
    "utf-8",
  );

  const topicClusteringPath = path.resolve(
    __dirname,
    "..",
    "..",
    "topicClustering",
    "topicClustering.ts",
  );
  const topicClusteringSource = fs.readFileSync(topicClusteringPath, "utf-8");

  // ---------------------------------------------------------------------------
  // clickhouse-trace.service.ts: fetchTracesWithPagination
  // ---------------------------------------------------------------------------
  describe("fetchTracesWithPagination()", () => {
    const body = extractMethodBody(
      traceServiceSource,
      "fetchTracesWithPagination",
    );

    describe("when the pagination query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });

      it("uses GROUP BY TraceId for page-selection subquery", () => {
        expect(body).toMatch(/GROUP BY\s+ts\.TraceId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // clickhouse-trace.service.ts: fetchTracesWithSpansJoined
  // ---------------------------------------------------------------------------
  describe("fetchTracesWithSpansJoined()", () => {
    const body = extractMethodBody(
      traceServiceSource,
      "fetchTracesWithSpansJoined",
    );

    describe("when the trace summary query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for trace_summaries dedup", () => {
        // The body may still contain LIMIT 200 BY TraceId for spans,
        // but must not contain LIMIT 1 BY anywhere.
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });
    });

    describe("when the stored_spans query SQL is inspected", () => {
      it("does not use SELECT * from stored_spans", () => {
        expect(body).not.toMatch(/SELECT\s+\*\s+FROM\s+stored_spans/i);
      });

      it("uses max(StartTime) GROUP BY for span dedup", () => {
        expect(body).toContain("max(StartTime)");
        expect(body).toMatch(
          /GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/,
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // collectUsageStats.ts: getChScenariosCount
  // ---------------------------------------------------------------------------
  describe("getChScenariosCount()", () => {
    const body = extractFunctionBody(
      collectUsageStatsSource,
      "getChScenariosCount",
    );

    describe("when the scenario count query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("does not use SELECT * for counting", () => {
        expect(body).not.toMatch(/SELECT\s+\*\s+FROM\s+simulation_runs/i);
      });

      it("uses max(UpdatedAt) GROUP BY for dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(
          /GROUP BY\s+TenantId,\s*ScenarioSetId,\s*BatchRunId,\s*ScenarioRunId/,
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // topicClustering.ts: fetchTracesFromClickHouse
  // ---------------------------------------------------------------------------
  describe("fetchTracesFromClickHouse()", () => {
    const body = extractFunctionBody(
      topicClusteringSource,
      "fetchTracesFromClickHouse",
    );

    describe("when the topic clustering query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });
    });
  });
});
