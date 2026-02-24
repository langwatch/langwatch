import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectionRegistry } from "../projectionRegistry";
import { ConfigurationError } from "../../services/errorHandling";
import {
  createMockFoldProjectionDefinition,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { Event } from "../../domain/types";
import type { EventSourcedQueueProcessor, QueueProcessorFactory } from "../../queues";
import type { ReactorDefinition } from "../../reactors/reactor.types";

function createMockQueueFactory(): QueueProcessorFactory {
  return {
    create: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue(void 0),
      sendBatch: vi.fn().mockResolvedValue(void 0),
      close: vi.fn().mockResolvedValue(void 0),
      waitUntilReady: vi.fn().mockResolvedValue(void 0),
    } satisfies EventSourcedQueueProcessor<any>),
  };
}

function createMockReactor(name: string): ReactorDefinition<Event> {
  return {
    name,
    handle: vi.fn().mockResolvedValue(void 0),
  };
}

describe("ProjectionRegistry", () => {
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("registerFoldProjection", () => {
    describe("when projection is registered", () => {
      it("registers successfully", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");

        expect(() => registry.registerFoldProjection(fold)).not.toThrow();
      });
    });

    describe("when projection name is duplicate", () => {
      it("throws ConfigurationError", () => {
        const registry = new ProjectionRegistry();
        const fold1 = createMockFoldProjectionDefinition("sameName");
        const fold2 = createMockFoldProjectionDefinition("sameName");

        registry.registerFoldProjection(fold1);
        expect(() => registry.registerFoldProjection(fold2)).toThrow(
          /already registered/,
        );
      });
    });
  });

  describe("registerMapProjection", () => {
    it("registers successfully", () => {
      const registry = new ProjectionRegistry();
      const mapProj = createMockMapProjectionDefinition("myMap");

      expect(() => registry.registerMapProjection(mapProj)).not.toThrow();
    });

    describe("when projection name is duplicate", () => {
      it("throws ConfigurationError", () => {
        const registry = new ProjectionRegistry();
        const map1 = createMockMapProjectionDefinition("sameName");
        const map2 = createMockMapProjectionDefinition("sameName");

        registry.registerMapProjection(map1);
        expect(() => registry.registerMapProjection(map2)).toThrow(
          /already registered/,
        );
      });
    });
  });

  describe("initialize", () => {
    describe("when called twice without close", () => {
      it("throws ConfigurationError", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);

        const queueFactory = createMockQueueFactory();
        registry.initialize(queueFactory);

        expect(() => registry.initialize(queueFactory)).toThrow(
          /Already initialized/,
        );
      });
    });

    describe("when called after close", () => {
      it("re-initializes successfully", async () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);

        const queueFactory = createMockQueueFactory();
        registry.initialize(queueFactory);
        await registry.close();

        expect(() => registry.initialize(queueFactory)).not.toThrow();
      });
    });
  });

  describe("dispatch", () => {
    describe("when not initialized", () => {
      it("logs warning and drops events", async () => {
        const registry = new ProjectionRegistry();
        const events = [
          createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          ),
        ];

        // Does not throw, just warns
        await expect(
          registry.dispatch(events, { tenantId }),
        ).resolves.not.toThrow();
      });
    });

    describe("when initialized with fold projection", () => {
      it("dispatches events to projections via queues", async () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");

        registry.registerFoldProjection(fold);

        const queueFactory = createMockQueueFactory();
        registry.initialize(queueFactory);

        const events = [
          createTestEvent(
            TEST_CONSTANTS.AGGREGATE_ID,
            TEST_CONSTANTS.AGGREGATE_TYPE,
            tenantId,
          ),
        ];

        await registry.dispatch(events, { tenantId });

        // Queue factory should have created queues for the fold projection
        expect(queueFactory.create).toHaveBeenCalled();
      });
    });
  });

  describe("registerReactor", () => {
    describe("when fold exists", () => {
      it("registers successfully", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);

        const reactor = createMockReactor("myReactor");
        expect(() => registry.registerReactor("myFold", reactor)).not.toThrow();
      });
    });

    describe("when fold does not exist", () => {
      it("throws immediately", () => {
        const registry = new ProjectionRegistry();
        const reactor = createMockReactor("myReactor");

        expect(() => registry.registerReactor("missingFold", reactor)).toThrow(
          /fold "missingFold" — fold not registered/,
        );
      });
    });

    describe("when reactor name is duplicate", () => {
      it("throws ConfigurationError", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);

        const reactor1 = createMockReactor("sameName");
        const reactor2 = createMockReactor("sameName");

        registry.registerReactor("myFold", reactor1);
        expect(() => registry.registerReactor("myFold", reactor2)).toThrow(
          /already registered/,
        );
      });
    });
  });

  describe("hasProjections", () => {
    describe("when reactors are registered alongside their folds", () => {
      it("returns true", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);
        registry.registerReactor("myFold", createMockReactor("myReactor"));

        expect(registry.hasProjections).toBe(true);
      });
    });

    describe("when nothing is registered", () => {
      it("returns false", () => {
        const registry = new ProjectionRegistry();
        expect(registry.hasProjections).toBe(false);
      });
    });
  });

  describe("initialize with reactors", () => {
    describe("when reactors are registered", () => {
      it("creates reactor queues", () => {
        const registry = new ProjectionRegistry();
        const fold = createMockFoldProjectionDefinition("myFold");
        registry.registerFoldProjection(fold);
        registry.registerReactor("myFold", createMockReactor("myReactor"));

        const queueFactory = createMockQueueFactory();
        expect(() => registry.initialize(queueFactory)).not.toThrow();

        // Queue factory should have been called for fold + reactor queues
        expect(queueFactory.create).toHaveBeenCalled();
      });
    });
  });

  describe("close", () => {
    it("closes queue manager when initialized", async () => {
      const registry = new ProjectionRegistry();
      const fold = createMockFoldProjectionDefinition("myFold");
      registry.registerFoldProjection(fold);

      const queueFactory = createMockQueueFactory();
      registry.initialize(queueFactory);

      await expect(registry.close()).resolves.not.toThrow();
    });

    it("does not throw when not initialized", async () => {
      const registry = new ProjectionRegistry();
      await expect(registry.close()).resolves.not.toThrow();
    });
  });
});
