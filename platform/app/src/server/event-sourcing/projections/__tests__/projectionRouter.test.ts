import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import {
  createMockAppendStore,
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockMapProjectionDefinition,
  createMockQueueManager,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { ProjectionRouter } from "../projectionRouter";
import { ReplayDeferralError } from "../replayMarkerCheck";

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
    describe("when fold projection has eventTypes filter (inline)", () => {
      it("skips events that do not match the fold's eventTypes", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("filtered-fold", {
          store,
          eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const matchingEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          TEST_CONSTANTS.EVENT_TYPE_1,
        );
        const nonMatchingEvent = createTestEvent(
          "other-agg",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          TEST_CONSTANTS.EVENT_TYPE_2,
        );

        await router.dispatch([matchingEvent, nonMatchingEvent], { tenantId });

        // store.get called once for the matching event, not for the non-matching one
        expect(store.get).toHaveBeenCalledTimes(1);
        expect(store.store).toHaveBeenCalledTimes(1);
      });
    });

    describe("when fold projection has eventTypes filter (queued)", () => {
      it("only sends matching events to the fold queue", async () => {
        const mockSendBatch = vi.fn().mockResolvedValue(undefined);
        const queueManager = createMockQueueManager();
        (
          queueManager.hasProjectionQueues as ReturnType<typeof vi.fn>
        ).mockReturnValue(true);
        (
          queueManager.getProjectionQueue as ReturnType<typeof vi.fn>
        ).mockReturnValue({
          sendBatch: mockSendBatch,
        });

        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        const fold = createMockFoldProjectionDefinition("filtered-fold", {
          store,
          eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const matchingEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          TEST_CONSTANTS.EVENT_TYPE_1,
        );
        const nonMatchingEvent = createTestEvent(
          "other-agg",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          TEST_CONSTANTS.EVENT_TYPE_2,
        );

        await router.dispatch([matchingEvent, nonMatchingEvent], { tenantId });

        expect(mockSendBatch).toHaveBeenCalledTimes(1);
        expect(mockSendBatch).toHaveBeenCalledWith([matchingEvent]);
      });

      it("skips fold queue entirely when no events match", async () => {
        const mockSendBatch = vi.fn().mockResolvedValue(undefined);
        const queueManager = createMockQueueManager();
        (
          queueManager.hasProjectionQueues as ReturnType<typeof vi.fn>
        ).mockReturnValue(true);
        (
          queueManager.getProjectionQueue as ReturnType<typeof vi.fn>
        ).mockReturnValue({
          sendBatch: mockSendBatch,
        });

        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        const fold = createMockFoldProjectionDefinition("filtered-fold", {
          store,
          eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const nonMatchingEvent = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          TEST_CONSTANTS.EVENT_TYPE_2,
        );

        await router.dispatch([nonMatchingEvent], { tenantId });

        expect(mockSendBatch).not.toHaveBeenCalled();
      });
    });

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

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

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

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

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

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

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

  describe("processFoldProjectionBatch (coalescing)", () => {
    function makeBatchEvent(id: string, occurredAt: number): Event {
      return createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        TEST_CONSTANTS.EVENT_TYPE_1,
        occurredAt,
        undefined,
        {},
        id,
      );
    }

    function batchFold(
      store: ReturnType<typeof createMockFoldProjectionStore>,
    ) {
      return createMockFoldProjectionDefinition("my-fold", {
        store,
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        init: () => ({ count: 0, LastEventOccurredAt: 0 }),
        apply: (s: any, e: any) => ({
          count: s.count + 1,
          LastEventOccurredAt: Math.max(
            s.LastEventOccurredAt,
            e.occurredAt ?? 0,
          ),
        }),
      });
    }

    describe("when several events for one aggregate are coalesced", () => {
      /** @scenario Batched fold projections use the tenant retention policy */
      it("stores the folded state with the tenant retention policy", async () => {
        const retentionPolicy = { traces: 30, scenarios: 60, experiments: 90 };
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          createMockQueueManager(),
          undefined,
          undefined,
          { resolve: vi.fn().mockResolvedValue(retentionPolicy) },
        );
        const store = createMockFoldProjectionStore();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const fold = batchFold(store);
        router.registerFoldProjection(fold);

        await (router as any).processFoldProjectionBatch(
          "my-fold",
          fold,
          [makeBatchEvent("e1", 1000), makeBatchEvent("e2", 2000)],
          { tenantId },
        );

        expect(store.store).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ retentionPolicy }),
        );
      });
    });
  });

  describe("replay marker on map projections", () => {
    describe("when marker returns 'skip'", () => {
      it("does not invoke map.append for that event", async () => {
        const queueManager = createMockQueueManager();
        const markerChecker = {
          check: vi.fn().mockResolvedValue("skip" as const),
        };
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
          undefined,
          markerChecker,
        );

        const store = createMockAppendStore<Record<string, unknown>>();
        const mapProj = createMockMapProjectionDefinition("skipped-map", {
          store,
          eventTypes: [],
        });
        router.registerMapProjection(mapProj);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await router.dispatch([event], { tenantId });

        expect(markerChecker.check).toHaveBeenCalledWith("skipped-map", event);
        expect(store.append).not.toHaveBeenCalled();
      });
    });

    describe("when marker returns 'process'", () => {
      it("proceeds with map.append", async () => {
        const queueManager = createMockQueueManager();
        const markerChecker = {
          check: vi.fn().mockResolvedValue("process" as const),
        };
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
          undefined,
          markerChecker,
        );

        const store = createMockAppendStore<Record<string, unknown>>();
        const mapProj = createMockMapProjectionDefinition("allowed-map", {
          store,
          eventTypes: [],
        });
        router.registerMapProjection(mapProj);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await router.dispatch([event], { tenantId });

        expect(markerChecker.check).toHaveBeenCalledWith("allowed-map", event);
        expect(store.append).toHaveBeenCalled();
      });
    });

    describe("when marker throws ReplayDeferralError", () => {
      it("surfaces the deferral inside the AggregateError so the queue retries the event", async () => {
        const queueManager = createMockQueueManager();
        const deferError = new ReplayDeferralError(
          "deferred-map",
          `${String(tenantId)}:${TEST_CONSTANTS.AGGREGATE_TYPE}:${TEST_CONSTANTS.AGGREGATE_ID}`,
          "replay pending",
        );
        const markerChecker = {
          check: vi.fn().mockRejectedValue(deferError),
        };
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
          undefined,
          markerChecker,
        );

        const store = createMockAppendStore<Record<string, unknown>>();
        const mapProj = createMockMapProjectionDefinition("deferred-map", {
          store,
          eventTypes: [],
        });
        router.registerMapProjection(mapProj);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        const rejection = await router.dispatch([event], { tenantId }).then(
          () => {
            throw new Error("expected dispatch to reject");
          },
          (error: unknown) => error,
        );

        expect(rejection).toBeInstanceOf(AggregateError);
        const aggregateError = rejection as AggregateError;
        expect(aggregateError.message).toContain(
          "1 projection(s) failed during dispatch",
        );
        expect(aggregateError.errors).toHaveLength(1);
        expect(aggregateError.errors[0]).toBeInstanceOf(ReplayDeferralError);
        expect(aggregateError.errors[0]).toBe(deferError);
        expect(markerChecker.check).toHaveBeenCalledWith("deferred-map", event);
        expect(store.append).not.toHaveBeenCalled();
      });
    });
  });
});
