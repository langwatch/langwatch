// Unit tests for SQL `listAll` emits. List pages in two stages: inner picks
// page traces (keys only), outer reads payload. Dedup is full-window aggregate.
// Assertions on emitted SQL; companion integration test proves semantics
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { TraceListQuery } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { recordingAuthorizedReads } from "./support/authorized-reads.support.ts";

/** The full-window version dedup, identified by its GROUP BY. */
const DEDUP_AGGREGATE = "GROUP BY TenantId, TraceId";

/** Where the outer page stage hands the chosen row identities to the inner one. */
const IDENTITY_HANDOVER = "(TenantId, TraceId, UpdatedAt) IN (";

const NOW = Date.now();

function occurrences({ haystack, needle }: { haystack: string; needle: string }): number {
  return haystack.split(needle).length - 1;
}

function makeRepo() {
  const { reads, sent } = recordingAuthorizedReads();
  return {
    repo: TraceListClickHouseRepository.create({
      reads,
    }),
    sent,
    queries: { find: (match: (sql: string) => boolean) => sent.map((r) => r.sql).find(match) },
    all: () => sent.map((request) => request.sql),
  };
}

function baseQuery(overrides: Partial<TraceListQuery> = {}): TraceListQuery {
  return {
    authorization: ownProof({ projectId: "tenant-1", now: NOW }),
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

describe("TraceListClickHouseRepository.listAll (unit)", () => {
  describe("when the caller asks for a page of traces", () => {
    it("builds the version dedup aggregate once for the page read, not once per stage", async () => {
      const { repo, queries } = makeRepo();

      await repo.listAll(baseQuery());

      const pageQuery = queries.find(isPageQuery);
      expect(pageQuery).toBeDefined();
      expect(occurrences({ haystack: pageQuery!, needle: DEDUP_AGGREGATE })).toBe(1);
    });

    it("carries the winning row's identity from the inner page stage to the outer read", async () => {
      const { repo, queries } = makeRepo();

      await repo.listAll(baseQuery());

      const pageQuery = queries.find(isPageQuery)!;
      // The inner stage resolved (TraceId, UpdatedAt) for the page. The outer
      // stage selects exactly those rows, so it needs no dedup of its own.
      expect(pageQuery).toContain("(TenantId, TraceId, UpdatedAt) IN (");
      expect(pageQuery).toContain("SELECT TenantId, TraceId, UpdatedAt");
    });

    it("still bounds the total count by the version dedup", async () => {
      const { repo, queries } = makeRepo();

      await repo.listAll(baseQuery());

      const countQuery = queries.find(isCountQuery);
      expect(countQuery).toBeDefined();
      expect(occurrences({ haystack: countQuery!, needle: DEDUP_AGGREGATE })).toBe(1);
    });

    it("names no tenant itself: the reader binds the proof's fence", async () => {
      const { repo, sent } = makeRepo();

      await repo.listAll(baseQuery());

      expect(sent).toHaveLength(2);
      for (const request of sent) {
        expect(request.params).not.toHaveProperty("tenantId");
        expect(request.params).toMatchObject({ tenantScope_all: ["tenant-1"] });
      }
    });
  });

  describe("when the query carries a keyset cursor", () => {
    it("breaks sort ties on the tenant and the trace id together, since two members may hold one trace id", async () => {
      const { repo, sent } = makeRepo();

      await repo.listAll(
        baseQuery({ cursor: { sortValue: 1_500, tenantId: "tenant-1", traceId: "trace-a" } }),
      );

      const page = sent.find((request) => isPageQuery(request.sql))!;
      expect(page.sql).toContain(
        "(TenantId, TraceId) > ({cursorTenantId:String}, {cursorTraceId:String})",
      );
      expect(page.sql).not.toMatch(/AND TraceId > \{cursorTraceId/);
      expect(occurrences({ haystack: page.sql, needle: "TenantId ASC, TraceId ASC" })).toBe(2);
      expect(page.params).toMatchObject({ cursorTenantId: "tenant-1", cursorTraceId: "trace-a" });
    });

    it("falls back to the trace id alone for a cursor minted before it carried its tenant", async () => {
      const { repo, sent } = makeRepo();

      await repo.listAll(baseQuery({ cursor: { sortValue: 1_500, traceId: "trace-a" } }));

      const page = sent.find((request) => isPageQuery(request.sql))!;
      expect(page.sql).toMatch(/AND TraceId > \{cursorTraceId:String\}/);
      expect(page.params).not.toHaveProperty("cursorTenantId");
    });
  });

  describe("when the proof shares member projects", () => {
    it("reads every tenant the fence names and returns each row's tenant", async () => {
      const { reads, sent } = recordingAuthorizedReads([[]]);
      const repo = TraceListClickHouseRepository.create({
        reads,
      });

      await repo.listAll(
        baseQuery({
          authorization: aggregateProof({
            projectId: "aggregate",
            members: [{ projectId: "member-a", from: 0 }],
            now: NOW,
          }),
        }),
      );

      for (const request of sent) {
        expect(request.tenantIds).toEqual(["aggregate", "member-a"]);
      }
    });
  });

  describe("when the query carries a user filter", () => {
    it("keeps it out of the dedup so a trace cannot answer to both sides of it", async () => {
      const { repo, all } = makeRepo();

      await repo.listAll(
        baseQuery({
          filterWhere: { sql: USER_FILTER, params: { unused: 1 } },
        }),
      );

      for (const sql of all()) {
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

      await repo.listAll(
        baseQuery({
          filterWhere: { sql: USER_FILTER, params: { unused: 1 } },
        }),
      );

      // Identity alone cannot separate two unmerged rows that share one
      // (TenantId, TraceId, UpdatedAt), so the outer stage has to re-state the
      // filter. Assert WHERE the two copies sit, not just how many there are:
      // a count alone would also pass with both copies stuck in the inner
      // stage, which is the arrangement this test exists to rule out.
      const pageQuery = queries.find(isPageQuery)!;
      const handover = pageQuery.indexOf(IDENTITY_HANDOVER);
      expect(handover).toBeGreaterThan(-1);

      // The outer WHERE is written before the handover, the inner one inside it.
      const outerStage = pageQuery.slice(0, handover);
      const innerStage = pageQuery.slice(handover);
      expect(occurrences({ haystack: outerStage, needle: USER_FILTER })).toBe(1);
      expect(occurrences({ haystack: innerStage, needle: USER_FILTER })).toBe(1);
    });
  });
});

describe("TraceListClickHouseRepository's other reads (unit)", () => {
  const authorization = ownProof({ projectId: "tenant-1", now: NOW });
  const timeRange = { from: 1_000, to: 2_000 };

  it("reads every facet, count and value lookup through the proof", async () => {
    const { repo, sent } = makeRepo();

    await repo.findCount({ authorization, timeRange, since: 1_500 });
    await repo.findTraceIds({ authorization, timeRange, limit: 10 });
    await repo.findDistinctValues({ authorization, column: "TraceName", prefix: "a", limit: 5 });
    await repo.findCategoricalFacet({
      authorization,
      timeRange,
      table: "trace_summaries",
      timeColumn: "OccurredAt",
      facetExpression: "TraceName",
      limit: 5,
      offset: 0,
    });
    await repo.findDiscreteValues({
      authorization,
      timeRange,
      table: "stored_spans",
      timeColumn: "StartTime",
      column: "StatusCode",
      limit: 5,
    });
    await repo.findRangeStatsForTable({
      authorization,
      timeRange,
      table: "evaluation_runs",
      timeColumn: "ScheduledAt",
      column: "Score",
    });
    await repo.findBatchedFacets({
      authorization,
      timeRange,
      table: "trace_summaries",
      timeColumn: "OccurredAt",
      categoricalSpecs: [{ key: "name", expression: "TraceName" }],
      rangeSpecs: [{ key: "cost", expression: "TotalCost" }],
      topN: 5,
    });
    await repo.findAttributeValues({
      authorization,
      timeRange,
      attributeKey: "k",
      limit: 5,
      offset: 0,
    });
    await repo.findEventAttributeValues({
      authorization,
      timeRange,
      attributeKey: "k",
      limit: 5,
      offset: 0,
    });
    await repo.findSpanAttributeValues({
      authorization,
      timeRange,
      attributeKey: "k",
      limit: 5,
      offset: 0,
    });

    expect(sent).toHaveLength(11);
    for (const request of sent) {
      expect(request.tenantId).toBe("tenant-1");
      expect(request.params).not.toHaveProperty("tenantId");
    }
  });

  it("selects each trace's tenant beside its id, keeps one row per pair, answers each id once", async () => {
    const { reads, sent } = recordingAuthorizedReads([
      [
        { TenantId: "member-a", TraceId: "shared" },
        { TenantId: "member-b", TraceId: "shared" },
      ],
    ]);
    const repo = TraceListClickHouseRepository.create({
      reads,
    });

    const ids = await repo.findTraceIds({ authorization, timeRange, limit: 10 });

    expect(sent[0]!.sql).toContain("SELECT TenantId, TraceId");
    expect(sent[0]!.sql).toContain("LIMIT 1 BY TenantId, TraceId");
    expect(ids).toEqual(["shared"]);
  });
});
