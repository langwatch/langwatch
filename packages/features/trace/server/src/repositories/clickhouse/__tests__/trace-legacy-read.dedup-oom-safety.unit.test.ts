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
      `Could not extract method "${methodName}" from source. ` + `Pattern: ${pattern.source}`,
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
      `Could not extract function "${functionName}" from source. ` + `Pattern: ${pattern.source}`,
    );
  }
  return withoutComments(match[0]);
}

/**
 * Comments are stripped before any of these assertions read the source,
 * because every one of them is a substring check and comments talk about the
 * very patterns being checked. A note explaining why the dedup uses
 * `max(UpdatedAt)` satisfied `toContain("max(UpdatedAt)")` on its own — the
 * SQL could drop the aggregate and the guard would still pass — and a comment
 * mentioning `LIMIT 1 BY` would fail the opposite assertion while the query
 * was fine.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("trace dedup OOM safety", () => {
  function repoRoot(): string {
    let dir = __dirname;
    while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error("no workspace root above this test");
      dir = parent;
    }
    return dir;
  }

  const traceServicePath = path.resolve(__dirname, "..", "trace-legacy-read.repository.ts");
  const traceServiceSource = fs.readFileSync(traceServicePath, "utf-8");

  /**
   * The clustering domain has moved twice — into app-layer, then out into the
   * topic feature package — and this read followed neither. Resolved from the
   * workspace root so the next move fails loudly on the path instead of
   * silently taking the whole suite out of CI.
   */
  const topicClusteringPath = path.join(
    repoRoot(),
    "packages/features/topic/server/src/intents/topic-clustering-runner.intent.ts",
  );
  const topicClusteringSource = fs.readFileSync(topicClusteringPath, "utf-8");

  // ---------------------------------------------------------------------------
  // clickhouse-trace.service.ts: fetchTracesWithPagination + fetchTraceSummaryRows
  // ---------------------------------------------------------------------------
  describe("fetchTracesWithPagination()", () => {
    const paginationBody = extractMethodBody(traceServiceSource, "fetchTracesWithPagination");
    const summaryBody = extractMethodBody(traceServiceSource, "fetchTraceSummaryRows");
    const body = paginationBody + summaryBody;

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
    const body = extractMethodBody(traceServiceSource, "fetchTracesWithSpansJoined");

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

      it("uses max(UpdatedAt) GROUP BY for span dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // span-storage.clickhouse.repository.ts (app-layer): getSpansByTraceId
  // ---------------------------------------------------------------------------
  describe("SpanStorageClickHouseRepository.getSpansByTraceId() (app-layer)", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "getSpansByTraceId");
    const dedupHelper = extractFunctionBody(spanStorageSource, "dedupInTuple");

    describe("when the stored_spans query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
        expect(dedupHelper).not.toContain("LIMIT 1 BY");
      });

      it("delegates dedup to the IN-tuple helper", () => {
        expect(body).toContain("dedupInTuple");
      });

      it("uses max(UpdatedAt) GROUP BY for span dedup", () => {
        expect(dedupHelper).toContain("max(UpdatedAt)");
        expect(dedupHelper).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // span-storage.clickhouse.repository.ts (app-layer): getEventsByTraceId
  // ---------------------------------------------------------------------------
  describe("SpanStorageClickHouseRepository.getEventsByTraceId() (app-layer)", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "getEventsByTraceId");
    const dedupHelper = extractFunctionBody(spanStorageSource, "dedupInTuple");

    describe("when the stored_spans query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
        expect(dedupHelper).not.toContain("LIMIT 1 BY");
      });

      it("delegates dedup to the IN-tuple helper", () => {
        expect(body).toContain("dedupInTuple");
      });

      it("uses max(UpdatedAt) GROUP BY for span dedup", () => {
        expect(dedupHelper).toContain("max(UpdatedAt)");
        expect(dedupHelper).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // span-storage.clickhouse.repository.ts (app-layer): getTraceEventsByTraceId
  // ---------------------------------------------------------------------------
  describe("SpanStorageClickHouseRepository.getTraceEventsByTraceId() (app-layer)", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "getTraceEventsByTraceId");

    describe("when the events-only query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("delegates dedup to the IN-tuple helper", () => {
        expect(body).toContain("dedupInTuple");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // topicClustering.ts: fetchTracesFromClickHouse
  // ---------------------------------------------------------------------------
  describe("fetchTracesFromClickHouse()", () => {
    const body = extractFunctionBody(topicClusteringSource, "fetchTracesFromClickHouse");

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

  // ---------------------------------------------------------------------------
  // aggregation-builder.ts: dedupedTraceSummaries (@regression #3158)
  // ---------------------------------------------------------------------------
  describe("dedupedTraceSummaries() (analytics)", () => {
    const aggregationBuilderPath = path.join(
      repoRoot(),
      "packages/features/analytics/server/src/clickhouse/aggregation-builder.ts",
    );
    const aggregationBuilderSource = fs.readFileSync(aggregationBuilderPath, "utf-8");
    const body = extractFunctionBody(aggregationBuilderSource, "dedupedTraceSummaries");

    describe("when the dedup SQL template is inspected", () => {
      it("does not use LIMIT 1 BY for deduplication", () => {
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(body).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // simulation.clickhouse.repository.ts: entire file (@regression #3158)
  // ---------------------------------------------------------------------------
  describe("SimulationClickHouseRepository (entire file)", () => {
    const simulationRepoPath = path.join(
      repoRoot(),
      "packages/features/scenario/server/src/repositories/clickhouse/simulation-clickhouse.repository.ts",
    );
    const simulationRepoSource = withoutComments(fs.readFileSync(simulationRepoPath, "utf-8"));

    it("does not use LIMIT 1 BY anywhere", () => {
      expect(simulationRepoSource).not.toContain("LIMIT 1 BY");
    });
  });

  // ---------------------------------------------------------------------------
  // Canonical Experiment run repository: entire file (@regression #3158)
  // ---------------------------------------------------------------------------
  describe("ClickHouseExperimentRunRepository (entire file)", () => {
    const experimentRunServicePath = path.join(
      repoRoot(),
      "packages/features/experiment/server/src/repositories/clickhouse/clickhouse.experiment-run.repository.ts",
    );
    const experimentRunServiceSource = withoutComments(
      fs.readFileSync(experimentRunServicePath, "utf-8"),
    );

    it("does not use LIMIT 1 BY anywhere", () => {
      expect(experimentRunServiceSource).not.toContain("LIMIT 1 BY");
    });
  });
});
