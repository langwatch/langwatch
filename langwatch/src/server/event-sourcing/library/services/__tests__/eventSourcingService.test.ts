/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";
import type { EventStore } from "../../stores/eventStore.types";
import { createTenantId } from "../../core/tenantId";

const tenantId = createTenantId("test-tenant");

describe("EventSourcingService", () => {
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

  describe("rebuildProjection", () => {
    describe("when events exist", () => {
      it("rebuilds projection and stores it", async () => {
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
        });

        const result = await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(projection);
      });
    });

    describe("when hooks are configured", () => {
      it("calls beforeHandle hook", async () => {
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

        const beforeHandle = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
          serviceOptions: { hooks: { beforeHandle } },
        });

        await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(beforeHandle).toHaveBeenCalled();
      });

      it("calls afterHandle hook", async () => {
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

        const afterHandle = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
          serviceOptions: { hooks: { afterHandle } },
        });

        await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(afterHandle).toHaveBeenCalled();
      });

      it("calls beforePersist hook", async () => {
        const events: Event<string>[] = [
          {
            aggregateId: "test-1",
            tenantId: createTenantId("test-tenant"),
            timestamp: 1000,
            type: "lw.obs.span.ingestion.recorded",
            data: {},
          },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          tenantId: createTenantId("test-tenant"),
          version: 1000,
          data: {},
        } satisfies Projection<string>;

        const beforePersist = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
          serviceOptions: { hooks: { beforePersist } },
        });

        await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(beforePersist).toHaveBeenCalled();
      });

      it("calls afterPersist hook", async () => {
        const events: Event<string>[] = [
          {
            aggregateId: "test-1",
            tenantId: createTenantId("test-tenant"),
            timestamp: 1000,
            type: "lw.obs.span.ingestion.recorded",
            data: {},
          },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          tenantId: createTenantId("test-tenant"),
          version: 1000,
          data: {},
        } satisfies Projection<string>;

        const afterPersist = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
          serviceOptions: { hooks: { afterPersist } },
        });

        await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(afterPersist).toHaveBeenCalled();
      });

      it("calls hooks in correct order", async () => {
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

        const callOrder: string[] = [];
        const beforeHandle = vi.fn(() => {
          callOrder.push("beforeHandle");
        });
        const afterHandle = vi.fn(() => {
          callOrder.push("afterHandle");
        });
        const beforePersist = vi.fn(() => {
          callOrder.push("beforePersist");
        });
        const afterPersist = vi.fn(() => {
          callOrder.push("afterPersist");
        });

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockImplementation(() => {
          callOrder.push("handle");
          return Promise.resolve(projection);
        });
        vi.mocked(mockProjectionStore.storeProjection).mockImplementation(
          () => {
            callOrder.push("storeProjection");
            return Promise.resolve();
          },
        );

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
          serviceOptions: {
            hooks: { beforeHandle, afterHandle, beforePersist, afterPersist },
          },
        });

        await service.rebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(callOrder).toEqual([
          "beforeHandle",
          "handle",
          "afterHandle",
          "beforePersist",
          "storeProjection",
          "afterPersist",
        ]);
      });
    });

    describe("when eventHandler throws", () => {
      it("propagates error", async () => {
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
        });

        await expect(
          service.rebuildProjection("test-1", {
            eventStoreContext: { tenantId: createTenantId("test-tenant") },
          }),
        ).rejects.toThrow("Handler failed");
      });
    });

    describe("tenantId validation", () => {
      it("rejects operations without eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.rebuildProjection("test-1", {} as any),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjection requires eventStoreContext with tenantId",
        );
      });

      it("rejects operations with empty tenantId in eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.rebuildProjection("test-1", {
            eventStoreContext: { tenantId: "" } as any,
          }),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjection requires a non-empty tenantId for tenant isolation",
        );
      });
    });
  });

  describe("getProjection", () => {
    describe("when projection exists", () => {
      it("returns existing projection", async () => {
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          tenantId,
          version: 1000,
          data: {},
        };

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(
          projection,
        );

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const result = await service.getProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(projection);
      });
    });

    describe("when projection does not exist", () => {
      it("rebuilds and returns new projection", async () => {
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

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(null);
        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const result = await service.getProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(projection);
      });
    });

    describe("tenantId validation", () => {
      it("rejects operations without context", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.getProjection("test-1", {} as any),
        ).rejects.toThrow(
          "[SECURITY] getProjection requires context with tenantId",
        );
      });

      it("rejects operations with empty tenantId in context", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.getProjection("test-1", {
            eventStoreContext: { tenantId: "" } as any,
          }),
        ).rejects.toThrow(
          "[SECURITY] getProjection requires a non-empty tenantId for tenant isolation",
        );
      });
    });
  });

  describe("hasProjection", () => {
    describe("when projection exists", () => {
      it("returns true", async () => {
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          tenantId,
          version: 1000,
          data: {},
        };

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(
          projection,
        );

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const result = await service.hasProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(true);
      });
    });

    describe("when projection does not exist", () => {
      it("returns false", async () => {
        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(null);

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const result = await service.hasProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(false);
      });
    });

    describe("tenantId validation", () => {
      it("rejects operations without context", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.getProjection("test-1", {} as any),
        ).rejects.toThrow(
          "[SECURITY] getProjection requires context with tenantId",
        );
      });

      it("rejects operations with empty tenantId in context", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.hasProjection("test-1", {
            eventStoreContext: { tenantId: "" } as any,
          }),
        ).rejects.toThrow(
          "[SECURITY] hasProjection requires a non-empty tenantId for tenant isolation",
        );
      });
    });
  });

  describe("forceRebuildProjection", () => {
    describe("when called", () => {
      it("always rebuilds regardless of existing projection", async () => {
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
        });

        const result = await service.forceRebuildProjection("test-1", {
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(result).toBe(projection);
      });
    });

    describe("tenantId validation", () => {
      it("rejects operations without eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.forceRebuildProjection("test-1", {} as any),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjection requires eventStoreContext with tenantId",
        );
      });

      it("rejects operations with empty tenantId in eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.forceRebuildProjection("test-1", {
            eventStoreContext: { tenantId: "" } as any,
          }),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjection requires a non-empty tenantId for tenant isolation",
        );
      });
    });
  });

  describe("rebuildProjectionsInBatches", () => {
    describe("when no aggregates are returned", () => {
      it("returns checkpoint with zero processed", async () => {
        vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
          aggregateIds: [],
        });

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const checkpoint = await service.rebuildProjectionsInBatches({
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(checkpoint.processedCount).toBe(0);
      });
    });

    describe("when aggregates are returned", () => {
      it("rebuilds projections for each aggregate", async () => {
        vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
          aggregateIds: ["agg-1", "agg-2"],
        });

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const rebuildSpy = vi
          .spyOn(service, "rebuildProjection")
          .mockResolvedValue({
            id: "proj",
            aggregateId: "agg-1",
            tenantId,
            version: 1,
            data: {},
          });

        const checkpoint = await service.rebuildProjectionsInBatches({
          batchSize: 10,
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(rebuildSpy).toHaveBeenCalledTimes(2);
        expect(checkpoint.processedCount).toBe(2);
      });
    });

    describe("when onProgress is provided", () => {
      it("calls onProgress with updated checkpoint", async () => {
        vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
          aggregateIds: ["agg-1"],
        });

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        vi.spyOn(service, "rebuildProjection").mockResolvedValue({
          id: "proj",
          aggregateId: "agg-1",
          tenantId,
          version: 1,
          data: {},
        });

        const onProgress = vi.fn();

        const checkpoint = await service.rebuildProjectionsInBatches({
          onProgress,
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith({
          checkpoint: {
            cursor: undefined,
            lastAggregateId: "agg-1",
            processedCount: 1,
          },
        });
        expect(checkpoint.processedCount).toBe(1);
      });
    });

    describe("when resumeFrom checkpoint is provided", () => {
      it("continues from previous processedCount and cursor", async () => {
        vi.mocked(mockEventStore.listAggregateIds).mockResolvedValue({
          aggregateIds: ["agg-2", "agg-3"],
          nextCursor: undefined,
        });

        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        const rebuildSpy = vi
          .spyOn(service, "rebuildProjection")
          .mockResolvedValue({
            id: "proj",
            aggregateId: "agg-2",
            tenantId,
            version: 1,
            data: {},
          });

        const checkpoint = await service.rebuildProjectionsInBatches({
          resumeFrom: {
            cursor: "cursor-1",
            lastAggregateId: "agg-1",
            processedCount: 5,
          },
          eventStoreContext: { tenantId: createTenantId("test-tenant") },
        });

        expect(mockEventStore.listAggregateIds).toHaveBeenCalledWith(
          { tenantId: createTenantId("test-tenant") },
          "trace",
          "cursor-1",
          100,
        );
        expect(rebuildSpy).toHaveBeenCalledTimes(2);
        expect(checkpoint.processedCount).toBe(7);
        expect(checkpoint.lastAggregateId).toBe("agg-3");
        expect(checkpoint.cursor).toBeUndefined();
      });
    });

    describe("tenantId validation", () => {
      it("rejects operations without eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.rebuildProjectionsInBatches({} as any),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjectionsInBatches requires eventStoreContext with tenantId",
        );
      });

      it("rejects operations with empty tenantId in eventStoreContext", async () => {
        const service = new EventSourcingService({
          aggregateType: "trace",
          eventStore: mockEventStore,
          projectionStore: mockProjectionStore,
          eventHandler: mockEventHandler,
        });

        await expect(
          service.rebuildProjectionsInBatches({
            eventStoreContext: { tenantId: "" } as any,
          }),
        ).rejects.toThrow(
          "[SECURITY] rebuildProjectionsInBatches requires a non-empty tenantId for tenant isolation",
        );
      });
    });
  });
});
