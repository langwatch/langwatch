// Memory safety regression tests for ClickHouse analytics queries.
// Validates invariants preventing OOM: see specs/analytics/clickhouse-memory-safety.feature

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { beforeAll, describe, expect, it } from "vitest";

import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

/** A repository whose built reads are recorded and answered with no rows. */
function recordingRepository(): {
  repository: TraceLegacyReadClickHouseRepository;
  reads: ReadRequest[];
} {
  const reads: ReadRequest[] = [];
  const repository = TraceLegacyReadClickHouseRepository.create({
    reader: {
      read: async (request) => {
        reads.push(request);
        return { rows: [] };
      },
    },
  });
  return { repository, reads };
}

/** The SQL findTopicCounts sends, built and recorded rather than read off the source. */
async function topicCountsSql(): Promise<string> {
  const { repository, reads } = recordingRepository();
  await repository.findTopicCounts({
    projectId: "project-1",
    filters: {},
    startDate: 1,
    endDate: 2,
  });
  return reads.map((request) => request.statement.sql).join("\n");
}

/** The three statements findDistinctFieldNames sends: span names, metadata keys, evaluators. */
async function fieldDiscoverySql(): Promise<string[]> {
  const { repository, reads } = recordingRepository();
  await repository.findDistinctFieldNames("project-1", 1, 2);
  return reads.map((request) => request.statement.sql);
}

/**
 * The repository this reads, resolved once: the assertions are about the
 * SQL the shipped source issues, so a moved file with per-call-site paths
 * would die with ENOENT — a guard that looks like it's still guarding.
 */
function traceReadSourcePath(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "trace-legacy-read.repository.ts",
  );
}

describe("memory-safety", () => {
  // -------------------------------------------------------------------------
  // Scenario 2: Topic and field-discovery queries access only specific attributes
  // -------------------------------------------------------------------------
  describe("given a topic or field-discovery query", () => {
    /** The statements the shipped reads build, recorded, so a changed query is what is checked. */
    let topicCountsStatement = "";
    beforeAll(async () => {
      topicCountsStatement = await topicCountsSql();
    });

    let fieldDiscoveryStatements: string[] = [];
    beforeAll(async () => {
      fieldDiscoveryStatements = await fieldDiscoverySql();
    });

    describe("when the topic counting query SQL is inspected", () => {
      /** @scenario Topic and field-discovery queries access only specific attributes */
      it("does not select the full SpanAttributes Map column", () => {
        expect(topicCountsStatement).toContain("FROM trace_summaries");
        expect(topicCountsStatement).not.toContain("SpanAttributes");
      });

      it("does not select the full Attributes Map column without key access", () => {
        // Attributes without ['key'] means reading the entire Map
        expect(topicCountsStatement).not.toMatch(/\bAttributes\b(?!\[)/);
      });
    });

    describe("when the field discovery query SQL is inspected", () => {
      /** @scenario "Topic and field-discovery queries access only specific attributes" */
      it("does not select the full SpanAttributes Map column", () => {
        expect(fieldDiscoveryStatements).toHaveLength(3);
        for (const sql of fieldDiscoveryStatements) expect(sql).not.toContain("SpanAttributes");
      });

      it("uses mapKeys() for Attributes access (extracts keys only, not values)", () => {
        const metadataKeys = fieldDiscoveryStatements[1] ?? "";
        expect(metadataKeys).toContain("FROM trace_summaries");
        // mapKeys extracts only the key names, avoiding reading all Map values
        expect(metadataKeys).toContain("mapKeys(Attributes)");
        expect(metadataKeys.replace(/mapKeys\(Attributes\)/g, "")).not.toMatch(/\bAttributes\b/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Topic counting query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("given the topic counting query's LIMIT clause", () => {
    describe("when the topic counting query SQL is inspected", () => {
      /** @scenario Topic counting query includes a LIMIT clause */
      it("includes a LIMIT clause followed by a number", async () => {
        expect(await topicCountsSql()).toMatch(/\bLIMIT\s+\d+/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Field discovery query includes a LIMIT clause
  // -------------------------------------------------------------------------
  describe("given the field discovery query's LIMIT clause", () => {
    describe("when the field discovery query SQL is inspected", () => {
      let statements: string[] = [];
      beforeAll(async () => {
        statements = await fieldDiscoverySql();
      });

      /** @scenario Field discovery query includes a LIMIT clause */
      it("span names query includes a LIMIT clause followed by a number", () => {
        expect(statements[0]).toContain("FROM stored_spans");
        expect(statements[0]).toMatch(/\bLIMIT\s+\d+/);
      });

      it("metadata keys query includes a LIMIT clause followed by a number", () => {
        expect(statements[1]).toMatch(/\bLIMIT\s+\d+/);
      });

      it("evaluator names query includes a LIMIT clause followed by a number", () => {
        expect(statements[2]).toContain("FROM evaluation_runs");
        expect(statements[2]).toMatch(/\bLIMIT\s+\d+/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: All query execution paths include memory safety settings
  // -------------------------------------------------------------------------
  describe("given query execution paths", () => {
    describe("when the trace service source is inspected", () => {
      it("resolves every client through the injected per-tenant resolver", () => {
        const source = fs.readFileSync(traceReadSourcePath(), "utf-8");

        // Every read must go through the resolver this repository was
        // composed with, so memory-safety settings are injected on every
        // query rather than remembered per call site. A bare client carries none.
        expect(source).toContain("this.resolveClient(");
        expect(source).not.toMatch(/\bcreateClient\s*\(/);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Every metric prefix in metric-translator has a column-pruning test
  // -------------------------------------------------------------------------
});
