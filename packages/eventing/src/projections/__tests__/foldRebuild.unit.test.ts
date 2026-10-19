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
