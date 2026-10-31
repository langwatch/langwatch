/**
 * @vitest-environment node
 * A missed hand-off rebuilds its fold's aggregate as a job in the aggregate's
 * own lane. See specs/durable-handoff.feature.
 */
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import type { EventSourcedQueueProcessor } from "../../queues/index.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  parseTestEvent,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import { type JobRegistryEntry, QueueManager } from "../../services/queues/queueManager.ts";
import { FoldProjectionExecutor } from "../foldProjectionExecutor.ts";
import type { ProjectionStoreContext } from "../projectionStoreContext.ts";

interface Count {
  count: number;
  seen: string[];
  LastEventOccurredAt: number;
}

const tenantId = createTestTenantId();
const aggregateType = TEST_CONSTANTS.AGGREGATE_TYPE;
const aggregateId = TEST_CONSTANTS.AGGREGATE_ID;
const at = (createdAt: number) =>
  createTestEvent(aggregateId, aggregateType, tenantId, TEST_CONSTANTS.EVENT_TYPE_1, createdAt);
const context: ProjectionStoreContext = { aggregateId, tenantId };

/** A counting fold over a store that keeps one row and its applied-id set. */
function countingFold({ log }: { log: () => Event[] }) {
  let row: { state: Count; applied: string[] } | null = null;
  const store = createMockFoldProjectionStore<Count>();
  store.getWithApplied = async () =>
    row
      ? { state: row.state, appliedEventIds: row.applied }
      : { state: null, appliedEventIds: [], miss: "absent" };
  vi.mocked(store.store).mockImplementation(async (state, storeContext) => {
    row = { state, applied: [...(storeContext.appliedEventIds ?? [])] };
  });
  const fold = createMockFoldProjectionDefinition("counter", {
    store,
    init: (): Count => ({ count: 0, seen: [], LastEventOccurredAt: 0 }),
    apply: (state: Count, event: Event): Count => ({
      count: state.count + 1,
      seen: [...state.seen, event.id],
      LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
    }),
  });
  fold.eventLoader = async () => log();
  return { fold, current: () => row };
}

