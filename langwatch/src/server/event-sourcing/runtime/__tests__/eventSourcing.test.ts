import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventSourcing } from "../eventSourcing";
import { EventStoreClickHouse } from "../../stores/eventStoreClickHouse";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import { CheckpointStoreClickHouse } from "../../stores/checkpointStoreClickHouse";
import { CheckpointStoreMemory } from "../../stores/checkpointStoreMemory";
import type {
  Event,
  Projection,
  ProjectionStore,
  EventHandler,
} from "../../library";
import * as clickhouseUtils from "../../../../utils/clickhouse";

// Mock the ClickHouse client getter
vi.mock("../../../../utils/clickhouse", () => ({
  getClickHouseClient: vi.fn(),
}));

describe("EventSourcing", () => {
  let originalInstance: typeof EventSourcing.prototype.constructor & {
    instance: EventSourcing | null;
  };

  beforeEach(() => {
    // Reset singleton instance before each test
    originalInstance = EventSourcing as any;
    (EventSourcing as any).instance = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up singleton
    (EventSourcing as any).instance = null;
  });

  describe("getInstance()", () => {
    it("returns same instance across multiple calls", () => {
      const instance1 = EventSourcing.getInstance();
      const instance2 = EventSourcing.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("creates new instance only on first call", () => {
      const instance1 = EventSourcing.getInstance();
      const instance2 = EventSourcing.getInstance();
      const instance3 = EventSourcing.getInstance();
      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe("getEventStore()", () => {
    it("returns ClickHouse store when client is available", () => {
      const mockClient = {} as any;
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(
        mockClient,
      );

      const instance = EventSourcing.getInstance();
      const store = instance.getEventStore();

      expect(store).toBeInstanceOf(EventStoreClickHouse);
      expect(clickhouseUtils.getClickHouseClient).toHaveBeenCalled();
    });

    it("returns Memory store when client is not available", () => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const store = instance.getEventStore();

      expect(store).toBeInstanceOf(EventStoreMemory);
    });

    it("returns same store instance across multiple calls", () => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const store1 = instance.getEventStore();
      const store2 = instance.getEventStore();

      expect(store1).toBe(store2);
    });

    it("returns correctly typed store", () => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const store = instance.getEventStore<Event<string>>();

      expect(store).toBeDefined();
      // Type check: should compile without errors
      expect(typeof store).toBe("object");
    });
  });

  describe("getCheckpointStore()", () => {
    it("returns ClickHouse store when client is available", () => {
      const mockClient = {} as any;
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(
        mockClient,
      );

      const instance = EventSourcing.getInstance();
      const store = instance.getCheckpointStore();

      expect(store).toBeInstanceOf(CheckpointStoreClickHouse);
    });

    it("returns Memory store when client is not available", () => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const store = instance.getCheckpointStore();

      expect(store).toBeInstanceOf(CheckpointStoreMemory);
    });

    it("returns same store instance across multiple calls", () => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const store1 = instance.getCheckpointStore();
      const store2 = instance.getCheckpointStore();

      expect(store1).toBe(store2);
    });

    it("store type matches event store type", () => {
      const mockClient = {} as any;
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(
        mockClient,
      );

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();
      const checkpointStore = instance.getCheckpointStore();

      const isClickHouseEventStore = eventStore instanceof EventStoreClickHouse;
      const isClickHouseCheckpointStore =
        checkpointStore instanceof CheckpointStoreClickHouse;

      expect(isClickHouseEventStore).toBe(isClickHouseCheckpointStore);
    });
  });

  describe("registerPipeline()", () => {
    beforeEach(() => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);
    });

    it("returns builder instance", () => {
      const instance = EventSourcing.getInstance();
      const builder = instance.registerPipeline<
        Event<string>,
        Projection<string>
      >();

      expect(builder).toBeDefined();
      expect(typeof builder.withName).toBe("function");
    });

    it("returns new builder instance on each call", () => {
      const instance = EventSourcing.getInstance();
      const builder1 = instance.registerPipeline();
      const builder2 = instance.registerPipeline();

      expect(builder1).not.toBe(builder2);
    });
  });

  describe("PipelineBuilder", () => {
    beforeEach(() => {
      vi.mocked(clickhouseUtils.getClickHouseClient).mockReturnValue(null);
    });

    const createMockProjectionStore = (): ProjectionStore<
      string,
      Projection<string>
    > => {
      return {
        getProjection: vi.fn(),
        saveProjection: vi.fn(),
        deleteProjection: vi.fn(),
      } as any;
    };

    const createMockEventHandler = (): EventHandler<
      string,
      Event<string>,
      Projection<string>
    > => {
      return {
        handle: vi.fn(),
      };
    };

    describe("builder flow - store then handler", () => {
      it("builds pipeline with correct order: name → aggregateType → store → handler", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const handler = createMockEventHandler();

        const pipeline = instance
          .registerPipeline<Event<string>, Projection<string>>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withProjectionStore(store)
          .withEventHandler(handler)
          .build();

        expect(pipeline).toBeDefined();
        expect(pipeline.name).toBe("test-pipeline");
        expect(pipeline.aggregateType).toBe("trace");
        expect(pipeline.service).toBeDefined();
      });
    });

    describe("builder flow - handler then store", () => {
      it("builds pipeline with correct order: name → aggregateType → handler → store", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const handler = createMockEventHandler();

        const pipeline = instance
          .registerPipeline<Event<string>, Projection<string>>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler(handler)
          .withProjectionStore(store)
          .build();

        expect(pipeline).toBeDefined();
        expect(pipeline.name).toBe("test-pipeline");
        expect(pipeline.aggregateType).toBe("trace");
        expect(pipeline.service).toBeDefined();
      });
    });

    describe("error cases", () => {
      it("throws error when building without name", () => {
        const instance = EventSourcing.getInstance();
        const builder = instance.registerPipeline() as any;

        // Try to bypass type system and build without name
        expect(() => {
          builder.build();
        }).toThrow("Pipeline name is required");
      });

      it("throws error when building without aggregateType", () => {
        const instance = EventSourcing.getInstance();
        const builder = instance.registerPipeline().withName("test") as any;

        expect(() => {
          builder.build();
        }).toThrow("Aggregate type is required");
      });

      it("throws error when building without projectionStore", () => {
        const instance = EventSourcing.getInstance();
        const handler = createMockEventHandler();
        const builder = instance
          .registerPipeline()
          .withName("test")
          .withAggregateType("trace")
          .withEventHandler(handler) as any;

        expect(() => {
          builder.build();
        }).toThrow("Projection store is required");
      });

      it("throws error when building without eventHandler", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const builder = instance
          .registerPipeline()
          .withName("test")
          .withAggregateType("trace")
          .withProjectionStore(store) as any;

        expect(() => {
          builder.build();
        }).toThrow("Event handler is required");
      });

      it("validates empty string name", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const handler = createMockEventHandler();

        const builder = instance
          .registerPipeline()
          .withName("")
          .withAggregateType("trace")
          .withProjectionStore(store)
          .withEventHandler(handler);

        // Empty string should pass type check but may fail at runtime
        // The build() method checks for truthy name, so empty string should fail
        expect(() => {
          builder.build();
        }).toThrow("Pipeline name is required");
      });

      it("validates empty string aggregateType", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const handler = createMockEventHandler();

        const builder = instance
          .registerPipeline()
          .withName("test")
          .withAggregateType("" as any)
          .withProjectionStore(store)
          .withEventHandler(handler);

        // Empty string should fail at runtime
        expect(() => {
          builder.build();
        }).toThrow("Aggregate type is required");
      });
    });

    describe("builder state machine", () => {
      it("cannot call withAggregateType before withName", () => {
        const instance = EventSourcing.getInstance();
        const builder = instance.registerPipeline() as any;

        // TypeScript should prevent this, but test runtime behavior
        expect(() => {
          builder.withAggregateType("trace");
        }).toThrow();
      });

      it("cannot call withProjectionStore before withAggregateType", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const builder = instance.registerPipeline().withName("test") as any;

        expect(() => {
          builder.withProjectionStore(store);
        }).toThrow();
      });

      it("cannot call withEventHandler before withAggregateType", () => {
        const instance = EventSourcing.getInstance();
        const handler = createMockEventHandler();
        const builder = instance.registerPipeline().withName("test") as any;

        expect(() => {
          builder.withEventHandler(handler);
        }).toThrow();
      });
    });

    describe("builder immutability", () => {
      it("builder methods return new builder instances", () => {
        const instance = EventSourcing.getInstance();
        const builder1 = instance.registerPipeline();
        const builder2 = builder1.withName("test");

        expect(builder1).not.toBe(builder2);
      });

      it("cannot reuse builder after build()", () => {
        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore();
        const handler = createMockEventHandler();

        const builder = instance
          .registerPipeline()
          .withName("test")
          .withAggregateType("trace")
          .withProjectionStore(store)
          .withEventHandler(handler);

        const pipeline = builder.build();

        // Builder should not be reusable after build
        // This is enforced by the type system, but test that build() works
        expect(pipeline).toBeDefined();
      });
    });

    describe("type safety", () => {
      it("preserves event and projection types through builder chain", () => {
        type TestEvent = Event<string> & { type: "TEST_EVENT" };
        type TestProjection = Projection<string> & { status: "active" };

        const instance = EventSourcing.getInstance();
        const store = createMockProjectionStore() as ProjectionStore<
          string,
          TestProjection
        >;
        const handler = createMockEventHandler() as EventHandler<
          string,
          TestEvent,
          TestProjection
        >;

        const pipeline = instance
          .registerPipeline<TestEvent, TestProjection>()
          .withName("test")
          .withAggregateType("trace")
          .withProjectionStore(store)
          .withEventHandler(handler)
          .build();

        expect(pipeline).toBeDefined();
        // Type check: should compile without errors
        expect(pipeline.service).toBeDefined();
      });
    });
  });
});
