/**
 * @vitest-environment node
 * @unit
 *
 * `TraceListService.getFacets`: the sidebar's counts read the same predicate
 * as the list (the active query, the exact window, the hidden origins), each
 * facet with its own field left out, and facets that share a predicate share
 * one batched scan. See specs/traces-v2/search.feature ("Facet count
 * updates").
 */
import { describe, expect, it, vi } from "vitest";
import { LANGY_TRACE_ORIGIN } from "../derive-trace-origin";
import { FACET_REGISTRY } from "../facet-registry";
import { translateFilterToClickHouse } from "../filter-to-clickhouse";
import { HIDDEN_ORIGINS_PARAM } from "../hidden-origins";
import { TraceListService } from "../trace-list.service";

const TENANT = "tenant-1";
const timeRange = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

function fakeRepository() {
  return {
    findBatchedFacets: vi
      .fn()
      .mockResolvedValue({ categoricals: {}, ranges: {} }),
    findCategoricalFacet: vi
      .fn()
      .mockResolvedValue({ values: [], totalDistinct: 0 }),
    findCategoricalFacetRaw: vi
      .fn()
      .mockResolvedValue({ values: [], totalDistinct: 0 }),
    findRangeStatsForTable: vi.fn().mockResolvedValue({ min: 0, max: 0 }),
    findDiscreteValues: vi
      .fn()
      .mockResolvedValue({ values: [], distinctCount: 0 }),
  };
}

