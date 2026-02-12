import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventHandler,
  createMockEventStore,
  createMockProjectionDefinition,
  createMockProjectionStore,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestProjection,
  createTestTenantId,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Concurrency Flows", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("without distributed lock", () => {
    it("service works without distributed lock", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const result = await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).not.toBeNull();
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
    });

    it("concurrent updates to same aggregate both succeed (GroupQueue handles ordering)", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      // Both concurrent updates succeed - GroupQueue enforces per-aggregate ordering at the queue level
      const update1 = service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );
      const update2 = service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      const results = await Promise.allSettled([update1, update2]);
      const succeeded = results.filter((r) => r.status === "fulfilled").length;

      expect(succeeded).toBe(2);
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
    });

    it("different aggregates can update concurrently", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        ]);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(createTestProjection(aggregate1, tenantId));

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
      });

      const update1 = service.updateProjectionByName(
        "projection",
        aggregate1,
        context,
      );
      const update2 = service.updateProjectionByName(
        "projection",
        aggregate2,
        context,
      );

      await Promise.all([update1, update2]);

      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
    });
  });
});
