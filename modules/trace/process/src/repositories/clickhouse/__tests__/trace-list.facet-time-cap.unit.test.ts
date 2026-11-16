// The sidebar's facet reads scan a tenant's whole window. Each one carries a
// server-side time cap, so one tenant's slow scan cannot hold the shared
// statement slots that every other tenant's reads queue for.
// @see specs/traces-v2/search.feature
import { AuthorizedClickHouse, type QueryRequest, tenantScope } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";

/** Raw facet queries go through `clickhouse`; built facet reads through `reader`. */
function makeRepo() {
  const requests: QueryRequest[] = [];
  const statements: string[] = [];
  const builtRequests: QueryRequest[] = [];
  const raw = clickHouseQueryClientDouble({
    query: vi.fn(async (request: QueryRequest) => {
      requests.push(request);
      return { rows: [] };
    }),
  });
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
  return {
    repo: TraceListClickHouseRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: async () => raw }),
      reader,
    }),
    requests,
    statements,
    builtRequests,
  };
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

const RAW_FACET_SQL = `SELECT '' AS facet_value, 0 AS cnt, 0 AS total_distinct FROM trace_summaries WHERE ${tenantScope("OccurredAt")}`;

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

  describe("when a raw facet query brings its own guard", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("keeps that guard's own memory ceiling and adds the time cap", async () => {
      const { repo, requests } = makeRepo();

      await repo.findCategoricalFacetRaw({
        authorization,
        query: { sql: RAW_FACET_SQL, params: {}, settings: { max_memory_usage: "1000000" } },
      });

      expect(requests[0]?.settings?.max_memory_usage).toBe("1000000");
      expect(Number(requests[0]?.settings?.max_execution_time)).toBeGreaterThan(0);
    });
  });

  describe("when a raw facet query names settings of its own", () => {
    /** @scenario "A facet read stopped at its time cap is not run again" */
    it("never loosens the time cap", async () => {
      const { repo, requests } = makeRepo();

      await repo.findCategoricalFacetRaw({
        authorization,
        query: {
          sql: RAW_FACET_SQL,
          params: {},
          settings: { max_execution_time: "600", timeout_overflow_mode: "break" },
        },
      });

      expect(requests[0]?.settings).toMatchObject({
        max_execution_time: "20",
        timeout_overflow_mode: "throw",
      });
    });
  });

  describe("when a facet read hits its time cap", () => {
    /** @scenario "A facet read stopped at its time cap is not run again" */
    it("asks the client not to run a raw facet statement again", async () => {
      const { repo, requests } = makeRepo();

      await repo.findCategoricalFacetRaw({
        authorization,
        query: { sql: RAW_FACET_SQL, params: {} },
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.retryOnTimeout).toBe(false);
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
