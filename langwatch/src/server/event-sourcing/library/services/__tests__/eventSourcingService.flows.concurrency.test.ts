import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
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

  describe("without queue-based ordering", () => {
    it("service works without queue-based ordering", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const result = await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).not.toBeNull();
      expect(foldDef.apply).toHaveBeenCalled();
    });

    it("concurrent updates to same aggregate both succeed (GroupQueue handles ordering)", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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
      expect(foldDef.apply).toHaveBeenCalledTimes(2);
    });

    it("different aggregates can update concurrently", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([
          createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        ]);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
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

      expect(foldDef.apply).toHaveBeenCalledTimes(2);
    });
  });
});