function serviceWith(repository: ReturnType<typeof fakeRepository>) {
  return new TraceListService(
    repository as never,
    { findSummariesByTraceIds: vi.fn().mockResolvedValue({}) } as never,
    { getNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
  );
}

type BatchCall = {
  table: string;
  timeRange: unknown;
  categoricalSpecs: { key: string }[];
  rangeSpecs: { key: string }[];
  filterWhere?: { sql: string; params: Record<string, unknown> };
};

function batchCalls(repository: ReturnType<typeof fakeRepository>) {
  return repository.findBatchedFacets.mock.calls.map(
    ([params]) => params as BatchCall,
  );
}

function batchCarrying(
  repository: ReturnType<typeof fakeRepository>,
  key: string,
): BatchCall {
  const call = batchCalls(repository).find(
    (c) =>
      c.categoricalSpecs.some((s) => s.key === key) ||
      c.rangeSpecs.some((s) => s.key === key),
  );
  if (!call) throw new Error(`no batched read carries the ${key} facet`);
  return call;
}

const compiled = (query: string) =>
  translateFilterToClickHouse(query, TENANT, timeRange)!.sql;

describe("TraceListService.getFacets", () => {
  describe("given a query naming two facet fields", () => {
    const query = "status:error AND service:api";

    /** @scenario "Facet counts show how many results another filter would yield" */
    it("counts each named facet under the query without its own field", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const status = batchCarrying(repository, "status");
      expect(status.filterWhere?.sql).toContain(compiled("service:api"));
      expect(status.filterWhere?.sql).not.toContain(compiled("status:error"));

      const service = batchCarrying(repository, "service");
      expect(service.filterWhere?.sql).toContain(compiled("status:error"));
      expect(service.filterWhere?.sql).not.toContain(compiled("service:api"));
    });

    /** @scenario "Facet counts update when a filter is applied" */
    it("counts a facet the query never names under the whole query", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      expect(batchCarrying(repository, "user").filterWhere?.sql).toContain(
        compiled(query),
      );
      expect(batchCarrying(repository, "cost").filterWhere?.sql).toContain(
        compiled(query),
      );
    });

    /** @scenario "Facet counts are fetched in a single batched query" */
    it("shares one scan between every facet under the same predicate", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const summaryCalls = batchCalls(repository).filter(
        (c) => c.table === "trace_summaries",
      );
      // The whole query, the query without status, the query without
      // service, and the origin facet's own read without the hidden origins.
      expect(summaryCalls).toHaveLength(4);
      expect(batchCarrying(repository, "user")).toBe(
        batchCarrying(repository, "cost"),
      );
    });

    it("reaches facets on other tables through the filtered traces", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      // The batched read hands the repository the trace filter; the
      // repository scopes it to `stored_spans` as a membership test (see
      // `scopeTraceFilterToTable` and the repository integration test).
      const spans = batchCalls(repository).find(
        (c) => c.table === "stored_spans",
      );
      expect(spans?.filterWhere?.sql).toContain(compiled(query));

      const evaluator = repository.findCategoricalFacetRaw.mock.calls
        .map(([params]) => params.query as { sql: string; params: unknown })
        .find((q) => q.sql.includes("FROM evaluation_runs"));
      expect(evaluator?.sql).toContain("TraceId IN (");
      expect(evaluator?.sql).toContain(compiled(query));
    });

    it("leaves attribute key discovery to discover", async () => {
      const repository = fakeRepository();
      const { facets } = await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query,
      });

      expect(facets.some((f) => f.kind === "dynamic_keys")).toBe(false);
      for (const [params] of repository.findCategoricalFacetRaw.mock.calls) {
        expect(params.query.sql).not.toContain("arrayJoin(Attributes.keys)");
      }
    });
  });

  describe("given the explorer hides Langy's origin", () => {
    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("applies the exclusion to every facet but origin", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query: "status:error",
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const origin = batchCarrying(repository, "origin");
      expect(origin.filterWhere?.params).not.toHaveProperty(
        HIDDEN_ORIGINS_PARAM,
      );
      for (const call of batchCalls(repository)) {
        if (call === origin) continue;
        if (call.table !== "trace_summaries") continue;
        expect(call.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM, [
          LANGY_TRACE_ORIGIN,
        ]);
      }
      for (const [params] of repository.findDiscreteValues.mock.calls) {
        expect(params.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM);
      }
      const model = repository.findCategoricalFacet.mock.calls.find(
        ([params]) => params.facetExpression === "arrayJoin(Models)",
      )?.[0];
      expect(model?.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM);
    });

    /** @scenario "Span and evaluation facets count the whole window while no filter is active" */
    it("counts facets on other tables as discover does when only the origin rule applies", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query: "",
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const spans = batchCalls(repository).find(
        (c) => c.table === "stored_spans",
      );
      expect(spans?.filterWhere).toBeUndefined();
      const evaluator = repository.findCategoricalFacetRaw.mock.calls
        .map(([params]) => params.query as { sql: string })
        .find((q) => q.sql.includes("FROM evaluation_runs"));
      expect(evaluator?.sql).not.toContain("TraceId IN (");
    });
  });

  describe("given a query naming only a facet on another table", () => {
    /** @scenario "A facet on spans or evaluations reads the listed traces once any filter is active" */
    it("scopes that facet to the window's visible traces, its own field left out", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query: "evaluatorStatus:error",
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const own = batchCarrying(repository, "evaluatorStatus");
      expect(own.table).toBe("evaluation_runs");
      expect(own.filterWhere?.sql).toContain(HIDDEN_ORIGINS_PARAM);
      expect(own.filterWhere?.sql).not.toContain("evaluation_runs");
    });
  });

  describe("given no query", () => {
    /** @scenario "Facet counts are fetched in a single batched query" */
    it("reads every trace facet but origin in one batched scan", async () => {
      const repository = fakeRepository();
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange,
        query: null,
        hiddenOrigins: [LANGY_TRACE_ORIGIN],
      });

      const summaryCalls = batchCalls(repository).filter(
        (c) => c.table === "trace_summaries",
      );
      expect(summaryCalls).toHaveLength(2);
      const batchedKeys = FACET_REGISTRY.filter(
        (d) =>
          d.table === "trace_summaries" &&
          d.key !== "origin" &&
          ((d.kind === "categorical" &&
            "expression" in d &&
            !d.expression.includes("arrayJoin")) ||
            d.kind === "range"),
      ).map((d) => d.key);
      const shared = summaryCalls.find(
        (c) => !c.categoricalSpecs.some((s) => s.key === "origin"),
      )!;
      expect(
        [...shared.categoricalSpecs, ...shared.rangeSpecs].map((s) => s.key),
      ).toEqual(batchedKeys);
    });
  });

  describe("given a live window", () => {
    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("reads the window as given, never snapped", async () => {
      const repository = fakeRepository();
      const live = {
        from: 1_700_000_123_456,
        to: 1_700_003_456_789,
        live: true,
      };
      await serviceWith(repository).getFacets({
        tenantId: TENANT,
        timeRange: live,
        query: "status:error",
      });

      for (const call of batchCalls(repository)) {
        expect(call.timeRange).toEqual(live);
      }
      for (const [params] of repository.findCategoricalFacet.mock.calls) {
        expect(params.timeRange).toEqual(live);
      }
    });
  });
});
