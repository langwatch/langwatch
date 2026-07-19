import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/metrics")>();
  return {
    ...actual,
    incrementEsFoldPostStoreFailure: vi.fn(),
    incrementEsFoldProjectionTotal: vi.fn(),
    observeEsFoldProjectionDuration: vi.fn(),
    incrementEsFoldRefoldTotal: vi.fn(),
    incrementEsReactorTotal: vi.fn(),
    incrementEsReactorCollapsedTotal: vi.fn(),
  };
});

import { incrementEsFoldPostStoreFailure } from "~/server/metrics";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { ProjectionRouter } from "../projectionRouter";

/**
 * A fold's state is written durably before its reactors are dispatched, so a
 * reactor failure fails the job without un-writing it and the queue redelivers
 * events the store already holds. Folds accumulate (trace summary does
 * `spanCount + 1` and sums cost), so the re-apply double-counts.
 *
 * These pin the signal that separates that failure from one thrown *before* the
 * write, which is harmless to retry and otherwise looks identical.
 */
describe("fold failures after the state was stored", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const events = (count: number): Event[] =>
    Array.from({ length: count }, (_, i) =>
      createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        undefined,
        1_000 + i,
        undefined,
        undefined,
        `event-${i}`,
      ),
    );

  /**
   * No reactor queues, so the router runs the reactor inline; a rejecting
   * handle is collected and rethrown as an AggregateError — the same shape a
   * Redis blip on queue send produces, since both funnel into the same errors[].
   */
  async function dispatchBatch({
    batch,
    reactorFails,
  }: {
    batch: Event[];
    reactorFails: boolean;
  }): Promise<unknown> {
    const queueManager = createMockQueueManager({ hasReactorQueues: false });
    const router = new ProjectionRouter<Event>(
      TEST_CONSTANTS.AGGREGATE_TYPE,
      TEST_CONSTANTS.PIPELINE_NAME,
      queueManager,
    );

    const store = createMockFoldProjectionStore<{ count: number }>();
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const fold = createMockFoldProjectionDefinition("counter", {
      store,
      init: () => ({ count: 0 }),
      apply: (state: { count: number }) => ({ count: state.count + 1 }),
    });

    const reactor: ReactorDefinition<Event> = {
      name: "flakyReactor",
      handle: reactorFails
        ? vi.fn().mockRejectedValue(new Error("reactor boom"))
        : vi.fn().mockResolvedValue(undefined),
    };

    router.registerFoldProjection(fold);
    router.registerReactor("counter", reactor);
    router.initializeFoldQueues();

    const initialize = queueManager.initializeProjectionQueues as ReturnType<
      typeof vi.fn
    >;
    const onEventBatch = initialize.mock.calls[0]?.[2] as (
      projectionName: string,
      events: Event[],
      context: unknown,
    ) => Promise<void>;

    return await onEventBatch("counter", batch, { tenantId }).catch(
      (error: unknown) => error,
    );
  }

  describe("when a reactor throws after the fold state was stored", () => {
    it("counts the failure as post-store, labelled by stage", async () => {
      await dispatchBatch({ batch: events(3), reactorFails: true });

      expect(incrementEsFoldPostStoreFailure).toHaveBeenCalledWith(
        "counter",
        "reactor_dispatch",
      );
    });

    it("rethrows so the queue still retries the job", async () => {
      const error = await dispatchBatch({
        batch: events(3),
        reactorFails: true,
      });

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("when every reactor succeeds", () => {
    it("counts nothing, because no state was left behind a failed job", async () => {
      await dispatchBatch({ batch: events(3), reactorFails: false });

      expect(incrementEsFoldPostStoreFailure).not.toHaveBeenCalled();
    });
  });
});
