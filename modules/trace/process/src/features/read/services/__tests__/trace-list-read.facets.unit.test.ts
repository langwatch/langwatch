/**
 * The sidebar's counts read the list's own predicate (the active query, the
 * exact window, the hidden origins), each facet with its own field left out,
 * and facets that share a predicate share one batched scan.
 * @see specs/traces-v2/search.feature
 */
import type { Authorization } from "@langwatch/authorization";
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  type BatchedFacetResult,
  explorerHiddenOrigins,
  LANGY_TRACE_ORIGIN,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import type { TraceListRead } from "../../../../repositories/trace-list.repository.ts";
import { traceFacetFilterResolverFor } from "../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import {
  CLICKHOUSE_FACET_CATALOG,
  FACET_REGISTRY,
} from "../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import type { TraceFilterCompile } from "../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import type { TraceTopicNamesReadRepository } from "../../../topic/repositories/trace-topic-names.repository.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const TENANT = "tenant-1";
const timeRange = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

type BatchCall = {
  table: string;
  timeRange: unknown;
  categoricalKeys: readonly string[];
  rangeKeys: readonly string[];
  compileFilter?: TraceFilterCompile;
};

function recordingRepository({
  batchedFacets = async () => ({ categoricals: {}, ranges: {} }),
}: {
  batchedFacets?: (params: BatchCall) => ReturnType<TraceListRead["findBatchedFacets"]>;
} = {}) {
  const calls = {
    batched: [] as BatchCall[],
    categorical: [] as {
      facetKey: string;
      timeRange: unknown;
      compileFilter?: TraceFilterCompile;
    }[],
    raw: [] as { query: { sql: string } }[],
    discrete: [] as { compileFilter?: TraceFilterCompile }[],
  };
  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: vi.fn(async (params: BatchCall) => {
      calls.batched.push(params);
      return batchedFacets(params);
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
  authorization = ownProof({ projectId: TENANT }),
  repositoryFor = recordingRepository,
  topicNames = { findNamesByIds: async () => new Map() },
}: {
  query: string;
  window?: { from: number; to: number; live?: boolean };
  authorization?: Authorization;
  repositoryFor?: typeof recordingRepository;
  topicNames?: Pick<TraceTopicNamesReadRepository, "findNamesByIds">;
}) {
  const { repository, calls } = repositoryFor();
  const service = TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames,
  });
  const facets = await service.getFacets({
    authorization,
    timeRange: window,
    filterKey: query,
    filterFor: traceFacetFilterResolverFor({
      query,
      timeRange: window,
      hiddenOrigins: explorerHiddenOrigins(query),
    }),
  });
  return { facets, calls };
}

function carrying(calls: readonly BatchCall[], key: string): BatchCall {
  const call = calls.find((c) => c.categoricalKeys.includes(key) || c.rangeKeys.includes(key));
  if (!call) throw new Error(`no batched read carries the ${key} facet`);
  return call;
}

/** The values a facet's compiled filter binds when a read renders it. */
function boundBy(compile: TraceFilterCompile | undefined): unknown[] {
  const scope = tenantScope.single({ tenantId: TENANT });
  const compiled = compile?.({ scope });
  if (compiled?.kind !== "compiled") return [];
  const { params } = clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .where(compiled.where)
    .build();
  return Object.values(params);
}

