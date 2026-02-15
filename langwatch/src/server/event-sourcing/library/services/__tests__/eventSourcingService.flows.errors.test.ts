import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  createMockEventPublisher,
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createMockMapProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Error Handling Flows", () => {
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

  describe("event storage errors", () => {
    it("storage errors propagate (critical path)", async () => {
      const eventStore = createMockEventStore<Event>();
      const storageError = new Error("Storage failed");
      eventStore.storeEvents = vi.fn().mockRejectedValue(storageError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,

      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).rejects.toThrow(
        "Storage failed",
      );
    });

    it("downstream operations don't execute if storage fails", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const foldDef = createMockFoldProjectionDefinition("projection");

      const storageError = new Error("Storage failed");
      eventStore.storeEvents = vi.fn().mockRejectedValue(storageError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventPublisher,
        mapProjections: [mapDef],
        foldProjections: [foldDef],

      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).rejects.toThrow(
        "Storage failed",
      );

      expect(eventPublisher.publish).not.toHaveBeenCalled();
      expect(mapDef.map).not.toHaveBeenCalled();
      expect(foldDef.apply).not.toHaveBeenCalled();
    });
  });

  describe("event publishing errors", () => {
    it("publishing errors are caught and logged", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const publishError = new Error("Publishing failed");
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventPublisher,
        logger: logger as any,

      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          eventCount: 1,
          error: "Publishing failed",
        }),
        "Failed to publish events to external system",
      );
    });

    it("storage operation succeeds despite publishing failure", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();

      const publishError = new Error("Publishing failed");
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventPublisher,

      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("error details are logged correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const eventPublisher = createMockEventPublisher<Event>();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const publishError = new Error("Publishing failed with details");
      eventPublisher.publish = vi.fn().mockRejectedValue(publishError);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        eventPublisher,
        logger: logger as any,

      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
        createTestEvent(
          "aggregate-456",
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await service.storeEvents(events, context);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
          eventCount: 2,
          error: "Publishing failed with details",
        }),
        "Failed to publish events to external system",
      );
    });
  });

  describe("map projection (handler) errors", () => {
    it("individual map projection errors are caught and logged", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const handlerError = new Error("Handler failed");
      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw handlerError;
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,

        mapProjections: [mapDef],
        logger: logger as any,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(mapDef.map).toHaveBeenCalled();
    });

    it("other map projections continue execution", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef1 = createMockMapProjectionDefinition("handler1");
      const mapDef2 = createMockMapProjectionDefinition("handler2");

      (mapDef1.map as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Handler1 failed");
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,

        mapProjections: [mapDef1, mapDef2],
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(mapDef1.map).toHaveBeenCalledTimes(1);
      expect(mapDef2.map).toHaveBeenCalledTimes(1);
    });

    it("map projection errors don't fail storage", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");

      (mapDef.map as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Handler failed");
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,

        mapProjections: [mapDef],
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await expect(
        service.storeEvents([event], context),
      ).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe("fold projection update errors", () => {
    it("individual fold projection errors are caught and logged", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");

      const projectionError = new Error("Projection update failed");
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw projectionError;
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();
    });

    it("other fold projections continue updating", async () => {
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

      (foldDef1.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Projection1 failed");
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef1, foldDef2],
      });

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(foldDef1.apply).toHaveBeenCalledTimes(1);
      expect(foldDef2.apply).toHaveBeenCalledTimes(1);
      expect(foldDef2.store.store).toHaveBeenCalledTimes(1);
    });

    it("fold projection errors don't fail storage", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Projection failed");
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("errors for one aggregate don't affect others", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");
      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      // Fail apply only for the first event (aggregate-1)
      let callCount = 0;
      (foldDef.apply as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Aggregate1 failed");
        }
        return {};
      });

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();

      // Both events should be attempted
      expect(foldDef.apply).toHaveBeenCalledTimes(2);
      // Store should succeed for aggregate2
      expect(foldDef.store.store).toHaveBeenCalledTimes(1);
    });
  });

  describe("missing dependencies", () => {
    it("service works with minimal configuration", async () => {
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
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();
    });

    it("missing optional components don't cause errors", async () => {
      const eventStore = createMockEventStore<Event>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,

        // No eventPublisher, mapProjections, foldProjections, etc.
      });

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      await expect(service.storeEvents(events, context)).resolves.not.toThrow();
      expect(eventStore.storeEvents).toHaveBeenCalledTimes(1);
    });

    it("required components cause clear error messages", async () => {
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
  });
});
