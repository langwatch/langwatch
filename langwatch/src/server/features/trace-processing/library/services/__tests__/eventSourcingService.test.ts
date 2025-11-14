/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { EventStore } from "../../stores/eventStore";
import type { ProjectionStore } from "../../stores/projectionStore";
import type { EventHandler } from "../../processing/eventHandler";
import type { Event, Projection } from "../../core/types";

describe("EventSourcingService", () => {
  let mockEventStore: EventStore<string, Event<string>>;
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

  describe("rebuildProjection", () => {
    describe("when events exist", () => {
      it("rebuilds projection and stores it", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.rebuildProjection("test-1");

        expect(result).toBe(projection);
      });
    });

    describe("when hooks are configured", () => {
      it("calls beforeHandle hook", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        const beforeHandle = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
          { hooks: { beforeHandle } },
        );

        await service.rebuildProjection("test-1");

        expect(beforeHandle).toHaveBeenCalled();
      });

      it("calls afterHandle hook", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        const afterHandle = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
          { hooks: { afterHandle } },
        );

        await service.rebuildProjection("test-1");

        expect(afterHandle).toHaveBeenCalled();
      });

      it("calls beforePersist hook", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        const beforePersist = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
          { hooks: { beforePersist } },
        );

        await service.rebuildProjection("test-1");

        expect(beforePersist).toHaveBeenCalled();
      });

      it("calls afterPersist hook", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        const afterPersist = vi.fn();

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
          { hooks: { afterPersist } },
        );

        await service.rebuildProjection("test-1");

        expect(afterPersist).toHaveBeenCalled();
      });

      it("calls hooks in correct order", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
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
        vi.mocked(mockProjectionStore.storeProjection).mockImplementation(() => {
          callOrder.push("storeProjection");
          return Promise.resolve();
        });

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
          { hooks: { beforeHandle, afterHandle, beforePersist, afterPersist } },
        );

        await service.rebuildProjection("test-1");

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
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockRejectedValue(
          new Error("Handler failed"),
        );

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        await expect(service.rebuildProjection("test-1")).rejects.toThrow(
          "Handler failed",
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
          version: 1000,
          data: {},
        };

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(
          projection,
        );

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.getProjection("test-1");

        expect(result).toBe(projection);
      });
    });

    describe("when projection does not exist", () => {
      it("rebuilds and returns new projection", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(null);
        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.getProjection("test-1");

        expect(result).toBe(projection);
      });
    });
  });

  describe("hasProjection", () => {
    describe("when projection exists", () => {
      it("returns true", async () => {
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(
          projection,
        );

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.hasProjection("test-1");

        expect(result).toBe(true);
      });
    });

    describe("when projection does not exist", () => {
      it("returns false", async () => {
        vi.mocked(mockProjectionStore.getProjection).mockResolvedValue(null);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.hasProjection("test-1");

        expect(result).toBe(false);
      });
    });
  });

  describe("forceRebuildProjection", () => {
    describe("when called", () => {
      it("always rebuilds regardless of existing projection", async () => {
        const events: Event<string>[] = [
          { aggregateId: "test-1", timestamp: 1000, type: "CREATE", data: {} },
        ];
        const projection: Projection<string> = {
          id: "proj-1",
          aggregateId: "test-1",
          version: 1000,
          data: {},
        };

        vi.mocked(mockEventStore.getEvents).mockResolvedValue(events);
        vi.mocked(mockEventHandler.handle).mockResolvedValue(projection);

        const service = new EventSourcingService(
          mockEventStore,
          mockProjectionStore,
          mockEventHandler,
        );

        const result = await service.forceRebuildProjection("test-1");

        expect(result).toBe(projection);
      });
    });
  });
});
