/**
 * @vitest-environment node
 * @unit
 *
 * The trace list service folds the explorer's hidden origins into every read
 * but the origin facet's own count. See
 * specs/traces-v2/origin-badge-filter.feature.
 */
import { describe, expect, it, vi } from "vitest";
import { LANGY_TRACE_ORIGIN } from "../derive-trace-origin";
import { HIDDEN_ORIGINS_PARAM } from "../hidden-origins";
import { SessionGroupsService } from "../session-groups.service";
import { TraceListService } from "../trace-list.service";

const timeRange = { from: 1_700_000_000_000, to: 1_700_086_400_000 };
const filterWhere = { sql: "ContainsErrorStatus = 1", params: {} };

function fakeRepository() {
  return {
    findAll: vi.fn().mockResolvedValue({ rows: [], totalHits: 0 }),
    findFacetCounts: vi.fn().mockResolvedValue({ values: {} }),
    findRangeStats: vi.fn().mockResolvedValue({ min: 0, max: 0 }),
    findCount: vi.fn().mockResolvedValue(0),
  };
}

function serviceWith(repository: ReturnType<typeof fakeRepository>) {
  return new TraceListService(
    repository as never,
    { findSummariesByTraceIds: vi.fn().mockResolvedValue({}) } as never,
    { getNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
  );
}

const hidesLangy = expect.objectContaining({
  filterWhere: expect.objectContaining({
    sql: expect.stringContaining(
      `NOT IN ({${HIDDEN_ORIGINS_PARAM}:Array(String)})`,
    ),
    params: expect.objectContaining({
      [HIDDEN_ORIGINS_PARAM]: [LANGY_TRACE_ORIGIN],
    }),
  }),
});

describe("TraceListService with hidden origins", () => {
  describe("given the explorer hides Langy's origin", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("reads the list with the exclusion after the filter", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getList({
        tenantId: "tenant-1",
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 50,
        filterWhere,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      expect(repository.findAll).toHaveBeenCalledWith(hidesLangy);
      const call = repository.findAll.mock.calls[0]![0];
      expect(call.filterWhere.sql.startsWith(`(${filterWhere.sql}) AND `)).toBe(
        true,
      );
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("counts the new traces with the exclusion", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getNewCount({
        tenantId: "tenant-1",
        timeRange,
        since: timeRange.from,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      expect(repository.findCount).toHaveBeenCalledWith(hidesLangy);
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("counts every facet and range but origin with the exclusion", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: "tenant-1",
        timeRange,
        filterWhere,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const facetCalls = repository.findFacetCounts.mock.calls.map(
        ([params]) => params,
      );
      const originCalls = facetCalls.filter((params) =>
        params.facetExpression.includes("langwatch.origin"),
      );
      const otherCalls = facetCalls.filter(
        (params) => !params.facetExpression.includes("langwatch.origin"),
      );
      expect(originCalls).toHaveLength(1);
      expect(otherCalls.length).toBeGreaterThan(0);
      for (const params of otherCalls) {
        expect(params).toEqual(hidesLangy);
      }
      for (const [params] of repository.findRangeStats.mock.calls) {
        expect(params).toEqual(hidesLangy);
      }
    });

    /** @scenario "The origin facet still offers Langy" */
    it("counts the origin facet with the filter alone", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: "tenant-1",
        timeRange,
        filterWhere,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const originCall = repository.findFacetCounts.mock.calls
        .map(([params]) => params)
        .find((params) => params.facetExpression.includes("langwatch.origin"));
      expect(originCall?.filterWhere).toBe(filterWhere);
    });
  });

  describe("given nothing hidden", () => {
    /** @scenario "Naming an origin turns the default off" */
    it("passes the filter through as it is", async () => {
      const repository = fakeRepository();
      const service = serviceWith(repository);
      await service.getList({
        tenantId: "tenant-1",
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 50,
        filterWhere,
        hiddenOrigins: [],
      });
      await service.getNewCount({
        tenantId: "tenant-1",
        timeRange,
        since: timeRange.from,
        filterWhere,
        hiddenOrigins: [],
      });
      await service.getFacets({
        tenantId: "tenant-1",
        timeRange,
        filterWhere,
        hiddenOrigins: [],
      });

      expect(repository.findAll.mock.calls[0]![0].filterWhere).toBe(
        filterWhere,
      );
      expect(repository.findCount.mock.calls[0]![0].filterWhere).toBe(
        filterWhere,
      );
      for (const [params] of repository.findFacetCounts.mock.calls) {
        expect(params.filterWhere).toBe(filterWhere);
      }
    });
  });
});

describe("SessionGroupsService with hidden origins", () => {
  function sessionService(findSessionGroups: ReturnType<typeof vi.fn>) {
    return new SessionGroupsService({
      repository: { findSessionGroups } as never,
      codingAgentSessions: { getBySessionId: async () => null },
    });
  }

  describe("given the explorer hides Langy's origin", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("reads the sessions with the exclusion after the filter", async () => {
      const findSessionGroups = vi
        .fn()
        .mockResolvedValue({ rows: [], totalHits: 0 });
      await sessionService(findSessionGroups).getSessionGroups({
        tenantId: "tenant-1",
        timeRange,
        pageSize: 50,
        filterWhere,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      expect(findSessionGroups).toHaveBeenCalledWith(hidesLangy);
    });
  });

  describe("given nothing hidden", () => {
    /** @scenario "Naming an origin turns the default off" */
    it("passes the filter through as it is", async () => {
      const findSessionGroups = vi
        .fn()
        .mockResolvedValue({ rows: [], totalHits: 0 });
      await sessionService(findSessionGroups).getSessionGroups({
        tenantId: "tenant-1",
        timeRange,
        pageSize: 50,
        filterWhere,
        hiddenOrigins: [],
      });

      expect(findSessionGroups.mock.calls[0]![0].filterWhere).toBe(filterWhere);
    });
  });
});
