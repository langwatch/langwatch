import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incrementEsReactorTotal } from "../../metrics";
import { ProjectionRouter } from "../projectionRouter";

vi.mock("../../metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../metrics")>();
  return {
    ...actual,
    incrementEsReactorTotal: vi.fn(),
  };
});

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
import type { SubscriberDispatchDefinition } from "../../subscribers/subscriber.types";
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
        (queueManager.hasProjectionQueues as ReturnType<typeof vi.fn>).mockReturnValue(
          true,
        );
        (queueManager.getProjectionQueue as ReturnType<typeof vi.fn>).mockReturnValue({
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
        (queueManager.hasProjectionQueues as ReturnType<typeof vi.fn>).mockReturnValue(
          true,
        );
        (queueManager.getProjectionQueue as ReturnType<typeof vi.fn>).mockReturnValue({
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

    describe("when a fold projection throws", () => {
      /** @scenario A projection failure prevents the side effect */
      it("does not dispatch to subscribers registered on that fold", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const failingStore = createMockFoldProjectionStore<{ count: number }>();
        (failingStore.get as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("fold exploded"),
        );

        const fold = createMockFoldProjectionDefinition("exploding-fold", {
          store: failingStore,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const subscriberHandle = vi.fn().mockResolvedValue(undefined);
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "should-not-fire",
          handle: subscriberHandle,
        };
        router.registerSubscriber("exploding-fold", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

        expect(subscriberHandle).not.toHaveBeenCalled();
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

    describe("when a subscriber fails inline", () => {
      it("throws AggregateError", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("my-fold", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const subscriberHandle = vi.fn().mockRejectedValue(new Error("subscriber boom"));
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "failing-subscriber",
          handle: subscriberHandle,
        };
        router.registerSubscriber("my-fold", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

        expect(subscriberHandle).toHaveBeenCalled();
      });
    });

    describe("when a subscriber declares a shouldDispatch predicate", () => {
      const setupRouterWithFold = (
        queueManager: ReturnType<typeof createMockQueueManager>,
      ) => {
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("my-fold", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);
        return router;
      };

      describe("when the predicate returns false", () => {
        /** @scenario An irrelevant event is rejected before any job is queued */
        it("does not enqueue a job for that subscriber", async () => {
          const mockSend = vi.fn().mockResolvedValue(undefined);
          const queueManager = createMockQueueManager({
            hasProjectionSubscriberQueues: true,
            getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send: mockSend }),
          });
          const router = setupRouterWithFold(queueManager);

          const subscriberHandle = vi.fn().mockResolvedValue(undefined);
          const subscriber: SubscriberDispatchDefinition<Event> = {
            name: "filtered-subscriber",
            shouldDispatch: () => false,
            handle: subscriberHandle,
          };
          router.registerSubscriber("my-fold", subscriber);

          const event = createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          );

          await router.dispatch([event], { tenantId });

          expect(mockSend).not.toHaveBeenCalled();
          expect(subscriberHandle).not.toHaveBeenCalled();
          expect(incrementEsReactorTotal).toHaveBeenCalledWith(
            TEST_CONSTANTS.PIPELINE_NAME,
            "filtered-subscriber",
            "skipped",
          );
        });

        it("skips inline execution too", async () => {
          const queueManager = createMockQueueManager();
          const router = setupRouterWithFold(queueManager);

          const subscriberHandle = vi.fn().mockResolvedValue(undefined);
          const subscriber: SubscriberDispatchDefinition<Event> = {
            name: "filtered-inline-subscriber",
            shouldDispatch: () => false,
            handle: subscriberHandle,
          };
          router.registerSubscriber("my-fold", subscriber);

          const event = createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          );

          await router.dispatch([event], { tenantId });

          expect(subscriberHandle).not.toHaveBeenCalled();
        });
      });

      describe("when the predicate returns true", () => {
        /** @scenario A subscriber fires only after its projection commits */
        it("enqueues the job with the event and fold state", async () => {
          const mockSend = vi.fn().mockResolvedValue(undefined);
          const queueManager = createMockQueueManager({
            hasProjectionSubscriberQueues: true,
            getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send: mockSend }),
          });
          const router = setupRouterWithFold(queueManager);

          const shouldDispatch = vi.fn().mockReturnValue(true);
          const subscriber: SubscriberDispatchDefinition<Event> = {
            name: "passing-subscriber",
            shouldDispatch,
            handle: vi.fn(),
          };
          router.registerSubscriber("my-fold", subscriber);

          const event = createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          );

          await router.dispatch([event], { tenantId });

          expect(shouldDispatch).toHaveBeenCalledWith(
            event,
            expect.objectContaining({
              tenantId,
              aggregateId: String(event.aggregateId),
              foldState: { count: 1 },
            }),
          );
          expect(mockSend).toHaveBeenCalledWith({
            event,
            foldState: { count: 1 },
          });
        });
      });

      describe("when the predicate throws", () => {
        /** @scenario A failing relevance guard never drops a side effect */
        it("fails open and enqueues the job anyway", async () => {
          const mockSend = vi.fn().mockResolvedValue(undefined);
          const queueManager = createMockQueueManager({
            hasProjectionSubscriberQueues: true,
            getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send: mockSend }),
          });
          const router = setupRouterWithFold(queueManager);

          const subscriber: SubscriberDispatchDefinition<Event> = {
            name: "throwing-predicate-subscriber",
            shouldDispatch: () => {
              throw new Error("predicate boom");
            },
            handle: vi.fn(),
          };
          router.registerSubscriber("my-fold", subscriber);

          const event = createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          );

          await router.dispatch([event], { tenantId });

          expect(mockSend).toHaveBeenCalled();
        });
      });
    });

    describe("when a subscriber queue send fails", () => {
      it("throws AggregateError", async () => {
        const mockSend = vi.fn().mockRejectedValue(new Error("queue send failed"));
        const queueManager = createMockQueueManager({
          hasProjectionSubscriberQueues: true,
          getProjectionSubscriberQueue: vi.fn().mockReturnValue({ send: mockSend }),
        });
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("my-fold", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "queue-subscriber",
          handle: vi.fn(),
        };
        router.registerSubscriber("my-fold", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );
      });
    });

    describe("when subscriber queue is missing (queue mode)", () => {
      it("falls back to inline execution", async () => {
        const queueManager = createMockQueueManager({
          hasProjectionSubscriberQueues: true,
          getProjectionSubscriberQueue: vi.fn().mockReturnValue(undefined),
        });
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("my-fold", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const subscriberHandle = vi.fn().mockResolvedValue(undefined);
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "fallback-subscriber",
          handle: subscriberHandle,
        };
        router.registerSubscriber("my-fold", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await router.dispatch([event], { tenantId });

        expect(subscriberHandle).toHaveBeenCalled();
      });
    });

    describe("when subscriber queue is missing and inline fallback fails", () => {
      it("throws AggregateError", async () => {
        const queueManager = createMockQueueManager({
          hasProjectionSubscriberQueues: true,
          getProjectionSubscriberQueue: vi.fn().mockReturnValue(undefined),
        });
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const store = createMockFoldProjectionStore<{ count: number }>();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const fold = createMockFoldProjectionDefinition("my-fold", {
          store,
          init: () => ({ count: 0 }),
          apply: (state: { count: number }) => ({ count: state.count + 1 }),
        });

        router.registerFoldProjection(fold);

        const subscriberHandle = vi
          .fn()
          .mockRejectedValue(new Error("inline fallback boom"));
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "fallback-failing-subscriber",
          handle: subscriberHandle,
        };
        router.registerSubscriber("my-fold", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

        expect(subscriberHandle).toHaveBeenCalled();
      });
    });
  });

  describe("map subscribers", () => {
    describe("when a map subscriber is registered on a map projection", () => {
      /** @scenario A subscriber without a relevance guard fires for every event */
      it("fires after map projection succeeds inline", async () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const mapStore = createMockAppendStore<Record<string, unknown>>();
        const mapProj = createMockMapProjectionDefinition("my-map", {
          store: mapStore,
          eventTypes: [],
        });

        router.registerMapProjection(mapProj);

        const subscriberHandle = vi.fn().mockResolvedValue(undefined);
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "map-subscriber",
          handle: subscriberHandle,
        };
        router.registerMapSubscriber("my-map", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await router.dispatch([event], { tenantId });

        expect(mapStore.append).toHaveBeenCalled();
        expect(subscriberHandle).toHaveBeenCalled();
      });
    });

    describe("when a map projection fails", () => {
      it("does not dispatch to map subscribers", async () => {
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

        const mapProj = createMockMapProjectionDefinition("failing-map", {
          store: failingStore,
          eventTypes: [],
        });

        router.registerMapProjection(mapProj);

        const subscriberHandle = vi.fn().mockResolvedValue(undefined);
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "should-not-fire",
          handle: subscriberHandle,
        };
        router.registerMapSubscriber("failing-map", subscriber);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        );

        await expect(router.dispatch([event], { tenantId })).rejects.toThrow(
          AggregateError,
        );

        expect(subscriberHandle).not.toHaveBeenCalled();
      });
    });

    describe("when registering a map subscriber on a non-existent map", () => {
      it("throws ConfigurationError", () => {
        const queueManager = createMockQueueManager();
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          queueManager,
        );

        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "orphan-subscriber",
          handle: vi.fn(),
        };

        expect(() => router.registerMapSubscriber("non-existent", subscriber)).toThrow(
          /map "non-existent" — map not found/,
        );
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

        await router.getProjectionByName("myProjection", TEST_CONSTANTS.AGGREGATE_ID, {
          tenantId,
        });

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

    function batchFold(store: ReturnType<typeof createMockFoldProjectionStore>) {
      return createMockFoldProjectionDefinition("my-fold", {
        store,
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        init: () => ({ count: 0, LastEventOccurredAt: 0 }),
        apply: (s: any, e: any) => ({
          count: s.count + 1,
          LastEventOccurredAt: Math.max(s.LastEventOccurredAt, e.occurredAt ?? 0),
        }),
      });
    }

    describe("when several events for one aggregate are coalesced", () => {
      /** @scenario 'Coalescing still dispatches per-span subscribers for every event' */
      it("folds the batch once but fires subscribers for every event", async () => {
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          createMockQueueManager(),
        );
        const store = createMockFoldProjectionStore();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const fold = batchFold(store);
        router.registerFoldProjection(fold);

        const seen: string[] = [];
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "per-span-spy",
          handle: async (event) => {
            seen.push(event.id);
          },
        };
        router.registerSubscriber("my-fold", subscriber);

        const events = [
          makeBatchEvent("e1", 1000),
          makeBatchEvent("e2", 2000),
          makeBatchEvent("e3", 3000),
        ];

        await (router as any).processFoldProjectionBatch("my-fold", fold, events, {
          tenantId,
        });

        // The expensive fold load/store happens once — the O(n) win.
        expect(store.get).toHaveBeenCalledTimes(1);
        expect(store.store).toHaveBeenCalledTimes(1);
        // Per-span subscribers (embedded-eval sync, evaluation triggers) must see
        // EVERY event, not just the last — otherwise N-1 spans are dropped.
        expect(seen).toEqual(["e1", "e2", "e3"]);
      });

      it("evaluates shouldDispatch per coalesced event, not once per batch", async () => {
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          createMockQueueManager(),
        );
        const store = createMockFoldProjectionStore();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const fold = batchFold(store);
        router.registerFoldProjection(fold);

        const seen: string[] = [];
        const subscriber: SubscriberDispatchDefinition<Event> = {
          name: "selective-per-span-spy",
          shouldDispatch: (event) => event.id !== "e2",
          handle: async (event) => {
            seen.push(event.id);
          },
        };
        router.registerSubscriber("my-fold", subscriber);

        const events = [
          makeBatchEvent("e1", 1000),
          makeBatchEvent("e2", 2000),
          makeBatchEvent("e3", 3000),
        ];

        await (router as any).processFoldProjectionBatch("my-fold", fold, events, {
          tenantId,
        });

        expect(seen).toEqual(["e1", "e3"]);
      });

      it("dispatches subscribers in occurredAt order even when events arrive shuffled", async () => {
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          createMockQueueManager(),
        );
        const store = createMockFoldProjectionStore();
        (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const fold = batchFold(store);
        router.registerFoldProjection(fold);

        const seen: string[] = [];
        router.registerSubscriber("my-fold", {
          name: "spy",
          handle: async (event) => {
            seen.push(event.id);
          },
        });

        const events = [
          makeBatchEvent("third", 3000),
          makeBatchEvent("first", 1000),
          makeBatchEvent("second", 2000),
        ];

        await (router as any).processFoldProjectionBatch("my-fold", fold, events, {
          tenantId,
        });

        expect(seen).toEqual(["first", "second", "third"]);
      });

      /** @scenario Batched fold projections use the tenant retention policy */
      it("stores the folded state with the tenant retention policy", async () => {
        const retentionPolicy = { traces: 30, scenarios: 60, experiments: 90 };
        const router = new ProjectionRouter(
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.PIPELINE_NAME,
          createMockQueueManager(),
          {
            retentionPolicyResolver: {
              resolve: vi.fn().mockResolvedValue(retentionPolicy),
            },
          },
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
          { replayMarkerChecker: markerChecker },
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
          { replayMarkerChecker: markerChecker },
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
          { replayMarkerChecker: markerChecker },
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
