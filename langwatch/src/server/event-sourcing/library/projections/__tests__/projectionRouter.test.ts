import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectionRouter } from "../projectionRouter";
import type { QueueManager } from "../../services/queues/queueManager";
import type { Event } from "../../domain/types";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockMapProjectionDefinition,
  createMockAppendStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";

function createMockQueueManager(): QueueManager<Event> {
  return {
    hasProjectionQueues: vi.fn().mockReturnValue(false),
    hasHandlerQueues: vi.fn().mockReturnValue(false),
    getProjectionQueue: vi.fn().mockReturnValue(undefined),
    getHandlerQueue: vi.fn().mockReturnValue(undefined),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
    initializeProjectionQueues: vi.fn(),
    initializeHandlerQueues: vi.fn(),
  } as unknown as QueueManager<Event>;
}

describe("ProjectionRouter", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("dispatch", () => {
    describe("when a fold projection fails inline", () => {
      it("attempts all projections and throws AggregateError", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const failingStore = createMockFoldProjectionStore<{ count: number }>();
        (failingStore.get as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("store failure"),
        );

        const successStore = createMockFoldProjectionStore<{ count: number }>();
        (successStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const failingFold = createMockFoldProjectionDefinition("failing", {
          store: failingStore,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        const successFold = createMockFoldProjectionDefinition("succeeding", {
          store: successStore,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(failingFold);
        router.registerFoldProjection(successFold);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(
          router.dispatch([event], { tenantId }),
        ).rejects.toThrow(AggregateError);

        // The succeeding projection should still have been attempted
        expect(successStore.get).toHaveBeenCalled();
        expect(successStore.store).toHaveBeenCalled();
      });
    });

    describe("when a map projection fails inline", () => {
      it("attempts all projections and throws AggregateError", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const failingStore = createMockAppendStore<Record<string, unknown>>();
        (failingStore.append as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("append failure"),
        );

        const successStore = createMockAppendStore<Record<string, unknown>>();

        const failingMap = createMockMapProjectionDefinition("failing", {
          store: failingStore,
          eventTypes: [],
        });

        const successMap = createMockMapProjectionDefinition("succeeding", {
          store: successStore,
          eventTypes: [],
        });

        router.registerMapProjection(failingMap);
        router.registerMapProjection(successMap);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(
          router.dispatch([event], { tenantId }),
        ).rejects.toThrow(AggregateError);

        // The succeeding projection should still have been attempted
        expect(successStore.append).toHaveBeenCalled();
      });
    });
  });
});
