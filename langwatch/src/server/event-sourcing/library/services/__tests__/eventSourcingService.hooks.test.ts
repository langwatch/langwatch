/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";
import type { EventStore } from "../../stores/eventStore.types";
import { createTenantId } from "../../core/tenantId";

const tenantId = createTenantId("test-tenant");

describe("EventSourcingService - Hook Error Recovery", () => {
  let mockEventStore: {
    getEvents: ReturnType<typeof vi.fn>;
    storeEvents: ReturnType<typeof vi.fn>;
    listAggregateIds?: ReturnType<typeof vi.fn>;
  } & Partial<EventStore<string, Event<string>>>;
  let mockProjectionStore: ProjectionStore<string, Projection<string>>;
  let mockEventHandler: EventHandler<string, Event<string>, Projection<string>>;

  beforeEach(() => {
    mockEventStore = {
      getEvents: vi.fn(),
      storeEvents: vi.fn(),
    };

    mockProjectionStore = {
      getProjection: vi.fn(),
      storeProjection: vi.fn(),
    };

    mockEventHandler = {
      handle: vi.fn(),
    };
  });

  describe("when beforeHandle throws", () => {
    it("does not call handler", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const beforeHandle = vi.fn(() => {
        throw new Error("beforeHandle failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { beforeHandle } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("beforeHandle failed");
      expect(mockEventHandler.handle).not.toHaveBeenCalled();
    });

    it("does not persist projection", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const beforeHandle = vi.fn(() => {
        throw new Error("beforeHandle failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { beforeHandle } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow();
      expect(mockProjectionStore.storeProjection).not.toHaveBeenCalled();
    });
  });

  describe("when afterHandle throws", () => {
    it("does not persist projection", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const afterHandle = vi.fn(() => {
        throw new Error("afterHandle failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { afterHandle } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("afterHandle failed");
      expect(mockProjectionStore.storeProjection).not.toHaveBeenCalled();
    });

    it("handler was called before failure", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const afterHandle = vi.fn(() => {
        throw new Error("afterHandle failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { afterHandle } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow();
      expect(mockEventHandler.handle).toHaveBeenCalled();
    });
  });

  describe("when beforePersist throws", () => {
    it("does not persist projection", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const beforePersist = vi.fn(() => {
        throw new Error("beforePersist failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { beforePersist } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("beforePersist failed");
      expect(mockProjectionStore.storeProjection).not.toHaveBeenCalled();
    });

    it("handler was called before failure", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const beforePersist = vi.fn(() => {
        throw new Error("beforePersist failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { beforePersist } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow();
      expect(mockEventHandler.handle).toHaveBeenCalled();
    });
  });

  describe("when afterPersist throws", () => {
    it("projection was already persisted", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const afterPersist = vi.fn(() => {
        throw new Error("afterPersist failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { afterPersist } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("afterPersist failed");
      // Projection WAS stored despite the error
      expect(mockProjectionStore.storeProjection).toHaveBeenCalledWith(
        projection,
        { tenantId: createTenantId("test-tenant") },
      );
    });

    it("error propagates to caller", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const afterPersist = vi.fn(() => {
        throw new Error("afterPersist failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { afterPersist } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("afterPersist failed");
    });
  });

  describe("when storeProjection throws", () => {
    it("afterPersist is not called", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      };

      const afterPersist = vi.fn();

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);
      vi.mocked(mockProjectionStore.storeProjection).mockRejectedValue(
        new Error("Store failed"),
      );

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { afterPersist } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("Store failed");
      expect(afterPersist).not.toHaveBeenCalled();
    });
  });

  describe("when multiple hooks throw", () => {
    it("stops at first hook failure", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      const beforeHandle = vi.fn(() => {
        throw new Error("beforeHandle failed");
      });
      const afterHandle = vi.fn(() => {
        throw new Error("afterHandle failed");
      });

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        serviceOptions: { hooks: { beforeHandle, afterHandle } },
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        }),
      ).rejects.toThrow("beforeHandle failed");
      // afterHandle shouldn't even be reached
      expect(afterHandle).not.toHaveBeenCalled();
    });
  });
});