describe("the sidebar's facet counts", () => {
  describe("given a query naming two facet fields", () => {
    const query = "user:alice AND service:api";

    /** @scenario "Facet counts show how many results another filter would yield" */
    it("counts each named facet under the query without its own field", async () => {
      const { calls } = await facetsFor({ query });

      const user = boundBy(carrying(calls.batched, "user").compileFilter);
      expect(user).toContain("api");
      expect(user).not.toContain("alice");
      const service = boundBy(carrying(calls.batched, "service").compileFilter);
      expect(service).toContain("alice");
      expect(service).not.toContain("api");
    });

    it("counts a facet the query never names under the whole query", async () => {
      const { calls } = await facetsFor({ query });

      expect(boundBy(carrying(calls.batched, "status").compileFilter)).toEqual(
        expect.arrayContaining(["alice", "api"]),
      );
      expect(boundBy(carrying(calls.batched, "cost").compileFilter)).toEqual(
        expect.arrayContaining(["alice", "api"]),
      );
    });

    /** @scenario "Facet counts are fetched in a single batched query" */
    it("shares one scan between every facet under the same predicate", async () => {
      const { calls } = await facetsFor({ query });

      // The whole query, the query without user, without service, and the
      // origin facet's own read without the hidden origins.
      expect(calls.batched.filter((c) => c.table === "trace_summaries")).toHaveLength(4);
      expect(carrying(calls.batched, "status")).toBe(carrying(calls.batched, "cost"));
    });

    it("reaches facets on other tables through the filtered traces", async () => {
      const { calls } = await facetsFor({ query });

      const spans = calls.batched.find((c) => c.table === "stored_spans");
      expect(boundBy(spans?.compileFilter)).toEqual(expect.arrayContaining(["alice", "api"]));
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
      expect(boundBy(origin.compileFilter)).not.toContainEqual([LANGY_TRACE_ORIGIN]);
      for (const call of calls.batched) {
        if (call === origin || call.table !== "trace_summaries") continue;
        expect(boundBy(call.compileFilter)).toContainEqual([LANGY_TRACE_ORIGIN]);
      }
      for (const call of calls.discrete) {
        expect(boundBy(call.compileFilter)).toContainEqual([LANGY_TRACE_ORIGIN]);
      }
      const model = calls.categorical.find((c) => c.facetKey === "model");
      expect(boundBy(model?.compileFilter)).toContainEqual([LANGY_TRACE_ORIGIN]);
    });

    it("counts facets on other tables as discover does when only the origin rule applies", async () => {
      const { calls } = await facetsFor({ query: "" });

      expect(calls.batched.find((c) => c.table === "stored_spans")?.compileFilter).toBeUndefined();
    });
  });

  describe("given no query", () => {
    /** @scenario "Facet counts are fetched in a single batched query" */
    it("reads every trace facet but origin in one batched scan", async () => {
      const { calls } = await facetsFor({ query: "" });

      const summaries = calls.batched.filter((c) => c.table === "trace_summaries");
      expect(summaries).toHaveLength(2);
      const batchedKeys = FACET_REGISTRY.filter(
        (def) =>
          def.table === "trace_summaries" &&
          def.key !== "origin" &&
          ((def.kind === "categorical" &&
            "expression" in def &&
            !def.expression.includes("arrayJoin")) ||
            def.kind === "range"),
      ).map((def) => def.key);
      const shared = summaries.find((c) => !c.categoricalKeys.includes("origin"));
      expect([...(shared?.categoricalKeys ?? []), ...(shared?.rangeKeys ?? [])]).toEqual(
        batchedKeys,
      );
    });
  });

  describe("given an aggregate whose facet lists a member's topic", () => {
    const AGGREGATE = "aggregate-1";
    const MEMBER = "member-1";
    /** Topic rows as Postgres holds them: the id is the primary key. */
    const TOPICS = [
      { id: "topic-own", projectId: AGGREGATE, name: "Own topic" },
      { id: "topic-member", projectId: MEMBER, name: "Member topic" },
      { id: "topic-outsider", projectId: "outsider-1", name: "Outsider topic" },
    ];

    it("names the member's topic and leaves a topic outside the proof unnamed", async () => {
      const asked: string[] = [];
      const { facets } = await facetsFor({
        query: "",
        authorization: aggregateProof({
          projectId: AGGREGATE,
          members: [{ projectId: MEMBER, from: 0 }],
        }),
        repositoryFor: () =>
          recordingRepository({
            batchedFacets: async ({ table }): Promise<BatchedFacetResult> => ({
              categoricals:
                table === "trace_summaries"
                  ? {
                      topic: {
                        values: TOPICS.map((topic) => ({ value: topic.id, count: 1 })),
                        totalDistinct: TOPICS.length,
                      },
                    }
                  : {},
              ranges: {},
            }),
          }),
        topicNames: {
          findNamesByIds: async ({ projectId, ids }) => {
            asked.push(projectId);
            return new Map(
              TOPICS.filter((t) => t.projectId === projectId && ids.includes(t.id)).map((t) => [
                t.id,
                t.name,
              ]),
            );
          },
        },
      });

      const topic = facets.find((facet) => facet.key === "topic");
      const labels =
        topic?.kind === "categorical"
          ? topic.topValues.map((value) => [value.value, value.label])
          : [];
      expect(labels).toEqual([
        ["topic-own", "Own topic"],
        ["topic-member", "Member topic"],
        ["topic-outsider", undefined],
      ]);
      expect(new Set(asked)).toEqual(new Set([AGGREGATE, MEMBER]));
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

  describe("given the same request arrives again while the first is still counting", () => {
    function sharedService() {
      const { repository, calls } = recordingRepository();
      const service = TraceListService.create({
        discoverUpdates: { publishProjectEvent: async () => {} },
        facets: CLICKHOUSE_FACET_CATALOG,
        repository,
        evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
        topicNames: { findNamesByIds: async () => new Map() },
      });
      const request = (filterKey: string) =>
        service.getFacets({
          authorization: ownProof({ projectId: TENANT }),
          timeRange,
          filterFor: () => undefined,
          filterKey,
        });
      return { request, calls };
    }

    /** @scenario "A repeated facet request shares the count still running" */
    it("answers both from one run", async () => {
      const once = sharedService();
      await once.request("status:error");
      const scansPerRun = once.calls.batched.length;

      const { request, calls } = sharedService();
      const [first, second] = await Promise.all([request("status:error"), request("status:error")]);

      expect(second).toBe(first);
      expect(calls.batched).toHaveLength(scansPerRun);
    });

    /** @scenario "A repeated facet request shares the count still running" */
    it("runs a different query on its own", async () => {
      const { request, calls } = sharedService();
      await Promise.all([request("status:error"), request("service:api")]);
      const twoRuns = calls.batched.length;

      const single = sharedService();
      await single.request("status:error");
      expect(twoRuns).toBe(2 * single.calls.batched.length);
    });

    /** @scenario "A repeated facet request shares the count still running" */
    it("counts afresh once the first run has answered", async () => {
      const { request, calls } = sharedService();
      await request("status:error");
      const scansPerRun = calls.batched.length;
      await request("status:error");

      expect(calls.batched).toHaveLength(2 * scansPerRun);
    });
  });
});
