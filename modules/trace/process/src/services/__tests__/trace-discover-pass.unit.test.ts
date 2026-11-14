/**
 * A facet discovery pass is bounded: one per tenant window in a process, and none
 * again for a short cooldown after one failed.
 * @see specs/traces-v2/search.feature
 */
import type { Authorization } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { BatchedFacetResult, TraceListRead } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** A minute boundary, so a one-hour window snaps to itself. */
const T = 1_700_000_040_000 - (1_700_000_040_000 % MINUTE);

/** The list repository as the pass sees it: each read is held until the test answers it. */
function heldRepository({
  answerAtOnce = false,
  batch = { categoricals: {}, ranges: {} },
}: { answerAtOnce?: boolean; batch?: BatchedFacetResult } = {}) {
  /** Each read's window: one object per pass, so it tells passes apart. */
  const reads: { window: unknown; answer: () => void }[] = [];
  const hold = <V>(window: unknown, value: V): Promise<V> =>
    new Promise<V>((resolve) => {
      reads.push({ window, answer: () => resolve(value) });
      if (answerAtOnce) resolve(value);
    });
  const empty = { values: [], totalDistinct: 0 };

  return {
    repository: createApiFixture<TraceListRead>({
      findBatchedFacets: async (params) => hold(params.timeRange, batch),
      findCategoricalFacet: async (params) => hold(params.timeRange, empty),
      findCategoricalFacetRaw: async () => hold(undefined, empty),
      findRangeStatsForTable: async (params) => hold(params.timeRange, { min: 0, max: 0 }),
      findDiscreteValues: async (params) =>
        hold(params.timeRange, { values: [], distinctCount: 0 }),
    }),
    passes: () =>
      new Set(reads.filter((read) => read.window !== undefined).map((read) => read.window)).size,
    /** Answers held reads, oldest first, until the pass has nothing left to start. */
    async drain() {
      for (let answered = 0; answered < reads.length; answered++) {
        reads[answered]!.answer();
        await settle();
      }
    },
  };
}

/** Lets the pass's promise chains move on. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function listService(
  repository: TraceListRead,
  {
    findNamesByIds = async () => new Map(),
  }: { findNamesByIds?: () => Promise<Map<string, string>> } = {},
) {
  return TraceListService.create({
    repository,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds },
    facets: CLICKHOUSE_FACET_CATALOG,
    discoverUpdates: { publishProjectEvent: async () => {} },
  });
}

function countsFor({
  service,
  authorization,
  timeRange,
}: {
  service: TraceListService;
  authorization: Authorization;
  timeRange: { from: number; to: number; live?: boolean };
}) {
  return service.getFacets({ authorization, timeRange, filterFor: () => undefined, filterKey: "" });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the facet discovery pass", () => {
  describe("given a discover pass for a tenant's window is still reading", () => {
    /** @scenario "One facet discovery pass runs per tenant window at a time" */
    it("starts no second pass for more viewers or for the live window's next bucket", async () => {
      const held = heldRepository();
      const service = listService(held.repository);
      const authorization = ownProof({ projectId: "tenant-discover-single-flight" });
      const window = { from: T - HOUR, to: T };
      const rolled = { from: T - HOUR + MINUTE, to: T + MINUTE };

      await service.getDiscover({ authorization, timeRange: window });
      await service.getDiscover({ authorization, timeRange: window });
      await settle();
      await service.getDiscover({ authorization, timeRange: rolled });
      await settle();

      expect(held.passes()).toBe(1);

      await held.drain();
      expect(held.passes()).toBe(1);

      await service.getDiscover({ authorization, timeRange: rolled });
      await settle();

      expect(held.passes()).toBe(2);
      await held.drain();
    });

    /** @scenario "One facet discovery pass runs per tenant window at a time" */
    it("still runs a pass of its own for a window of another span", async () => {
      const held = heldRepository();
      const service = listService(held.repository);
      const authorization = ownProof({ projectId: "tenant-discover-other-span" });

      await service.getDiscover({ authorization, timeRange: { from: T - HOUR, to: T } });
      await service.getDiscover({ authorization, timeRange: { from: T - 24 * HOUR, to: T } });
      await settle();

      expect(held.passes()).toBe(2);
      await held.drain();
    });
  });

  describe("given a discover pass for a tenant's window threw", () => {
    /** @scenario "One facet discovery pass runs per tenant window at a time" */
    it("starts no pass for that window again until the cooldown passes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T);
      let namesAsked = 0;
      const held = heldRepository({
        answerAtOnce: true,
        batch: {
          categoricals: { topic: { values: [{ value: "topic-1", count: 1 }], totalDistinct: 1 } },
          ranges: {},
        },
      });
      const service = listService(held.repository, {
        findNamesByIds: async () => {
          namesAsked += 1;
          throw new Error("topic names unavailable");
        },
      });
      const authorization = ownProof({ projectId: "tenant-discover-cooldown" });
      const window = { from: T - HOUR, to: T };

      await service.getDiscover({ authorization, timeRange: window });
      await vi.waitFor(() => expect(namesAsked).toBeGreaterThan(0));
      await settle();

      vi.setSystemTime(T + 20_000);
      expect((await service.getDiscover({ authorization, timeRange: window })).pending).toBe(true);
      await settle();
      expect(held.passes()).toBe(1);

      vi.setSystemTime(T + 31_000);
      await service.getDiscover({ authorization, timeRange: window });
      await settle();
      expect(held.passes()).toBe(2);
    });
  });

  describe("given the facet counts for a live window are still running", () => {
    /** @scenario "A live repeat in the same minute shares the count still running" */
    it("answers a repeat whose bounds rolled forward with the running count", async () => {
      const held = heldRepository();
      const service = listService(held.repository);
      const authorization = ownProof({ projectId: "tenant-live-repeat" });

      const first = countsFor({
        service,
        authorization,
        timeRange: { from: T - HOUR, to: T, live: true },
      });
      const repeat = countsFor({
        service,
        authorization,
        timeRange: { from: T - HOUR + 20_000, to: T + 20_000, live: true },
      });
      await settle();

      expect(held.passes()).toBe(1);
      await held.drain();
      expect(await repeat).toBe(await first);
    });

    /** @scenario "A live repeat in the same minute shares the count still running" */
    it("runs its own count for a live window whose end moved to another minute", async () => {
      const held = heldRepository();
      const service = listService(held.repository);
      const authorization = ownProof({ projectId: "tenant-live-next-minute" });

      const first = countsFor({
        service,
        authorization,
        timeRange: { from: T - HOUR, to: T, live: true },
      });
      const later = countsFor({
        service,
        authorization,
        timeRange: { from: T - HOUR + MINUTE, to: T + MINUTE, live: true },
      });
      await settle();

      expect(held.passes()).toBe(2);
      await held.drain();
      await Promise.all([first, later]);
    });

    /** @scenario "A live repeat in the same minute shares the count still running" */
    it("runs its own count for a fixed window that differs", async () => {
      const held = heldRepository();
      const service = listService(held.repository);
      const authorization = ownProof({ projectId: "tenant-fixed-window" });

      const first = countsFor({ service, authorization, timeRange: { from: T - HOUR, to: T } });
      const other = countsFor({
        service,
        authorization,
        timeRange: { from: T - HOUR + 20_000, to: T + 20_000 },
      });
      await settle();

      expect(held.passes()).toBe(2);
      await held.drain();
      await Promise.all([first, other]);
    });
  });
});
