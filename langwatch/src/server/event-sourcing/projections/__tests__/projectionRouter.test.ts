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

    describe("when fold projection fails but map projections exist", () => {
      it("still dispatches to map projections", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const failingStore = createMockFoldProjectionStore<{ count: number }>();
        (failingStore.get as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("fold store failure"),
        );

        const failingFold = createMockFoldProjectionDefinition("failing-fold", {
          store: failingStore,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        const mapStore = createMockAppendStore<Record<string, unknown>>();
        const successMap = createMockMapProjectionDefinition("success-map", {
          store: mapStore,
          eventTypes: [],
        });

        router.registerFoldProjection(failingFold);
        router.registerMapProjection(successMap);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(
          router.dispatch([event], { tenantId }),
        ).rejects.toThrow(AggregateError);

        // Map projection should still have been dispatched
        expect(mapStore.append).toHaveBeenCalled();
      });
    });

    describe("when both fold and map projections fail", () => {
      it("throws single AggregateError with all errors", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const foldStore = createMockFoldProjectionStore<{ count: number }>();
        (foldStore.get as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("fold failure"),
        );

        const failingFold = createMockFoldProjectionDefinition("failing-fold", {
          store: foldStore,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        const mapStore = createMockAppendStore<Record<string, unknown>>();
        (mapStore.append as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("map failure"),
        );

        const failingMap = createMockMapProjectionDefinition("failing-map", {
          store: mapStore,
          eventTypes: [],
        });

        router.registerFoldProjection(failingFold);
        router.registerMapProjection(failingMap);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        try {
          await router.dispatch([event], { tenantId });
          expect.unreachable("should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(AggregateError);
          const aggErr = e as AggregateError;
          // Should contain errors from both fold and map
          expect(aggErr.errors.length).toBeGreaterThanOrEqual(2);
        }
      });
    });

    describe("when a map projection fails inline (only map registered)", () => {
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

  describe("getProjectionByName", () => {
    describe("when a custom key is provided", () => {
      it("calls store.get with the custom key", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

        const fold = createMockFoldProjectionDefinition("myProjection", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const customKey = "tenant-1:2025-01-01";
        await router.getProjectionByName(
          "myProjection",
          TEST_CONSTANTS.AGGREGATE_ID,
          { tenantId },
          { key: customKey },
        );

        expect(store.get).toHaveBeenCalledWith(
          customKey,
          expect.objectContaining({
            aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
            tenantId,
          }),
        );
      });
    });

    describe("when no custom key is provided", () => {
      it("calls store.get with aggregateId", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

        const fold = createMockFoldProjectionDefinition("myProjection", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        await router.getProjectionByName(
          "myProjection",
          TEST_CONSTANTS.AGGREGATE_ID,
          { tenantId },
        );

        expect(store.get).toHaveBeenCalledWith(
          TEST_CONSTANTS.AGGREGATE_ID,
          expect.objectContaining({
            aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
            tenantId,
          }),
        );
      });
    });
  });
});
