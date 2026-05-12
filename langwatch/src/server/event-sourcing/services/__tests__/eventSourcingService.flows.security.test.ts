import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockMapProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Security Flows", () => {
  const aggregateType = createTestAggregateType();
  const tenantId1 = createTestTenantId("tenant-1");
  const tenantId2 = createTestTenantId("tenant-2");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("tenant isolation", () => {
    it("tenantId is required in all contexts", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      // Context without tenantId should fail
      const invalidContext = {} as any;

      await expect(service.storeEvents(events, invalidContext)).rejects.toThrow(
        "tenantId",
      );
    });

    it("tenantId is validated before operations", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      // Empty tenantId should fail
      const invalidContext = { tenantId: "" } as any;

      await expect(service.storeEvents(events, invalidContext)).rejects.toThrow(
        "tenantId",
      );
    });

    it("events are filtered by tenantId", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const context1 = createTestEventStoreReadContext(tenantId1);
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      await service.storeEvents(events, context1);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context1,
        aggregateType,
      );
      // Verify tenantId is passed to store
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ tenantId: tenantId1 }),
        aggregateType,
      );
    });

    it("projections are scoped to tenantId", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });
      const context1 = createTestEventStoreReadContext(tenantId1);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context1,
      );

      expect(foldStore.get).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId1,
        }),
      );
    });
  });

  describe("context validation", () => {
    it("missing tenantId causes errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      await expect(
        service.storeEvents(events, undefined as any),
      ).rejects.toThrow("tenantId");
    });

    it("invalid tenantId causes errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];

      const invalidContexts = [
        { tenantId: "" },
        { tenantId: "   " }, // whitespace only
        { tenantId: null },
        { tenantId: undefined },
      ];

      for (const invalidContext of invalidContexts) {
        await expect(
          service.storeEvents(events, invalidContext as any),
        ).rejects.toThrow(/tenantId|TenantId/);
      }
    });

    it("context is passed correctly to stores", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });
      const context = createTestEventStoreReadContext(tenantId1, {
        custom: "metadata",
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(foldStore.get).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({
          aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
          tenantId: tenantId1,
        }),
      );
    });
  });

  describe("aggregate type scoping", () => {
    it("correct aggregateType is used for all operations", async () => {
      const eventStore = createMockEventStore<Event>();
      const customAggregateType = "trace" as const;
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: customAggregateType,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const context = createTestEventStoreReadContext(tenantId1);

      await service.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        customAggregateType,
      );
    });

    it("aggregateType prevents cross-type contamination", async () => {
      const eventStore = createMockEventStore<Event>();
      const aggregateType1 = "trace" as const satisfies AggregateType;
      const aggregateType2 = "test_aggregate" as const as AggregateType;

      const service1 = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: aggregateType1,
        eventStore,
      });

      const service2 = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType: aggregateType2,
        eventStore,
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const context = createTestEventStoreReadContext(tenantId1);

      await service1.storeEvents(events, context);
      await service2.storeEvents(events, context);

      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        aggregateType1,
      );
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events,
        context,
        aggregateType2,
      );
    });
  });

  describe("security boundaries", () => {
    it("stores enforce tenant isolation", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
      });

      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);
      const events1 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const events2 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId2,
        ),
      ];

      await service.storeEvents(events1, context1);
      await service.storeEvents(events2, context2);

      // Verify different tenantIds are passed to store
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events1,
        expect.objectContaining({ tenantId: tenantId1 }),
        aggregateType,
      );
      expect(eventStore.storeEvents).toHaveBeenCalledWith(
        events2,
        expect.objectContaining({ tenantId: tenantId2 }),
        aggregateType,
      );
    });

    it("map projections receive tenant-scoped events", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const context1 = createTestEventStoreReadContext(tenantId1);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      await service.storeEvents(events, context1);

      // Map should receive event with correct tenantId
      expect(mapDef.map).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: tenantId1 }),
      );
    });

    it("fold projections are tenant-scoped", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldStore = createMockFoldProjectionStore();
      const foldDef = createMockFoldProjectionDefinition("projection", {
        store: foldStore,
      });
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context1,
      );
      await service.getProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context2,
      );

      // Verify different tenantIds are passed to fold store
      expect(foldStore.get).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({ tenantId: tenantId1 }),
      );
      expect(foldStore.get).toHaveBeenCalledWith(
        TEST_CONSTANTS.AGGREGATE_ID,
        expect.objectContaining({ tenantId: tenantId2 }),
      );
    });

    it("events from different tenants are isolated", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const context1 = createTestEventStoreReadContext(tenantId1);
      const context2 = createTestEventStoreReadContext(tenantId2);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
      });

      const events1 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId1,
        ),
      ];
      const events2 = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId2,
        ),
      ];

      await service.storeEvents(events1, context1);
      await service.storeEvents(events2, context2);

      // Verify events are stored with correct tenant contexts
      expect(eventStore.storeEvents).toHaveBeenNthCalledWith(
        1,
        events1,
        context1,
        aggregateType,
      );
      expect(eventStore.storeEvents).toHaveBeenNthCalledWith(
        2,
        events2,
        context2,
        aggregateType,
      );
    });
  });
});
