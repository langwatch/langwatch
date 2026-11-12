/**
 * `GET /api/traces/facets` without `field` on the real `TraceModule` and list
 * service: the sidebar defers span type, but the public payload still carries
 * its top values, counted by a keyed read over the same window.
 * @see specs/traces/trace-filter-api.feature
 */
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { BatchedFacetResult, TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

type BatchCall = Parameters<TraceListRead["findBatchedFacets"]>[0];

function harness({
  projectId,
  spanTypeFails = false,
}: {
  projectId: string;
  spanTypeFails?: boolean;
}) {
  const batched: BatchCall[] = [];
  let refreshed = false;
  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: vi.fn(async (params: BatchCall): Promise<BatchedFacetResult> => {
      batched.push(params);
      const asksSpanType = params.categoricalSpecs.some((spec) => spec.key === "spanType");
      if (asksSpanType && spanTypeFails) throw new Error("TIMEOUT_EXCEEDED");
      return {
        categoricals: asksSpanType
          ? { spanType: { values: [{ value: "llm", count: 4 }], totalDistinct: 1 } }
          : {},
        ranges: {},
      };
    }),
    findCategoricalFacet: vi.fn(async () => ({ values: [], totalDistinct: 0 })),
    findCategoricalFacetRaw: vi.fn(async () => ({ values: [], totalDistinct: 0 })),
    findRangeStatsForTable: vi.fn(async () => ({ min: 0, max: 0 })),
    findDiscreteValues: vi.fn(async () => ({ values: [], distinctCount: 0 })),
  });
  const list = TraceListService.create({
    discoverUpdates: {
      publishProjectEvent: async () => {
        refreshed = true;
      },
    },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: async () => new Map() },
  });
  const findById = vi.fn<ProjectApi["findById"]>(
    async () => ({ id: projectId, isPersonal: false }) as Project,
  );
  const app = createTraceAppHarness({
    projects: createApiFixture<ProjectApi>({ findById }, "projects"),
    traces: { list },
  });
  const read = () =>
    app.readTraceFacetsForApiKey({
      projectId,
      query: { limit: 50, offset: 0 },
      principal: null,
      authorization: ownProof({ projectId }),
    });

  // The first read warms the discovery cache; the second is served from it.
  const readWarm = async () => {
    await read();
    await vi.waitFor(() => expect(refreshed).toBe(true));
    return read();
  };
  return { read, readWarm, batched };
}

function keysOf(call: BatchCall): string[] {
  return call.categoricalSpecs.map((spec) => spec.key);
}

function spanTypeOf(answer: unknown) {
  const { facets } = answer as { facets: { key: string }[] };
  return facets.find((facet) => facet.key === "spanType");
}

describe("TraceModule REST facet discovery", () => {
  describe("given span type is deferred in the sidebar", () => {
    /** @scenario "The REST facet listing still counts span type" */
    it("answers span type with its top values", async () => {
      const { readWarm, batched } = harness({ projectId: "project-rest-deferred" });

      const spanType = spanTypeOf(await readWarm());

      expect(spanType).toMatchObject({ topValues: [{ value: "llm", count: 4 }] });
      expect(spanType).not.toHaveProperty("deferred");
      const keyed = batched.filter((call) =>
        call.categoricalSpecs.some((spec) => spec.key === "spanType"),
      );
      expect(keyed.length).toBeGreaterThan(0);
      for (const call of keyed)
        expect(call.categoricalSpecs.map((spec) => spec.key)).toEqual(["spanType"]);
    });
  });

  describe("given the listing is read again within the minute", () => {
    /** @scenario "The REST facet listing still counts span type" */
    it("serves span type from the cache instead of counting it again", async () => {
      const { read, readWarm, batched } = harness({ projectId: "project-rest-deferred-repeat" });
      await readWarm();
      const countsSoFar = batched.filter((call) => keysOf(call).includes("spanType")).length;

      const spanType = spanTypeOf(await read());

      expect(spanType).toMatchObject({ topValues: [{ value: "llm", count: 4 }] });
      expect(batched.filter((call) => keysOf(call).includes("spanType"))).toHaveLength(countsSoFar);
    });
  });

  describe("given the span type count fails", () => {
    /** @scenario "The REST facet listing still counts span type" */
    it("keeps span type listed without values", async () => {
      const { readWarm } = harness({
        projectId: "project-rest-deferred-fails",
        spanTypeFails: true,
      });

      expect(spanTypeOf(await readWarm())).toMatchObject({ topValues: [], deferred: true });
    });
  });
});
