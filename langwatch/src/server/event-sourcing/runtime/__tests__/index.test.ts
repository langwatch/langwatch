import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateType, Event, Projection } from "../../library";
import { EventSourcingService } from "../../library";
import type { FoldProjectionDefinition } from "../../library/projections/foldProjection.types";
import type { MapProjectionDefinition } from "../../library/projections/mapProjection.types";
import {
  createMockEventPublisher,
  createMockEventStore,
  createTestAggregateType,
} from "../../library/services/__tests__/testHelpers";
import { EventSourcingPipeline } from "../pipeline";
import type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "../pipeline/types";

describe("EventSourcingPipeline", () => {
  let mockEventStore: ReturnType<typeof createMockEventStore<Event>>;
  let aggregateType: AggregateType;

  beforeEach(() => {
    mockEventStore = createMockEventStore<Event>();
    aggregateType = createTestAggregateType();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates instance with correct name property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.name).toBe("test-pipeline");
    });

    it("creates instance with correct aggregateType property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.aggregateType).toBe(aggregateType);
    });

    it("creates instance with service property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });

    it("creates service with all optional fields when provided", () => {
      const mockFoldProjection: FoldProjectionDefinition<any, Event> = {
        name: "test-fold",
        version: "2025-01-01",
        eventTypes: ["test.event"],
        init: () => ({}),
        apply: (state) => state,
        store: { store: vi.fn(), get: vi.fn(), storeBatch: vi.fn() },
      };

      const mockMapProjection: MapProjectionDefinition<any, Event> = {
        name: "test-map",
        eventTypes: ["test.event"],
        map: () => ({}),
        store: { append: vi.fn() },
      };

      const eventPublisher = createMockEventPublisher<Event>();

      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
        foldProjections: [mockFoldProjection],
        mapProjections: [mockMapProjection],
        eventPublisher,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });
  });

  describe("readonly property enforcement", () => {
    it("prevents reassignment of name property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const originalName = pipeline.name;

      try {
        (pipeline as unknown as { name: string }).name = "new-name";
      } catch {
        // Expected in strict mode
      }

      expect(pipeline.name).toBe(originalName);
    });

    it("prevents reassignment of aggregateType property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const originalAggregateType = pipeline.aggregateType;

      try {
        (
          pipeline as unknown as { aggregateType: AggregateType }
        ).aggregateType = "new-type" as AggregateType;
      } catch {
        // Expected in strict mode
      }

      expect(pipeline.aggregateType).toBe(originalAggregateType);
    });

    it("prevents reassignment of service property", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const originalService = pipeline.service;

      try {
        (
          pipeline as unknown as { service: EventSourcingService<Event> }
        ).service = {} as EventSourcingService<Event>;
      } catch {
        // Expected in strict mode
      }

      expect(pipeline.service).toBe(originalService);
    });

    it("makes properties enumerable", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const keys = Object.keys(pipeline);

      expect(keys).toContain("name");
      expect(keys).toContain("aggregateType");
      expect(keys).toContain("service");
    });

    it("makes properties non-configurable", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const descriptor = Object.getOwnPropertyDescriptor(pipeline, "name");

      expect(descriptor?.configurable).toBe(false);
    });

    it("makes properties non-writable", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);
      const nameDescriptor = Object.getOwnPropertyDescriptor(pipeline, "name");
      const aggregateTypeDescriptor = Object.getOwnPropertyDescriptor(
        pipeline,
        "aggregateType",
      );
      const serviceDescriptor = Object.getOwnPropertyDescriptor(
        pipeline,
        "service",
      );

      expect(nameDescriptor?.writable).toBe(false);
      expect(aggregateTypeDescriptor?.writable).toBe(false);
      expect(serviceDescriptor?.writable).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("works with minimal definition containing only required fields", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "minimal-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.name).toBe("minimal-pipeline");
      expect(pipeline.aggregateType).toBe(aggregateType);
      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });

    it("works with full definition containing all optional fields", () => {
      const mockFoldProjection: FoldProjectionDefinition<any, Event> = {
        name: "test-fold",
        version: "2025-01-01",
        eventTypes: ["test.event"],
        init: () => ({}),
        apply: (state) => state,
        store: { store: vi.fn(), get: vi.fn(), storeBatch: vi.fn() },
      };

      const mockMapProjection: MapProjectionDefinition<any, Event> = {
        name: "test-map",
        eventTypes: ["test.event"],
        map: () => ({}),
        store: { append: vi.fn() },
      };

      const eventPublisher = createMockEventPublisher<Event>();

      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "full-pipeline",
        aggregateType,
        eventStore: mockEventStore,
        foldProjections: [mockFoldProjection],
        mapProjections: [mockMapProjection],
        eventPublisher,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.name).toBe("full-pipeline");
      expect(pipeline.aggregateType).toBe(aggregateType);
      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });

    it("works with generic EventType", () => {
      interface TestEvent extends Event {
        data: { test: string };
      }

      const testEventStore = createMockEventStore<TestEvent>();

      const definition: EventSourcingPipelineDefinition<TestEvent> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: testEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });

    it("works with generic ProjectionTypes", () => {
      interface TestProjection extends Projection {
        data: { result: number };
      }

      const definition: EventSourcingPipelineDefinition<
        Event,
        { testProjection: TestProjection }
      > = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
    });

    it("creates different service instances for different pipelines", () => {
      const definition1: EventSourcingPipelineDefinition<Event> = {
        name: "pipeline-1",
        aggregateType,
        eventStore: mockEventStore,
      };

      const definition2: EventSourcingPipelineDefinition<Event> = {
        name: "pipeline-2",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline1 = new EventSourcingPipeline(definition1);
      const pipeline2 = new EventSourcingPipeline(definition2);

      expect(pipeline1.service).not.toBe(pipeline2.service);
      expect(pipeline1.name).not.toBe(pipeline2.name);
    });
  });

  describe("RegisteredPipeline interface compliance", () => {
    it("implements RegisteredPipeline interface correctly", () => {
      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
      };

      const pipeline = new EventSourcingPipeline(definition);

      // Type check: pipeline should be assignable to RegisteredPipeline
      const registeredPipeline: RegisteredPipeline<Event> = pipeline;

      expect(registeredPipeline.name).toBe("test-pipeline");
      expect(registeredPipeline.aggregateType).toBe(aggregateType);
      expect(registeredPipeline.service).toBeInstanceOf(EventSourcingService);
    });
  });
});
