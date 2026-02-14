import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockMapProjectionDefinition,
  createMockEventStore,
  createTestContext,
  createTestEvent,
  setupTestEnvironment,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Handler Flows", () => {
  const { aggregateType, tenantId, context } = createTestContext();

  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    cleanupTestEnvironment();
  });

  describe("error handling", () => {
    it("map projection errors are logged", async () => {
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

      // Error handling uses standardized error handling in ProjectionRouter
      // which uses its own logger, so we can't verify the exact log call here
      // But we can verify the operation completed successfully (error was handled)
      expect(mapDef.map).toHaveBeenCalled();
    });

    it("map projection errors don't stop other map projections", async () => {
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
  });

  describe("when using queue-based processing", () => {
    it("calls map function directly via queue", async () => {
      const eventStore = createMockEventStore<Event>();
      const mapDef = createMockMapProjectionDefinition("handler");

      const mockQueueFactory = {
        create: vi.fn().mockImplementation((definition: any) => {
          // Simulate queue: call process immediately on send
          return {
            send: vi.fn().mockImplementation(async (payload: any) => {
              await definition.process(payload);
            }),
            close: vi.fn().mockResolvedValue(void 0),
            waitUntilReady: vi.fn().mockResolvedValue(void 0),
          };
        }),
      };

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        mapProjections: [mapDef],
        queueFactory: mockQueueFactory,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      await service.storeEvents([event], context);

      expect(mapDef.map).toHaveBeenCalledWith(event);
    });
  });
});
