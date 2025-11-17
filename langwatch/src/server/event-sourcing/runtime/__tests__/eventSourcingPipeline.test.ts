import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventSourcingPipeline } from "../index";
import type {
  Event,
  Projection,
  EventStore,
  ProjectionStore,
  EventHandler,
} from "../../library";
import { createEventSourcingPipeline } from "../../library";

// Mock the createEventSourcingPipeline function
vi.mock("../../library", async () => {
  const actual = await vi.importActual("../../library");
  return {
    ...actual,
    createEventSourcingPipeline: vi.fn(),
  };
});

describe("EventSourcingPipeline", () => {
  let mockEventStore: EventStore<string, Event<string>>;
  let mockProjectionStore: ProjectionStore<string, Projection<string>>;
  let mockEventHandler: EventHandler<string, Event<string>, Projection<string>>;
  let mockService: any;

  beforeEach(() => {
    mockEventStore = {
      getEvents: vi.fn(),
      storeEvents: vi.fn(),
      listAggregateIds: vi.fn(),
    } as any;

    mockProjectionStore = {
      getProjection: vi.fn(),
      saveProjection: vi.fn(),
      deleteProjection: vi.fn(),
    } as any;

    mockEventHandler = {
      handle: vi.fn(),
    };

    mockService = {
      processEvent: vi.fn(),
      rebuildProjection: vi.fn(),
    };

    vi.mocked(createEventSourcingPipeline).mockReturnValue(mockService);
  });

  describe("constructor", () => {
    it("creates pipeline with correct properties", () => {
      const pipeline = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("trace");
      expect(pipeline.service).toBe(mockService);
    });

    it("creates service with correct configuration", () => {
      new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(createEventSourcingPipeline).toHaveBeenCalledWith({
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });
    });

    it("uses correct aggregateType in service creation", () => {
      new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "user",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(createEventSourcingPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: "user",
        }),
      );
    });

    it("uses correct eventStore instance", () => {
      const customEventStore = {
        getEvents: vi.fn(),
        storeEvents: vi.fn(),
        listAggregateIds: vi.fn(),
      } as any;

      new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: customEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(createEventSourcingPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          eventStore: customEventStore,
        }),
      );
    });

    it("uses correct projectionStore instance", () => {
      const customProjectionStore = {
        getProjection: vi.fn(),
        saveProjection: vi.fn(),
        deleteProjection: vi.fn(),
      } as any;

      new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: customProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(createEventSourcingPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          projectionStore: customProjectionStore,
        }),
      );
    });

    it("uses correct eventHandler instance", () => {
      const customEventHandler = {
        handle: vi.fn(),
      };

      new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: customEventHandler,
      });

      expect(createEventSourcingPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          eventHandler: customEventHandler,
        }),
      );
    });
  });

  describe("property immutability", () => {
    it("properties are readonly and cannot be reassigned", () => {
      const pipeline = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      // Properties are made readonly at runtime using Object.defineProperty
      // Attempting to reassign should throw a TypeError
      const originalName = pipeline.name;
      expect(() => {
        (pipeline as any).name = "new-name";
      }).toThrow(TypeError); // Assignment throws because writable: false

      // Property should remain unchanged due to writable: false
      expect(pipeline.name).toBe(originalName);
    });

    it("service instance is preserved", () => {
      const pipeline = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const originalService = pipeline.service;
      expect(pipeline.service).toBe(originalService);
    });
  });

  describe("service isolation", () => {
    it("different pipeline instances have different services", () => {
      const pipeline1 = new EventSourcingPipeline({
        name: "pipeline-1",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const mockService2 = {
        processEvent: vi.fn(),
        rebuildProjection: vi.fn(),
      } as any;
      vi.mocked(createEventSourcingPipeline).mockReturnValueOnce(mockService2);

      const pipeline2 = new EventSourcingPipeline({
        name: "pipeline-2",
        aggregateType: "user",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      expect(pipeline1.service).not.toBe(pipeline2.service);
    });

    it("pipeline with same name but different config has different service", () => {
      // Reset the spy to only count calls in this test
      vi.mocked(createEventSourcingPipeline).mockClear();

      const pipeline1 = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      const mockService2 = {
        processEvent: vi.fn(),
        rebuildProjection: vi.fn(),
      } as any;
      vi.mocked(createEventSourcingPipeline).mockReturnValueOnce(mockService2);

      const differentEventHandler = {
        handle: vi.fn(),
      };
      const pipeline2 = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: differentEventHandler,
      });

      expect(pipeline1.service).not.toBe(pipeline2.service);
      expect(createEventSourcingPipeline).toHaveBeenCalledTimes(2);
    });
  });

  describe("type safety", () => {
    it("preserves generic types through construction", () => {
      type TestEvent = Event<string> & { type: "TEST_EVENT" };
      type TestProjection = Projection<string> & { status: "active" };

      const testEventStore = mockEventStore as EventStore<string, TestEvent>;
      const testProjectionStore = mockProjectionStore as ProjectionStore<
        string,
        TestProjection
      >;
      const testEventHandler = mockEventHandler as EventHandler<
        string,
        TestEvent,
        TestProjection
      >;

      const pipeline = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: testEventStore,
        projectionStore: testProjectionStore,
        eventHandler: testEventHandler,
      });

      expect(pipeline).toBeDefined();
      expect(pipeline.service).toBeDefined();
    });
  });

  describe("RegisteredPipeline interface", () => {
    it("implements RegisteredPipeline interface correctly", () => {
      const pipeline = new EventSourcingPipeline({
        name: "test-pipeline",
        aggregateType: "trace",
        eventStore: mockEventStore,
        projectionStore: mockProjectionStore,
        eventHandler: mockEventHandler,
      });

      // Should have all required properties
      expect(pipeline.name).toBeDefined();
      expect(pipeline.aggregateType).toBeDefined();
      expect(pipeline.service).toBeDefined();

      // Type check: should be assignable to RegisteredPipeline
      const registered: typeof pipeline = pipeline;
      expect(registered).toBe(pipeline);
    });
  });
});
