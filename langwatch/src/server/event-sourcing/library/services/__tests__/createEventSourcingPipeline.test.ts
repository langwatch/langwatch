/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventSourcingPipeline } from "../createEventSourcingPipeline";
import type { EventStore } from "../../stores/eventStore";
import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";
import type { EventSourcingHooks } from "../eventSourcingService";

describe("createEventSourcingPipeline", () => {
  let mockEventStore: any;
  let mockProjectionStore: ProjectionStore<string, Projection<string>>;
  let mockEventHandler: EventHandler<string, Event<string>, Projection<string>>;

  beforeEach(() => {
    // @ts-ignore we intentionally use a relaxed mock shape for the event store in tests
    mockEventStore = {
      getEvents: vi.fn(),
      storeEvents: vi.fn(),
      listAggregateIds: vi.fn(),
    };

    mockProjectionStore = {
      getProjection: vi.fn(),
      storeProjection: vi.fn(),
    };

    mockEventHandler = {
      handle: vi.fn(),
    };
  });

  describe("when called with required options", () => {
    it("creates EventSourcingService with all required options", () => {
      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(service).toBeDefined();
      expect(service).toHaveProperty("rebuildProjection");
      expect(service).toHaveProperty("getProjection");
    });

    it("passes through aggregateType, eventStore, projectionStore, eventHandler", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        version: 1000,
        data: {},
      };

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      await service.rebuildProjection("test-1", {
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(mockEventStore.getEvents).toHaveBeenCalledWith(
        "test-1",
        { tenantId: "test-tenant" },
        "trace",
      );
      expect(mockEventHandler.handle).toHaveBeenCalled();
    });
  });

  describe("when called with optional serviceOptions", () => {
    it("passes through hooks", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        version: 1000,
        data: {},
      };

      const beforeHandle = vi.fn();
      const afterHandle = vi.fn();
      const beforePersist = vi.fn();
      const afterPersist = vi.fn();

      const hooks: EventSourcingHooks<
        string,
        Event<string>,
        Projection<string>
      > = {
        beforeHandle,
        afterHandle,
        beforePersist,
        afterPersist,
      };

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks },
      });

      await service.rebuildProjection("test-1", {
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(beforeHandle).toHaveBeenCalled();
      expect(afterHandle).toHaveBeenCalled();
      expect(beforePersist).toHaveBeenCalled();
      expect(afterPersist).toHaveBeenCalled();
    });

    it("passes through ordering strategy", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          timestamp: 3000,
          type: "trace.projection.recomputed",
          data: {},
        },
        {
          aggregateId: "test-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
        {
          aggregateId: "test-1",
          timestamp: 2000,
          type: "trace.projection.reset",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        version: 1000,
        data: {},
      };

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { ordering: "as-is" },
      });

      await service.rebuildProjection("test-1", {
        eventStoreContext: { tenantId: "test-tenant" },
      });

      const handleCall = vi.mocked(mockEventHandler.handle).mock.calls[0];
      const stream = handleCall?.[0];
      const streamEvents = stream?.getEvents();

      // With "as-is" ordering, events should maintain original order
      expect(streamEvents?.[0]?.timestamp).toBe(3000);
      expect(streamEvents?.[1]?.timestamp).toBe(1000);
      expect(streamEvents?.[2]?.timestamp).toBe(2000);
    });
  });

  describe("when service is created", () => {
    it("returns a service instance that can rebuild projections", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          timestamp: 1000,
          type: "span.ingestion.ingested",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        version: 1000,
        data: {},
      };

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const result = await service.rebuildProjection("test-1", {
        eventStoreContext: { tenantId: "test-tenant" },
      });

      expect(result).toBe(projection);
      expect(mockProjectionStore.storeProjection).toHaveBeenCalledWith(
        projection,
        { tenantId: "test-tenant" },
      );
    });

    it("returns a service instance that can get projections", async () => {
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        version: 1000,
        data: {},
      };

      vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(
        projection,
      );

      const service = createEventSourcingPipeline({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const result = await service.getProjection("test-1", {
        projectionStoreContext: { tenantId: "test-tenant" },
      });

      expect(result).toBe(projection);
      expect(mockProjectionStore.getProjection).toHaveBeenCalledWith("test-1", {
        tenantId: "test-tenant",
      });
    });
  });
});
