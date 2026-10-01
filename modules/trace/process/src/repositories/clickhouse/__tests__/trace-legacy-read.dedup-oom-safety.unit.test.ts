// Regression tests for LIMIT 1 BY deduplication: ClickHouse materializes heavy
// columns before dedup, causing OOM. Use IN-tuple with max(UpdatedAt) instead
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

// Strip comments before assertions: substring checks are fragile to comment examples
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

  const clusteringSamplePath = path.resolve(
    __dirname,
    "..",
    "clickhouse.trace-clustering-sample.repository.ts",
  );
  const clusteringSampleSource = fs.readFileSync(clusteringSamplePath, "utf-8");

  // ---------------------------------------------------------------------------
  // clickhouse-trace.service.ts: fetchTracesWithPagination + fetchTraceSummaryRows
  // ---------------------------------------------------------------------------
  describe("fetchTracesWithPagination()", () => {
    const paginationBody = extractMethodBody(traceServiceSource, "fetchTracesWithPagination");
    const pageQueriesBody = extractFunctionBody(traceServiceSource, "buildPageQueries");
    const latestVersionBody = extractFunctionBody(traceServiceSource, "buildLatestVersionOnly");
    const summaryBody = extractMethodBody(traceServiceSource, "fetchTraceSummaryRows");
    const body = paginationBody + pageQueriesBody + latestVersionBody + summaryBody;

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
    const summaryReadBody = extractMethodBody(traceServiceSource, "readJoinedSummaryRows");
    const spanReadBody = extractMethodBody(traceServiceSource, "readJoinedSpanRows");
    const body =
      extractMethodBody(traceServiceSource, "fetchTracesWithSpansJoined") +
      extractMethodBody(traceServiceSource, "readJoinedTraceBatch") +
      summaryReadBody +
      spanReadBody;

    describe("when the trace summary query SQL is inspected", () => {
      it("does not use LIMIT 1 BY for trace_summaries dedup", () => {
        // The body may still contain LIMIT 200 BY TraceId for spans,
        // but must not contain LIMIT 1 BY anywhere.
        expect(body).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", () => {
        expect(summaryReadBody).toContain("max(UpdatedAt)");
        expect(summaryReadBody).toMatch(/GROUP BY\s+TenantId,\s*TraceId/);
      });
    });

    describe("when the stored_spans query SQL is inspected", () => {
      it("does not use SELECT * from stored_spans", () => {
        expect(body).not.toMatch(/SELECT\s+\*\s+FROM\s+stored_spans/i);
      });

      it("uses max(UpdatedAt) GROUP BY for span dedup", () => {
        expect(body).toContain("max(UpdatedAt)");
        expect(spanReadBody).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // span-storage.clickhouse.repository.ts (app-layer): getSpansByTraceId
  // ---------------------------------------------------------------------------
  describe("SpanStorageClickHouseRepository.getSpansByTraceId()", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "findSpansByTraceId");
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
  describe("SpanStorageClickHouseRepository.getEventsByTraceId()", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "findEventsByTraceId");
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
  describe("SpanStorageClickHouseRepository.getTraceEventsByTraceId()", () => {
    const spanStoragePath = path.resolve(__dirname, "..", "span-storage.repository.ts");
    const spanStorageSource = fs.readFileSync(spanStoragePath, "utf-8");
    const body = extractMethodBody(spanStorageSource, "findTraceEventsByTraceId");

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
  // clickhouse.trace-clustering-sample.repository.ts: findPageRows
  // ---------------------------------------------------------------------------
  describe("ClickHouseTraceClusteringSampleRepository.findPageRows()", () => {
    // The page read is the class's last method, so its body runs to the end of the file.
    const body = withoutComments(
      clusteringSampleSource.slice(clusteringSampleSource.indexOf("async findPageRows(")),
    );

    it("finds the page read in the repository source", () => {
      expect(body).toContain("findPageRows");
    });

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
  // clickhouse.aggregation-builder.mapper.ts: dedupedTraceSummaries (@regression #3158)
  // ---------------------------------------------------------------------------
  describe("dedupedTraceSummaries()", () => {
    const aggregationBuilderPath = path.join(
      repoRoot(),
      "modules/analytics/process/src/repositories/clickhouse/clickhouse.aggregation-builder.mapper.ts",
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
  describe("SimulationClickHouseRepository", () => {
    const simulationRepoPath = path.join(
      repoRoot(),
      "modules/scenario/process/src/repositories/clickhouse/simulation-clickhouse.repository.ts",
    );
    const simulationRepoSource = withoutComments(fs.readFileSync(simulationRepoPath, "utf-8"));

    it("does not use LIMIT 1 BY anywhere", () => {
      expect(simulationRepoSource).not.toContain("LIMIT 1 BY");
    });
  });

  // ---------------------------------------------------------------------------
  // Canonical Experiment run repository: entire file (@regression #3158)
  // ---------------------------------------------------------------------------
  describe("ClickHouseExperimentRunRepository", () => {
    const experimentRunServicePath = path.join(
      repoRoot(),
      "modules/experiment/process/src/repositories/clickhouse/clickhouse.experiment-run.repository.ts",
    );
    const experimentRunServiceSource = withoutComments(
      fs.readFileSync(experimentRunServicePath, "utf-8"),
    );

    it("does not use LIMIT 1 BY anywhere", () => {
      expect(experimentRunServiceSource).not.toContain("LIMIT 1 BY");
    });
  });
});
