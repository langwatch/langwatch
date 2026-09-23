/**
 * The sidebar's counts read the list's own predicate (the active query, the
 * exact window, the hidden origins), each facet with its own field left out,
 * and facets that share a predicate share one batched scan.
 * @see specs/traces-v2/search.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  explorerHiddenOrigins,
  LANGY_TRACE_ORIGIN,
  type TraceListRead,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ClickHouseFacetRegistryAdapter } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { ClickHouseTraceQueryRepository } from "../../repositories/clickhouse/clickhouse.trace-query.repository.ts";
import { createFacetFilterResolver } from "../../rules/trace-facet-filter.rules.ts";
import {
  explorerOriginExclusion,
  HIDDEN_ORIGINS_PARAM,
  type TraceFilterWhere,
} from "../../rules/trace-filter-hidden-origins.rules.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const TENANT = "tenant-1";
const timeRange = { from: 1_700_000_000_000, to: 1_700_086_400_000 };
const translator = ClickHouseTraceQueryRepository.create();

type BatchCall = {
  table: string;
  timeRange: unknown;
  categoricalSpecs: { key: string }[];
  rangeSpecs: { key: string }[];
  filterWhere?: TraceFilterWhere;
};

function recordingRepository() {
  const calls = {
    batched: [] as BatchCall[],
    categorical: [] as {
      facetExpression: string;
      timeRange: unknown;
      filterWhere?: TraceFilterWhere;
    }[],
    raw: [] as { query: { sql: string } }[],
    discrete: [] as { filterWhere?: TraceFilterWhere }[],
  };
  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: vi.fn(async (params: BatchCall) => {
      calls.batched.push(params);
      return { categoricals: {}, ranges: {} };
    }),
    findCategoricalFacet: vi.fn(async (params) => {
      calls.categorical.push(params);
      return { values: [], totalDistinct: 0 };
    }),
    findCategoricalFacetRaw: vi.fn(async (params) => {
      calls.raw.push(params);
      return { values: [], totalDistinct: 0 };
    }),
    findRangeStatsForTable: vi.fn(async () => ({ min: 0, max: 0 })),
    findDiscreteValues: vi.fn(async (params) => {
      calls.discrete.push(params);
      return { values: [], distinctCount: 0 };
    }),
  });
  return { repository, calls };
}

/** The sidebar's read, composed the way the app composes it. */
async function facetsFor({
  query,
  window = timeRange,
}: {
  query: string;
  window?: { from: number; to: number; live?: boolean };
}) {
  const { repository, calls } = recordingRepository();
  const service = TraceListService.create({
    repository,
    evaluations: createApiFixture<EvaluationApi>({}),
    topicService: createApiFixture<TopicApi>({ getNamesByIds: async () => new Map() }),
  });
  const facets = await service.getFacets({
    tenantId: TENANT,
    timeRange: window,
    filterFor: createFacetFilterResolver({
      queryText: query,
      compile: (text) =>
        translator.translateFilter({ queryText: text, tenantId: TENANT, timeRange: window }) ??
        undefined,
      hide: explorerOriginExclusion({ hiddenOrigins: explorerHiddenOrigins(query) }),
    }),
  });
  return { facets, calls };
}

function carrying(calls: readonly BatchCall[], key: string): BatchCall {
  const call = calls.find(
    (c) => c.categoricalSpecs.some((s) => s.key === key) || c.rangeSpecs.some((s) => s.key === key),
  );
  if (!call) throw new Error(`no batched read carries the ${key} facet`);
  return call;
}

const compiled = (query: string) =>
  translator.translateFilter({ queryText: query, tenantId: TENANT, timeRange })?.sql ?? "";

