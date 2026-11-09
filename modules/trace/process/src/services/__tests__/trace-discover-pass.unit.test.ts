/**
 * A facet discovery pass is bounded: one per tenant window in a process, a few
 * statements at a time, and abandoned at its deadline with its reads stopped.
 * @see specs/traces-v2/search.feature
 */
import type { Authorization } from "@langwatch/authorization";
import type { PresenceProjectEvent } from "@langwatch/presence-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceListRead } from "@langwatch/trace-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** A minute boundary, so a one-hour window snaps to itself. */
const T = 1_700_000_040_000 - (1_700_000_040_000 % MINUTE);

interface HeldRead {
  method: string;
  statements: number;
  /** The window the pass read; one object per pass, so it tells passes apart. */
  window: unknown;
  answer: () => void;
}

/**
 * The list repository as the pass sees it: every read is held until the test
 * answers it, and an abort rejects it the way the driver does.
 */
function heldRepository({
  answerAfterMs,
}: {
  /** Each read answers by itself after this long, as a slow statement would. */
  answerAfterMs?: number;
} = {}) {
  const reads: HeldRead[] = [];
  let running = 0;
  let mostRunning = 0;
  let answerAtOnce = false;

  function hold<T>({
    method,
    statements,
    window,
    signal,
    value,
  }: {
    method: string;
    statements: number;
    window: unknown;
    signal: AbortSignal | undefined;
    value: T;
  }): Promise<T> {
    if (answerAtOnce) {
      reads.push({ method, statements, window, answer: () => {} });
      return Promise.resolve(value);
    }
    return new Promise<T>((resolve, reject) => {
      let open = true;
      const close = () => {
        if (!open) return false;
        open = false;
        running -= statements;
        return true;
      };
      running += statements;
      mostRunning = Math.max(mostRunning, running);
      signal?.addEventListener("abort", () => close() && reject(signal.reason), { once: true });
      const answer = () => close() && resolve(value);
      reads.push({ method, statements, window, answer });
      if (answerAfterMs !== undefined) setTimeout(answer, answerAfterMs);
    });
  }

  const repository = createApiFixture<TraceListRead>({
    findBatchedFacets: async (params) =>
      hold({
        method: "batch",
        statements:
          Number(params.categoricalSpecs.length > 0) + Number(params.rangeSpecs.length > 0),
        window: params.timeRange,
        signal: params.signal,
        value: { categoricals: {}, ranges: {} },
      }),
    findCategoricalFacet: async (params) =>
      hold({
        method: "categorical",
        statements: 1,
        window: params.timeRange,
        signal: params.signal,
        value: { values: [], totalDistinct: 0 },
      }),
    findCategoricalFacetRaw: async (params) =>
      hold({
        method: "raw",
        statements: 1,
        window: undefined,
        signal: params.signal,
        value: { values: [], totalDistinct: 0 },
      }),
    findRangeStatsForTable: async (params) =>
      hold({
        method: "range",
        statements: 1,
        window: params.timeRange,
        signal: params.signal,
        value: { min: 0, max: 0 },
      }),
    findDiscreteValues: async (params) =>
      hold({
        method: "discrete",
        statements: 1,
        window: params.timeRange,
        signal: params.signal,
        value: { values: [], distinctCount: 0 },
      }),
  });

  return {
    repository,
    reads,
    mostRunning: () => mostRunning,
    /** Every pass that read, told apart by the window object each pass hands its reads. */
    passes: () =>
      new Set(reads.filter((read) => read.window !== undefined).map((read) => read.window)).size,
    answerEverythingAtOnce: () => {
      answerAtOnce = true;
    },
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
  { published = [] }: { published?: PresenceProjectEvent[] } = {},
) {
  return TraceListService.create({
    repository,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: async () => new Map() },
    facets: CLICKHOUSE_FACET_CATALOG,
    discoverUpdates: {
      publishProjectEvent: async (event) => {
        published.push(event);
      },
    },
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

  describe("when a pass reads the whole facet registry", () => {
    /** @scenario "A facet discovery pass holds a few statements at a time" */
    it("holds at most four statements at once and still reads every facet", async () => {
      const unbounded = heldRepository();
      unbounded.answerEverythingAtOnce();
      await countsFor({
        service: listService(unbounded.repository),
        authorization: ownProof({ projectId: "tenant-pass-cap-reference" }),
        timeRange: { from: T - HOUR, to: T },
      });

      const held = heldRepository();
      const counting = countsFor({
        service: listService(held.repository),
        authorization: ownProof({ projectId: "tenant-pass-cap" }),
        timeRange: { from: T - HOUR, to: T },
      });
      await settle();
      await held.drain();
      await counting;

      expect(held.mostRunning()).toBeLessThanOrEqual(4);
      expect(held.mostRunning()).toBeGreaterThan(1);
      expect(held.reads.map((read) => read.method).toSorted()).toEqual(
        unbounded.reads.map((read) => read.method).toSorted(),
      );
    });
  });

  describe("when every statement of a pass is slow but within its cap", () => {
    /** @scenario "A facet discovery pass gives every read its turn" */
    it("runs every task to its answer, the last ones included", async () => {
      const window = { from: T - HOUR, to: T };
      const reference = heldRepository();
      reference.answerEverythingAtOnce();
      const referenceService = listService(reference.repository);
      const referenceProof = ownProof({ projectId: "tenant-slow-reference" });
      await referenceService.getDiscover({ authorization: referenceProof, timeRange: window });
      await vi.waitFor(async () =>
        expect(
          (await referenceService.getDiscover({ authorization: referenceProof, timeRange: window }))
            .pending,
        ).toBe(false),
      );
      const expected = await referenceService.getDiscover({
        authorization: referenceProof,
        timeRange: window,
      });

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const published: PresenceProjectEvent[] = [];
      const held = heldRepository({ answerAfterMs: 19_000 });
      const service = listService(held.repository, { published });
      const authorization = ownProof({ projectId: "tenant-slow-statements" });
      await service.getDiscover({ authorization, timeRange: window });
      for (let turn = 0; turn < 40 && published.length === 0; turn++) {
        await settle();
        await vi.advanceTimersByTimeAsync(19_000);
      }

      expect(published).toHaveLength(1);
      expect(held.reads.map((read) => read.method).toSorted()).toEqual(
        reference.reads.map((read) => read.method).toSorted(),
      );
      expect(await service.getDiscover({ authorization, timeRange: window })).toEqual(expected);
      expect(held.passes()).toBe(1);
    });
  });

  describe("given the facet counts for a live window are still running", () => {
    /** @scenario "A live repeat shares the count still running though its window rolled" */
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

    /** @scenario "A live repeat shares the count still running though its window rolled" */
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

    /** @scenario "A live repeat shares the count still running though its window rolled" */
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
