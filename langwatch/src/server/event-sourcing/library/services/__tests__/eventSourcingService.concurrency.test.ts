/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";
import type { EventStore } from "../../stores/eventStore.types";
import { createTenantId } from "../../core/tenantId";
import { InMemoryDistributedLock } from "../../utils/distributedLock";

const tenantId = createTenantId("test-tenant");

describe("EventSourcingService - Concurrency", () => {
  let mockEventStore: {
    getEvents: ReturnType<typeof vi.fn>;
    storeEvents: ReturnType<typeof vi.fn>;
    listAggregateIds: ReturnType<typeof vi.fn>;
  } & Partial<EventStore<string, Event<string>>>;
  let mockProjectionStore: ProjectionStore<string, Projection<string>>;
  let mockEventHandler: EventHandler<string, Event<string>, Projection<string>>;

  beforeEach(() => {
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

  describe("rebuildProjection with distributed lock", () => {
    it("prevents concurrent rebuilds of the same aggregate", async () => {
      const lock = new InMemoryDistributedLock();
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

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        distributedLock: lock,
        rebuildLockTtlMs: 5000,
      });

      const context = { tenantId: createTenantId("test-tenant") };

      // Start first rebuild
      const promise1 = service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });

      // Try to start second rebuild immediately - should fail to acquire lock
      const promise2 = service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });

      // First should succeed
      await expect(promise1).resolves.toBeDefined();

      // Second should fail with lock error
      await expect(promise2).rejects.toThrow("[CONCURRENCY]");

      lock.destroy();
    });

    it("allows concurrent rebuilds of different aggregates", async () => {
      const lock = new InMemoryDistributedLock();
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

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        distributedLock: lock,
        rebuildLockTtlMs: 5000,
      });

      const context = { tenantId: createTenantId("test-tenant") };

      // Start rebuilds for different aggregates - both should succeed
      const promise1 = service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });
      const promise2 = service.rebuildProjection("test-2", {
        eventStoreContext: context,
      });

      await expect(Promise.all([promise1, promise2])).resolves.toBeDefined();

      lock.destroy();
    });

    it("releases lock after successful rebuild", async () => {
      const lock = new InMemoryDistributedLock();
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

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        distributedLock: lock,
        rebuildLockTtlMs: 5000,
      });

      const context = { tenantId: createTenantId("test-tenant") };

      // First rebuild
      await service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });

      // Lock should be released, so second rebuild should succeed
      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: context,
        }),
      ).resolves.toBeDefined();

      lock.destroy();
    });

    it("releases lock even if rebuild fails", async () => {
      const lock = new InMemoryDistributedLock();
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle).mockRejectedValue(
        new Error("Handler failed"),
      );

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        distributedLock: lock,
        rebuildLockTtlMs: 5000,
      });

      const context = { tenantId: createTenantId("test-tenant") };

      // First rebuild should fail
      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: context,
        }),
      ).rejects.toThrow("Handler failed");

      // Lock should be released, so second rebuild should be able to acquire lock
      vi.mocked(mockEventHandler.handle).mockResolvedValue({
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: {},
      });

      await expect(
        service.rebuildProjection("test-1", {
          eventStoreContext: context,
        }),
      ).resolves.toBeDefined();

      lock.destroy();
    });
  });

  describe("rebuildProjection without distributed lock", () => {
    it("allows concurrent rebuilds (last write wins)", async () => {
      const events: Event<string>[] = [
        {
          aggregateId: "test-1",
          tenantId,
          timestamp: 1000,
          type: "lw.obs.span.ingestion.recorded",
          data: {},
        },
      ];
      const projection1: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 1000,
        data: { value: "first" },
      };
      const projection2: Projection<string> = {
        id: "proj-1",
        aggregateId: "test-1",
        tenantId,
        version: 2000,
        data: { value: "second" },
      };

      vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
      vi.mocked(mockEventHandler.handle)
        .mockResolvedValueOnce(projection1)
        .mockResolvedValueOnce(projection2);

      const service = new EventSourcingService({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
        // No distributed lock
      });

      const context = { tenantId: createTenantId("test-tenant") };

      // Both rebuilds should succeed (no lock to prevent them)
      const promise1 = service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });
      const promise2 = service.rebuildProjection("test-1", {
        eventStoreContext: context,
      });

      await expect(Promise.all([promise1, promise2])).resolves.toBeDefined();

      // Both should have called storeProjection (last write wins)
      expect(mockProjectionStore.storeProjection).toHaveBeenCalledTimes(2);
    });
  });
});
