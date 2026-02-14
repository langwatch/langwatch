import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../domain/eventType";
import type { Event } from "../../domain/types";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockEventStore,
  createMockCheckpointStore,
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestContext,
  createTestEvent,
  createTestProjection,
  setupTestEnvironment,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Projection Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("updateProjectionByName", () => {
    it("successfully updates fold projection", async () => {
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

      // updateProjectionByName now returns { projection, events }
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("projection");
      expect(result).toHaveProperty("events");
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
        aggregateType,
      );
      expect(foldDef.apply).toHaveBeenCalled();
      expect(foldDef.store.store).toHaveBeenCalled();
    });

    it("creates event stream with correct ordering", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000002,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000000,
        ),
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
          EVENT_TYPES[0],
          1000001,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
        serviceOptions: {
          ordering: "timestamp",
        },
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      // The fold executor applies events; verify apply was called for each event
      expect(foldDef.apply).toHaveBeenCalledTimes(3);
    });

    it("calls fold projection apply with events", async () => {
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

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(foldDef.apply).toHaveBeenCalledTimes(1);
    });

    it("throws when projection name not found", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [
          createMockFoldProjectionDefinition("projection"),
        ],
      });

      await expect(
        service.updateProjectionByName(
          "nonexistent" as any,
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/nonexistent/);
    });

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/projection/i);
    });

    it("handles fold projection apply errors gracefully", async () => {
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
      const handlerError = new Error("Handler failed");
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw handlerError;
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("Handler failed");

      expect(foldDef.store.store).not.toHaveBeenCalled();
    });

    it("handles fold projection store errors gracefully", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const storeError = new Error("Store failed");
      (foldStore.store as ReturnType<typeof vi.fn>).mockRejectedValue(storeError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("Store failed");
    });
  });

  describe("getProjectionByName", () => {
    it("retrieves projection from fold store", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });

      const expectedState = { value: "test" };
      (foldStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(expectedState);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const result = await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).not.toBeNull();
      expect(foldStore.get).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId,
        }),
      );
    });

    it("throws when projection name not found", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [
          createMockFoldProjectionDefinition("projection"),
        ],
      });

      await expect(
        service.getProjectionByName(
          "nonexistent" as any,
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/nonexistent/);
    });

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      await expect(
        service.getProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/projection/i);
    });
  });

  describe("hasProjectionByName", () => {
    it("returns true when projection exists", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });

      (foldStore.get as ReturnType<typeof vi.fn>).mockResolvedValue({ value: "test" });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const result = await service.hasProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toBe(true);
    });

    it("returns false when projection doesn't exist", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });

      (foldStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const result = await service.hasProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).toBe(false);
    });

    it("throws when projection name not found", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [
          createMockFoldProjectionDefinition("projection"),
        ],
      });

      await expect(
        service.hasProjectionByName(
          "nonexistent" as any,
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/nonexistent/);
    });

    it("throws when no projections configured", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      await expect(
        service.hasProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/projection/i);
    });
  });

  describe("getProjectionNames", () => {
    it("returns all registered fold projection names", () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [
          createMockFoldProjectionDefinition("projection1"),
          createMockFoldProjectionDefinition("projection2"),
          createMockFoldProjectionDefinition("projection3"),
        ],
      });

      const names = service.getProjectionNames();

      expect(names).toHaveLength(3);
      expect(names).toContain("projection1");
      expect(names).toContain("projection2");
      expect(names).toContain("projection3");
    });
  });

  describe("updateProjectionsForAggregates", () => {
    it("groups events by aggregateId correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.storeEvents(events, context);

      // Should be called for each unique aggregate
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        aggregate1,
        context,
        aggregateType,
      );
      expect(eventStore.getEvents).toHaveBeenCalledWith(
        aggregate2,
        context,
        aggregateType,
      );
    });

    it("updates all fold projections for each aggregate", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef1 = createMockFoldProjectionDefinition("projection1");
      const foldDef2 = createMockFoldProjectionDefinition("projection2");
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
        foldProjections: [foldDef1, foldDef2],
      });

      await service.storeEvents(events, context);

      expect(foldDef1.apply).toHaveBeenCalled();
      expect(foldDef2.apply).toHaveBeenCalled();
      expect(foldDef1.store.store).toHaveBeenCalled();
      expect(foldDef2.store.store).toHaveBeenCalled();
    });

    it("handles multiple aggregates", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      eventStore.getEvents = vi.fn().mockImplementation((aggId) => {
        return Promise.resolve(events.filter((e) => e.aggregateId === aggId));
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.storeEvents(events, context);

      expect(eventStore.getEvents).toHaveBeenCalledTimes(2);
      // apply is called once per event across both aggregates
      expect(foldDef.apply).toHaveBeenCalledTimes(2);
    });
  });

  describe("projection checkpointing", () => {
    it("saves checkpoints after successful projection update", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = createMockCheckpointStore();
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
        checkpointStore: checkpointStore,
      });

      await service.storeEvents(events, context);

      // Checkpoint should be saved: pending (optimistic locking), pending (before processing),
      // and processed (triggering event). Batch checkpointing only happens with multiple events.
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledTimes(3);
      // 1st call: pending checkpoint from idempotency checker (optimistic locking) - 5 args, no errorMessage
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        1,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
      );
      // 2nd call: pending checkpoint before processing (from processProjectionEvent)
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        2,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
        undefined,
      );
      // 3rd call: processed checkpoint after successful processing
      expect(checkpointStore.saveCheckpoint).toHaveBeenNthCalledWith(
        3,
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "processed",
        1,
        undefined,
      );
    });

    it("saves checkpoint with failed status when projection update fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = createMockCheckpointStore();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const error = new Error("Projection update failed");
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw error;
      });
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(false);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
        checkpointStore: checkpointStore,
      });

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // Should save pending checkpoint first, then failed checkpoint
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "pending",
        1,
        undefined,
      );
      expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
        tenantId,
        buildCheckpointKey(
          tenantId,
          TEST_CONSTANTS.PIPELINE_NAME,
          "projection",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          TEST_CONSTANTS.AGGREGATE_ID,
        ),
        "projection",
        events[0],
        "failed",
        1,
        "Projection update failed",
      );
    });

    it("stops processing when a previous event failed for the same aggregate", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = createMockCheckpointStore();
      const event1 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP,
      );
      const event2 = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
        EVENT_TYPES[0],
        TEST_CONSTANTS.BASE_TIMESTAMP + 1000,
      );

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValueOnce([event1])
        .mockResolvedValueOnce([event1, event2]);

      // Make fold projection fail for event1
      const error = new Error("Projection failed");
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw error;
      });

      checkpointStore.hasFailedEvents = vi
        .fn()
        .mockResolvedValueOnce(false) // First check for event1 (no failures yet)
        .mockResolvedValueOnce(true); // Second check for event2 (event1 failed)

      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null); // No existing checkpoints

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
        checkpointStore: checkpointStore,
      });

      // Process event1 - should fail
      await expect(
        service.storeEvents([event1], context),
      ).resolves.not.toThrow();

      // Process event2 - should be skipped due to previous failure
      await expect(
        service.storeEvents([event2], context),
      ).resolves.not.toThrow();

      // Verify fold apply was only called once (for event1)
      expect(foldDef.apply).toHaveBeenCalledTimes(1);
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );
    });

    it("checks for failed events before processing projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const checkpointStore = createMockCheckpointStore();
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      // Simulate previous failure
      checkpointStore.hasFailedEvents = vi.fn().mockResolvedValue(true);
      checkpointStore.loadCheckpoint = vi.fn().mockResolvedValue(null);

      // Mock getEvents to return the events being stored
      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      eventStore.countEventsBefore = vi.fn().mockResolvedValue(0);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
        checkpointStore: checkpointStore,
      });

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // hasFailedEvents is checked by the validator even in inline processing
      // When hasFailedEvents returns true, processing is skipped (validator returns null)
      expect(checkpointStore.hasFailedEvents).toHaveBeenCalledWith(
        TEST_CONSTANTS.PIPELINE_NAME,
        "projection",
        "projection",
        tenantId,
        aggregateType,
        TEST_CONSTANTS.AGGREGATE_ID,
      );

      // Since hasFailedEvents returns true, the apply should NOT be called
      // (processing is skipped when there are failures)
      expect(foldDef.apply).not.toHaveBeenCalled();
    });
  });
});