describe("rebuilding a fold's aggregate for a missed hand-off", () => {
  const executor = new FoldProjectionExecutor();

  describe("given a live event appended after the rebuild read the log", () => {
    /** @scenario "A live event arriving during the rebuild is not lost" */
    it("folds the live event on top when its job runs after the rebuild", async () => {
      const [first, missed, live] = [at(1_000), at(2_000), at(3_000)];
      const log = [first, missed];
      const { fold, current } = countingFold({ log: () => log });
      await executor.execute(fold, first, context);

      await executor.rebuild(fold, missed, context);
      log.push(live);
      await executor.execute(fold, live, context);

      expect(current()?.state.seen).toEqual([first.id, missed.id, live.id]);
    });
  });

  describe("given a live event the rebuild already read, still queued behind it", () => {
    /** @scenario "A live event arriving during the rebuild is not lost" */
    it("skips the live job, so the event is folded exactly once", async () => {
      const [first, missed, live] = [at(1_000), at(2_000), at(3_000)];
      const { fold, current } = countingFold({ log: () => [first, missed, live] });
      await executor.execute(fold, first, context);

      await executor.rebuild(fold, missed, context);
      await executor.execute(fold, live, context);

      expect(current()?.state.seen).toEqual([first.id, missed.id, live.id]);
    });
  });

  describe("given the missed event redelivers a key the fold already applied under another id", () => {
    const keyed = (createdAt: number, id: string) => ({
      ...at(createdAt),
      id,
      idempotencyKey: "span-key",
    });

    describe("when the first history read lags behind the log", () => {
      /** @scenario "A rebuild for a redelivered key folds the event log's copy, not the redelivery" */
      it("retries until the log returns its copy and folds that copy, not the redelivery", async () => {
        const original = keyed(1_000, "evt-original");
        const redelivery = keyed(2_000, "evt-redelivery");
        const reads = [[], [original]];
        let read = 0;
        const { fold, current } = countingFold({
          log: () => reads[Math.min(read++, reads.length - 1)]!,
        });
        const retrying = new FoldProjectionExecutor({ refoldHistoryRetryDelaysMs: [0] });
        await retrying.execute(fold, original, context);

        await retrying.rebuild(fold, redelivery, context);

        expect(read).toBeGreaterThan(1);
        expect(current()?.state.seen).toEqual([original.id]);
      });
    });

    describe("when the log never returns an event under the key", () => {
      /** @scenario "A rebuild for a redelivered key folds the event log's copy, not the redelivery" */
      it("refuses the incomplete history and leaves the job to retry", async () => {
        const original = keyed(1_000, "evt-original");
        const redelivery = keyed(2_000, "evt-redelivery");
        const { fold, current } = countingFold({ log: () => [] });
        const strict = new FoldProjectionExecutor({ refoldHistoryRetryDelaysMs: [] });
        await strict.execute(fold, original, context);

        await expect(strict.rebuild(fold, redelivery, context)).rejects.toThrow(
          "read an incomplete history; retrying",
        );
        expect(current()?.state.seen).toEqual([original.id]);
      });
    });
  });

  describe("given a fold that does not depend on event order and reads its history in pages", () => {
    /**
     * A paged reader that serves the log like the real store: (createdAt, id)
     * order, the strict `after` cursor, the `limit`, and the `upToEvent` bound.
     */
    function pagedReader({ log }: { log: () => Event[] }) {
      return vi.fn(
        async (ctx: {
          upToEvent: Event;
          after: { timestamp: number; eventId: string } | undefined;
          limit: number;
        }): Promise<Event[]> => {
          const ordered = log()
            .filter(
              (e) =>
                e.createdAt < ctx.upToEvent.createdAt ||
                (e.createdAt === ctx.upToEvent.createdAt && e.id <= ctx.upToEvent.id),
            )
            .toSorted((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
          const { after } = ctx;
          const start = after
            ? ordered.findIndex(
                (e) =>
                  e.createdAt > after.timestamp ||
                  (e.createdAt === after.timestamp && e.id > after.eventId),
              )
            : 0;
          return start === -1 ? [] : ordered.slice(start, start + ctx.limit);
        },
      );
    }

    function pagedCountingFold({ log }: { log: () => Event[] }) {
      const counting = countingFold({ log });
      const wholeHistory = vi.fn(async () => log());
      counting.fold.eventLoader = wholeHistory;
      const paged = pagedReader({ log });
      counting.fold.eventLoaderUpToPaged = paged;
      counting.fold.options = { ...counting.fold.options, refoldOnOutOfOrder: false };
      return { ...counting, wholeHistory, paged };
    }

    describe("when the aggregate's history spans many pages, with events after the missed one", () => {
      /** @scenario "A fold that does not depend on event order rebuilds a page at a time" */
      it("reads the history a page at a time and ends equal to a full replay", async () => {
        const log = Array.from({ length: 7 }, (_, i) => at(1_000 * (i + 1)));
        const missed = log[3]!;
        const { fold, current, wholeHistory, paged } = pagedCountingFold({ log: () => log });
        const pagesOfTwo = new FoldProjectionExecutor({ refoldPageSize: 2 });
        await pagesOfTwo.execute(fold, log[0]!, context);

        await pagesOfTwo.rebuild(fold, missed, context);

        expect(wholeHistory).not.toHaveBeenCalled();
        expect(paged.mock.calls.length).toBeGreaterThan(1);
        for (const [request] of paged.mock.calls) expect(request.limit).toBe(2);
        expect(current()?.state.seen).toEqual(log.map((e) => e.id));
      });

      /** @scenario "A live event arriving during the rebuild is not lost" */
      it("skips a queued live job the rebuild already read", async () => {
        const log = Array.from({ length: 5 }, (_, i) => at(1_000 * (i + 1)));
        const live = log[4]!;
        const { fold, current } = pagedCountingFold({ log: () => log });
        const pagesOfTwo = new FoldProjectionExecutor({ refoldPageSize: 2 });
        await pagesOfTwo.execute(fold, log[0]!, context);

        await pagesOfTwo.rebuild(fold, log[2]!, context);
        await pagesOfTwo.execute(fold, live, context);

        expect(current()?.state.seen).toEqual(log.map((e) => e.id));
      });
    });

    describe("when the fold already applied an event the log does not return yet", () => {
      /** @scenario "A paged rebuild refuses a history that lags behind what the fold applied" */
      it("refuses the incomplete history and leaves the job to retry", async () => {
        const [applied, missed] = [at(1_000), at(2_000)];
        const log: Event[] = [applied];
        const { fold, current } = pagedCountingFold({ log: () => log });
        const strict = new FoldProjectionExecutor({ refoldHistoryRetryDelaysMs: [] });
        await strict.execute(fold, applied, context);
        log.length = 0;

        await expect(strict.rebuild(fold, missed, context)).rejects.toThrow(
          "read an incomplete history; retrying",
        );
        expect(current()?.state.seen).toEqual([applied.id]);
      });
    });
  });

  describe("given the fold's queued lanes", () => {
    /** @scenario "The rebuild job runs in the aggregate's own ordered lane" */
    it("routes the rebuild job to the same group as the aggregate's live fold jobs", () => {
      const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      };
      const globalJobRegistry = new Map<string, JobRegistryEntry>();
      const manager = new QueueManager({
        parseEvent: parseTestEvent,
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue,
        globalJobRegistry,
      });
      manager.initializeProjectionQueues({
        projections: { counter: { name: "counter" } },
        onEvent: vi.fn(),
        onRebuild: vi.fn(),
      });
      const event = at(1_000);

      const live = globalJobRegistry.get("test-pipeline:projection:counter")?.route(event);
      const rebuild = globalJobRegistry
        .get("test-pipeline:projectionRebuild:counter")
        ?.route(event);

      expect(rebuild?.groupKey).toBe(`${tenantId}/fold/counter/${aggregateType}:${aggregateId}`);
      expect(rebuild?.groupKey).toBe(live?.groupKey);
    });
  });
});
