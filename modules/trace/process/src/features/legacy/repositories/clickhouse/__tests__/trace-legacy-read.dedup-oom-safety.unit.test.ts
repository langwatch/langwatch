// Regression tests for LIMIT 1 BY deduplication: ClickHouse materializes heavy
// columns before dedup, causing OOM. Use IN-tuple with max(UpdatedAt) instead
import * as fs from "node:fs";
import * as path from "node:path";

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import { SpanStorageClickHouseRepository } from "../../../../../repositories/clickhouse/span-storage.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

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
    "../../../../../repositories/clickhouse",
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
    /** The joined read's built summary and span statements, as the page read sends them. */
    async function joinedSql(): Promise<{ summary: string; spans: string }> {
      const statements: string[] = [];
      const service = mappedLegacyRead({
        reader: clickHouseQueryClientDouble({
          async read(request: Parameters<ClickHouseQueryClient["read"]>[0]) {
            statements.push(request.statement.sql);
            const sql = request.statement.sql;
            return { rows: sql.includes("AS ts_SpanCount") ? [traceSummaryRow({})] : [] };
          },
        }),
        resolveClickHouseClient: () =>
          Promise.reject(new Error("a built read never reaches the raw client")),
        traceCanonicalisation: TraceCanonicalisationService.create(),
      });
      await service.findTracesWithSpans({
        authorization: ownProof({ projectId: "project-1" }),
        projectId: "project-1",
        traceIds: ["trace-1"],
        protections: { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true },
        occurredAt: { from: 1_000_000, to: 2_000_000 },
      });
      const summary = statements.find((sql) => sql.includes("AS ts_SpanCount"));
      const spans = statements.find((sql) => sql.includes("FROM stored_spans"));
      if (summary === undefined || spans === undefined) {
        throw new Error("fixture: the joined read sent no summary or no span statement");
      }
      return { summary, spans };
    }

    describe("when the trace summary statement is inspected", () => {
      it("does not use LIMIT 1 BY for trace_summaries dedup", async () => {
        expect((await joinedSql()).summary).not.toContain("LIMIT 1 BY");
      });

      it("uses max(UpdatedAt) GROUP BY for trace dedup", async () => {
        const { summary } = await joinedSql();
        expect(summary).toContain("max(UpdatedAt)");
        expect(summary).toMatch(/GROUP BY\s+TenantId,\s*TraceId\)/);
      });
    });

    describe("when the stored_spans statement is inspected", () => {
      it("does not use SELECT * from stored_spans", async () => {
        expect((await joinedSql()).spans).not.toMatch(/SELECT\s+\*/i);
      });

      it("elects each span by an IN-tuple GROUP BY, never LIMIT 1 BY", async () => {
        const { spans } = await joinedSql();
        expect(spans).not.toContain("LIMIT 1 BY");
        expect(spans).toMatch(/\(TenantId, TraceId, SpanId, StartTime\) IN/);
        expect(spans).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // span-storage.repository.ts: the full-span and event reads, as built statements
  // ---------------------------------------------------------------------------
  describe("given SpanStorageClickHouseRepository's span and event reads", () => {
    const at = { authorization: ownProof({ projectId: "project-1" }), traceId: "trace-1" };
    const reads = {
      findSpansByTraceId: (repository: SpanStorageClickHouseRepository) =>
        repository.findSpansByTraceId(at),
      findEventsByTraceId: (repository: SpanStorageClickHouseRepository) =>
        repository.findEventsByTraceId(at),
      findTraceEventsByTraceId: (repository: SpanStorageClickHouseRepository) =>
        repository.findTraceEventsByTraceId(at),
    };

    describe.each(Object.entries(reads))("when the %s statement is built", (_name, read) => {
      async function builtSql(): Promise<string> {
        const statements: string[] = [];
        const repository = SpanStorageClickHouseRepository.create({
          resolveClient: () =>
            Promise.reject(new Error("a built read never reaches the raw client")),
          reader: clickHouseQueryClientDouble({
            async read(request: Parameters<ClickHouseQueryClient["read"]>[0]) {
              statements.push(request.statement.sql);
              return { rows: [] };
            },
          }),
        });
        await read(repository);
        expect(statements).toHaveLength(1);
        return statements[0] ?? "";
      }

      it("does not use LIMIT 1 BY for deduplication", async () => {
        expect(await builtSql()).not.toContain("LIMIT 1 BY");
      });

      it("elects each span's latest version with max(UpdatedAt) in an IN-tuple", async () => {
        const sql = await builtSql();
        expect(sql).toContain("max(UpdatedAt)");
        expect(sql).toMatch(/GROUP BY\s+TenantId,\s*TraceId,\s*SpanId/);
        expect(sql).toMatch(/\(TenantId, TraceId, SpanId, UpdatedAt\) IN/);
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

      // The builder renders the election from the descriptor: max(UpdatedAt) by TenantId, TraceId.
      it("elects each trace's latest version with the builder's IN-tuple election", () => {
        expect(body).toContain(".latestVersion(");
        expect(body).not.toContain("FINAL");
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
