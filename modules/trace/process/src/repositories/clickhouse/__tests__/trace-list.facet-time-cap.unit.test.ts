// The sidebar's facet reads scan a tenant's whole window. Each one carries a
// server-side time cap, so one tenant's slow scan cannot hold the shared
// statement slots that every other tenant's reads queue for.
// @see specs/traces-v2/search.feature
import { AuthorizedClickHouse, type QueryRequest, tenantScope } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";

function makeRepo() {
  const requests: QueryRequest[] = [];
  const client = clickHouseQueryClientDouble({
    query: vi.fn(async (request: QueryRequest) => {
      requests.push(request);
      return { rows: [] };
    }),
  });
  return {
    repo: TraceListClickHouseRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: async () => client }),
    }),
    requests,
  };
}

const authorization = ownProof({ projectId: "tenant-1" });
const timeRange = { from: 1_000, to: 2_000 };

const GiB = 1024 * 1024 * 1024;

/**
 * Short enough that a slow scan gives its slot back within the 20 s other
 * reads wait for one, small enough that one scan cannot fill a replica.
 */
function expectCapped(settings: QueryRequest["settings"]) {
  const seconds = Number(settings?.max_execution_time);
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThanOrEqual(30);
  const memory = Number(settings?.max_memory_usage);
  expect(memory).toBeGreaterThanOrEqual(2 * GiB);
  expect(memory).toBeLessThanOrEqual(4 * GiB);
}

describe("the facet reads' time and memory cap", () => {
  describe("when the sidebar batches categorical and range facets over spans", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("caps both scans", async () => {
      const { repo, requests } = makeRepo();

      await repo.findBatchedFacets({
        authorization,
        timeRange,
        table: "stored_spans",
        timeColumn: "StartTime",
        categoricalSpecs: [
          { key: "spanType", expression: "SpanAttributes['langwatch.span.type']" },
        ],
        rangeSpecs: [{ key: "duration", expression: "DurationMs" }],
        topN: 50,
      });

      expect(requests).toHaveLength(2);
      for (const request of requests) expectCapped(request.settings);
    });
  });

  describe("when one facet's values are read on their own", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("caps the categorical, discrete and range-stat scans", async () => {
      const { repo, requests } = makeRepo();
      const base = { authorization, timeRange, table: "trace_summaries" as const };

      await repo.findCategoricalFacet({
        ...base,
        timeColumn: "OccurredAt",
        facetExpression: "ServiceName",
        limit: 50,
        offset: 0,
      });
      await repo.findDiscreteValues({
        ...base,
        timeColumn: "OccurredAt",
        column: "SpanCount",
        limit: 50,
      });
      await repo.findRangeStatsForTable({
        ...base,
        timeColumn: "OccurredAt",
        column: "TotalCost",
      });

      expect(requests).toHaveLength(3);
      for (const request of requests) expectCapped(request.settings);
    });
  });

  describe("when a raw facet query brings its own guard", () => {
    /** @scenario "A capped facet read gives its shared slot back" */
    it("keeps that guard's own memory ceiling and adds the time cap", async () => {
      const { repo, requests } = makeRepo();

      await repo.findCategoricalFacetRaw({
        authorization,
        query: {
          sql: `SELECT '' AS facet_value, 0 AS cnt, 0 AS total_distinct FROM trace_summaries WHERE ${tenantScope("OccurredAt")}`,
          params: {},
          settings: { max_memory_usage: "1000000" },
        },
      });

      expect(requests[0]?.settings?.max_memory_usage).toBe("1000000");
      expect(Number(requests[0]?.settings?.max_execution_time)).toBeGreaterThan(0);
    });
  });
});
