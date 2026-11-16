// The sidebar's facet reads scan a tenant's whole window. Each one carries a
// server-side time cap, so one tenant's slow scan cannot hold the shared
// statement slots that every other tenant's reads queue for.
// @see specs/traces-v2/search.feature
import type { QueryRequest } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { EVENT_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-events.repository.ts";
import { LABEL_FACET } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-label.repository.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";

/** Every facet read reaches the driver through the reader as a built statement. */
function makeRepo() {
  const statements: string[] = [];
  const builtRequests: QueryRequest[] = [];
  const reader = idIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: {
      execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
        statements.push(request.sql);
        builtRequests.push(request);
        return { rows: [] };
      }),
    },
  });
  return { repo: TraceListClickHouseRepository.create({ reader }), statements, builtRequests };
}

const authorization = ownProof({ projectId: "tenant-1" });
const timeRange = { from: 1_000, to: 2_000 };

const GiB = 1024 * 1024 * 1024;

/**
 * Short enough that a slow scan gives its slot back within the 20 s other
 * reads wait for one, small enough that one scan cannot fill a replica.
 */
function expectCapped(sql: string) {
  const clause = (key: string) => new RegExp(`SETTINGS .*\\b${key} = '?(\\w+)`).exec(sql)?.[1];
  const seconds = Number(clause("max_execution_time"));
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(30);
  expect(clause("timeout_overflow_mode")).toBe("throw");
  const memory = Number(clause("max_memory_usage"));
  expect(memory).toBeGreaterThanOrEqual(2 * GiB);
  expect(memory).toBeLessThanOrEqual(4 * GiB);
}

describe("the facet reads' time and memory cap", () => {
  describe("when the sidebar batches categorical and range facets over evaluation runs", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("caps both scans", async () => {
      const { repo, statements } = makeRepo();

      await repo.findBatchedFacets({
        authorization,
        timeRange,
        table: "evaluation_runs",
        categoricalKeys: ["evaluatorLabel"],
        rangeKeys: ["evaluatorScore"],
        topN: 50,
      });

      expect(statements).toHaveLength(2);
      for (const sql of statements) expectCapped(sql);
    });
  });

  describe("when one facet's values are read on their own", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("caps the categorical, discrete and range-stat scans", async () => {
      const { repo, statements } = makeRepo();
      const base = { authorization, timeRange, table: "trace_summaries" as const };

      await repo.findCategoricalFacet({ ...base, facetKey: "service", limit: 50, offset: 0 });
      await repo.findDiscreteValues({ ...base, facetKey: "spans", limit: 50 });
      await repo.findRangeStatsForTable({ ...base, facetKey: "cost" });

      expect(statements).toHaveLength(3);
      for (const sql of statements) expectCapped(sql);
    });
  });

  describe("when a queryBuilder facet brings its own memory guard", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("keeps the facet time and memory cap beside its spill threshold", async () => {
      const { repo, statements } = makeRepo();

      await repo.findQueryBuilderFacet({
        table: "stored_spans",
        query: EVENT_FACET.queryBuilder({ authorization, timeRange, limit: 50, offset: 0 }),
      });

      expect(statements).toHaveLength(1);
      expectCapped(statements[0]!);
      expect(statements[0]).toContain("max_bytes_before_external_group_by = 536870912");
    });
  });

  describe("when a facet read hits its time cap", () => {
    /** @scenario "A facet read stopped at its time cap is not run again" */
    it("asks the client not to run a queryBuilder facet read again", async () => {
      const { repo, builtRequests } = makeRepo();

      await repo.findQueryBuilderFacet({
        table: "trace_summaries",
        query: LABEL_FACET.queryBuilder({ authorization, timeRange, limit: 50, offset: 0 }),
      });

      expect(builtRequests).toHaveLength(1);
      expect(builtRequests[0]?.retryOnTimeout).toBe(false);
      expect(builtRequests[0]?.sql).toContain("timeout_overflow_mode = 'throw'");
    });

    /** @scenario "A facet read stopped at its time cap is not run again" */
    it("asks the client not to run a built facet read again", async () => {
      const { repo, builtRequests } = makeRepo();

      await repo.findCategoricalFacet({
        authorization,
        timeRange,
        table: "trace_summaries",
        facetKey: "service",
        limit: 50,
        offset: 0,
      });

      expect(builtRequests).toHaveLength(1);
      expect(builtRequests[0]?.retryOnTimeout).toBe(false);
    });
  });
});
