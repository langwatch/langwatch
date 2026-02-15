import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import { EventSourcingService } from "../eventSourcingService";
import {
  cleanupTestEnvironment,
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestContext,
  createTestEvent,
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

  describe("storeEvents dispatches to fold projections incrementally", () => {
    it("applies each event incrementally to fold projections", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");

      const events = [
        createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          TEST_CONSTANTS.AGGREGATE_TYPE,
          tenantId,
        ),
      ];

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.storeEvents(events, context);

      // Each event is applied incrementally (store.get + apply + store.store)
      expect(foldDef.store.get).toHaveBeenCalled();
      expect(foldDef.apply).toHaveBeenCalledTimes(1);
      expect(foldDef.store.store).toHaveBeenCalled();
    });

    it("updates all fold projections for each event", async () => {
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

    it("handles multiple events", async () => {
      const eventStore = createMockEventStore<Event>();
      const foldDef = createMockFoldProjectionDefinition("projection");

      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";
      const events = [
        createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
        createTestEvent(aggregate2, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      ];

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [foldDef],
      });

      await service.storeEvents(events, context);

      // apply is called once per event (incremental)
      expect(foldDef.apply).toHaveBeenCalledTimes(2);
    });
  });
});