describe("the sidebar's facet counts", () => {
  describe("given a query naming two facet fields", () => {
    const query = "status:error AND service:api";

    /** @scenario "Facet counts show how many results another filter would yield" */
    it("counts each named facet under the query without its own field", async () => {
      const { calls } = await facetsFor({ query });

      const status = carrying(calls.batched, "status");
      expect(status.filterWhere?.sql).toContain(compiled("service:api"));
      expect(status.filterWhere?.sql).not.toContain(compiled("status:error"));
      const service = carrying(calls.batched, "service");
      expect(service.filterWhere?.sql).toContain(compiled("status:error"));
      expect(service.filterWhere?.sql).not.toContain(compiled("service:api"));
    });

    it("counts a facet the query never names under the whole query", async () => {
      const { calls } = await facetsFor({ query });

      expect(carrying(calls.batched, "user").filterWhere?.sql).toContain(compiled(query));
      expect(carrying(calls.batched, "cost").filterWhere?.sql).toContain(compiled(query));
    });

    /** @scenario "Facet counts are fetched in a single batched query" */
    it("shares one scan between every facet under the same predicate", async () => {
      const { calls } = await facetsFor({ query });

      // The whole query, the query without status, without service, and the
      // origin facet's own read without the hidden origins.
      expect(calls.batched.filter((c) => c.table === "trace_summaries")).toHaveLength(4);
      expect(carrying(calls.batched, "user")).toBe(carrying(calls.batched, "cost"));
    });

    it("reaches facets on other tables through the filtered traces", async () => {
      const { calls } = await facetsFor({ query });

      const spans = calls.batched.find((c) => c.table === "stored_spans");
      expect(spans?.filterWhere?.sql).toContain(compiled(query));
    });

    it("leaves attribute key discovery to discover", async () => {
      const { facets, calls } = await facetsFor({ query });

      expect(facets.some((facet) => facet.kind === "dynamic_keys")).toBe(false);
      for (const call of calls.raw)
        expect(call.query.sql).not.toContain("arrayJoin(Attributes.keys)");
    });
  });

  describe("given the explorer hides Langy's origin", () => {
    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("applies the exclusion to every facet but origin", async () => {
      const { calls } = await facetsFor({ query: "status:error" });

      const origin = carrying(calls.batched, "origin");
      expect(origin.filterWhere?.params ?? {}).not.toHaveProperty(HIDDEN_ORIGINS_PARAM);
      for (const call of calls.batched) {
        if (call === origin || call.table !== "trace_summaries") continue;
        expect(call.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM, [LANGY_TRACE_ORIGIN]);
      }
      for (const call of calls.discrete) {
        expect(call.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM);
      }
      const model = calls.categorical.find((c) => c.facetExpression === "arrayJoin(Models)");
      expect(model?.filterWhere?.params).toHaveProperty(HIDDEN_ORIGINS_PARAM);
    });

    it("counts facets on other tables as discover does when only the origin rule applies", async () => {
      const { calls } = await facetsFor({ query: "" });

      expect(calls.batched.find((c) => c.table === "stored_spans")?.filterWhere).toBeUndefined();
    });
  });

  describe("given no query", () => {
    /** @scenario "Facet counts are fetched in a single batched query" */
    it("reads every trace facet but origin in one batched scan", async () => {
      const { calls } = await facetsFor({ query: "" });

      const summaries = calls.batched.filter((c) => c.table === "trace_summaries");
      expect(summaries).toHaveLength(2);
      const batchedKeys = ClickHouseFacetRegistryAdapter.FACET_REGISTRY.filter(
        (def) =>
          def.table === "trace_summaries" &&
          def.key !== "origin" &&
          ((def.kind === "categorical" &&
            "expression" in def &&
            !def.expression.includes("arrayJoin")) ||
            def.kind === "range"),
      ).map((def) => def.key);
      const shared = summaries.find((c) => !c.categoricalSpecs.some((s) => s.key === "origin"));
      expect(
        [...(shared?.categoricalSpecs ?? []), ...(shared?.rangeSpecs ?? [])].map((s) => s.key),
      ).toEqual(batchedKeys);
    });
  });

  describe("given a live window", () => {
    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("reads the window as given, never snapped", async () => {
      const live = { from: 1_700_000_123_456, to: 1_700_003_456_789, live: true };
      const { calls } = await facetsFor({ query: "status:error", window: live });

      for (const call of calls.batched) expect(call.timeRange).toEqual(live);
      for (const call of calls.categorical) expect(call.timeRange).toEqual(live);
    });
  });
});
