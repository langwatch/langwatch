/**
 * Unit tests for the SQL `findAll` emits.
 *
 * The list is paged in two stages: an inner stage picks the page's traces
 * (cheap, key + sort columns only), an outer stage reads the heavy payload
 * columns for that page alone. Both stages, plus the total count, have to
 * agree on which version of a trace is current.
 *
 * The version dedup is a full-window aggregate — it groups every row the
 * tenant has in the time range. Emitting it more than once per read makes
 * ClickHouse build that aggregate more than once, which is the dominant cost
 * of this list on large tenants. The outer stage does not need it: the inner
 * stage already resolved which exact row won, so it can hand the row's
 * identity over instead of re-deriving it.
 *
 * These assertions are on the emitted SQL because that is where the defect
 * lives; the companion integration test proves the dedup semantics and the
 * read-rows reduction against a real ClickHouse.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import { TraceListClickHouseRepository } from "../trace-list.clickhouse.repository";
import type { TraceListQuery } from "../trace-list.repository";

/** The full-window version dedup, identified by its GROUP BY. */
const DEDUP_AGGREGATE = "GROUP BY TenantId, TraceId";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function makeRepo() {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async ({ query }: { query: string }) => {
      queries.push(query);
      return { json: async () => [] };
    }),
  } as unknown as ClickHouseClient;
  return {
    repo: new TraceListClickHouseRepository(async () => client),
    queries,
  };
}

function baseQuery(overrides: Partial<TraceListQuery> = {}): TraceListQuery {
  return {
    tenantId: "tenant-1",
    timeRange: { from: 1_000, to: 2_000 },
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

/** The page read is the one that projects the heavy payload columns. */
const isPageQuery = (sql: string) => sql.includes("ComputedInput");
const isCountQuery = (sql: string) => sql.includes("totalHits");

const USER_FILTER = "AnnotationIds != []";

describe("TraceListClickHouseRepository.findAll (unit)", () => {
  describe("when the caller asks for a page of traces", () => {
    it("builds the version dedup aggregate once for the page read, not once per stage", async () => {
      const { repo, queries } = makeRepo();

      await repo.findAll(baseQuery());

      const pageQuery = queries.find(isPageQuery);
      expect(pageQuery).toBeDefined();
      expect(occurrences(pageQuery!, DEDUP_AGGREGATE)).toBe(1);
    });

    it("carries the winning row's identity from the inner page stage to the outer read", async () => {
      const { repo, queries } = makeRepo();

      await repo.findAll(baseQuery());

      const pageQuery = queries.find(isPageQuery)!;
      // The inner stage resolved (TraceId, UpdatedAt) for the page. The outer
      // stage selects exactly those rows, so it needs no dedup of its own.
      expect(pageQuery).toContain("(TenantId, TraceId, UpdatedAt) IN (");
      expect(pageQuery).toContain("SELECT TenantId, TraceId, UpdatedAt");
    });

    it("still bounds the total count by the version dedup", async () => {
      const { repo, queries } = makeRepo();

      await repo.findAll(baseQuery());

      const countQuery = queries.find(isCountQuery);
      expect(countQuery).toBeDefined();
      expect(occurrences(countQuery!, DEDUP_AGGREGATE)).toBe(1);
    });
  });

  describe("when the query carries a user filter", () => {
    it("keeps it out of the dedup so a trace cannot answer to both sides of it", async () => {
      const { repo, queries } = makeRepo();

      await repo.findAll(
        baseQuery({
          filterWhere: { sql: USER_FILTER, params: { unused: 1 } },
        }),
      );

      for (const sql of queries) {
        // Everything between the dedup subquery's FROM and its GROUP BY is the
        // predicate the dedup is decided on. The user filter must not be there.
        const dedupBodies = sql
          .split(DEDUP_AGGREGATE)
          .slice(0, -1)
          .map((chunk) => chunk.slice(chunk.lastIndexOf("SELECT TenantId")));
        for (const body of dedupBodies) {
          expect(body).not.toContain(USER_FILTER);
        }
      }
    });

    it("applies it to both stages of the page read, so an unmerged same-version row cannot slip through", async () => {
      const { repo, queries } = makeRepo();

      await repo.findAll(
        baseQuery({
          filterWhere: { sql: USER_FILTER, params: { unused: 1 } },
        }),
      );

      // Identity alone cannot separate two unmerged rows that share one
      // (TenantId, TraceId, UpdatedAt), so the outer stage has to re-state the
      // filter — once for the inner stage, once for the outer.
      const pageQuery = queries.find(isPageQuery)!;
      expect(occurrences(pageQuery, USER_FILTER)).toBe(2);
    });
  });
});
