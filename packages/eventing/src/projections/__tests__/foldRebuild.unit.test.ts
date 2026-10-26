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
import { FoldRebuildIncompleteHistoryError } from "../../services/errorHandling.ts";
import { type JobRegistryEntry, QueueManager } from "../../services/queues/queueManager.ts";
import { MAX_APPLIED_EVENT_IDS } from "../foldCache/foldCacheEntry.ts";
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

        await expect(strict.rebuild(fold, redelivery, context)).rejects.toBeInstanceOf(
          FoldRebuildIncompleteHistoryError,
        );
        expect(current()?.state.seen).toEqual([original.id]);
      });
    });
  });

  describe("given an order-insensitive fold with a paged history loader", () => {
    /** The counting fold, rebuilt only through `eventLoaderPaged`, which records each page read. */
    function pagedCountingFold({ log }: { log: () => Event[] }) {
      const built = countingFold({ log });
      built.fold.options = { ...built.fold.options, refoldOnOutOfOrder: false };
      built.fold.eventLoader = async () => {
        throw new Error("the whole history must not be read in one call");
      };
      const pages: { after: string | undefined; limit: number }[] = [];
      built.fold.eventLoaderPaged = async ({ after, limit }) => {
        pages.push({ after: after?.eventId, limit });
        const ordered = log().toSorted(
          (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
        );
        const start = after
          ? ordered.findIndex(
              (e) =>
                e.createdAt > after.timestamp ||
                (e.createdAt === after.timestamp && e.id > after.eventId),
            )
          : 0;
        return start < 0 ? [] : ordered.slice(start, start + limit);
      };
      return { ...built, pages };
    }

    describe("when its log is longer than one page", () => {
      /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
      it("reads the history a page at a time and ends equal to a full replay", async () => {
        const events = [at(1_000), at(2_000), at(3_000), at(4_000), at(5_000)];
        const [first, , missed] = events;
        const { fold, current, pages } = pagedCountingFold({ log: () => events });
        const paging = new FoldProjectionExecutor({ refoldPageSize: 2 });
        await paging.execute(fold, first!, context);

        await paging.rebuild(fold, missed!, context);

        expect(pages).toEqual([
          { after: undefined, limit: 2 },
          { after: events[1]!.id, limit: 2 },
          { after: events[3]!.id, limit: 2 },
        ]);
        expect(current()?.state.count).toBe(events.length);
        expect((current()?.state.seen ?? []).toSorted()).toEqual(
          events.map((e) => e.id).toSorted(),
        );
      });

      /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
      it("folds once an event the log returns on two pages", async () => {
        const events = [at(1_000), at(2_000), at(3_000)];
        const [first, missed] = events;
        const built = pagedCountingFold({ log: () => events });
        const loader = built.fold.eventLoaderPaged!;
        // A read that repeats the previous page's last row, as a lagging cursor would.
        built.fold.eventLoaderPaged = async (ctx) => {
          const page = await loader(ctx);
          return ctx.after ? [events.find((e) => e.id === ctx.after!.eventId)!, ...page] : page;
        };
        const paging = new FoldProjectionExecutor({ refoldPageSize: 2 });
        await paging.execute(built.fold, first!, context);

        await paging.rebuild(built.fold, missed!, context);

        expect(built.current()?.state.count).toBe(events.length);
      });
    });

    describe("when its log holds more events than the stored applied ids keep", () => {
      /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
      it("folds every event and stores the trailing applied ids", async () => {
        const events = Array.from({ length: 2 * MAX_APPLIED_EVENT_IDS + 5 }, (_, i) => at(i + 1));
        const [first, missed] = events;
        const { fold, current } = pagedCountingFold({ log: () => events });
        const paging = new FoldProjectionExecutor({ refoldPageSize: 500 });
        await paging.execute(fold, first!, context);

        await paging.rebuild(fold, missed!, context);

        expect(current()?.state.count).toBe(events.length);
        expect(current()?.applied).toEqual(
          events.slice(-MAX_APPLIED_EVENT_IDS).map((event) => event.id),
        );
      });
    });

    describe("when the log does not hold the missed event but accounts for everything stored", () => {
      /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
      it("folds the missed event once on top of the paged history", async () => {
        const [first, missed, later] = [at(1_000), at(2_000), at(3_000)];
        const { fold, current } = pagedCountingFold({ log: () => [first, later] });
        const paging = new FoldProjectionExecutor({ refoldPageSize: 2 });
        await paging.execute(fold, first, context);

        await paging.rebuild(fold, missed, context);

        expect(current()?.state.count).toBe(3);
        expect(current()?.state.seen.filter((id) => id === missed.id)).toHaveLength(1);
        expect(current()?.applied).toEqual(expect.arrayContaining([first.id, later.id, missed.id]));
      });
    });

    describe("when its stored state applied an event the paged read does not return yet", () => {
      /** @scenario A paged rebuild that reads an incomplete history retries and then refuses */
      it("retries the paged read, then refuses the incomplete history", async () => {
        const [first, missed] = [at(1_000), at(2_000)];
        const { fold, current, pages } = pagedCountingFold({ log: () => [missed] });
        const retrying = new FoldProjectionExecutor({ refoldHistoryRetryDelaysMs: [0] });
        await retrying.execute(fold, first, context);

        await expect(retrying.rebuild(fold, missed, context)).rejects.toBeInstanceOf(
          FoldRebuildIncompleteHistoryError,
        );
        expect(pages.filter((page) => page.after === undefined)).toHaveLength(2);
        expect(current()?.state.seen).toEqual([first.id]);
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
