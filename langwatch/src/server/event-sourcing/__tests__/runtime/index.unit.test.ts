import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event, Projection } from "../../domain/types";
import type { EventSourcingPipelineDefinition } from "../../pipeline/types";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../../projections/mapProjection.types";
import { EventSourcingPipeline } from "../../runtimePipeline";
import {
  createMockEventStore,
  createTestAggregateType,
} from "../../services/__tests__/testHelpers";
import { EventSourcingService } from "../../services/eventSourcingService";

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
        store: { store: vi.fn(), get: vi.fn() },
      };

      const mockMapProjection: MapProjectionDefinition<any, Event> = {
        name: "test-map",
        eventTypes: ["test.event"],
        map: () => ({}),
        store: { append: vi.fn() },
      };

      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "test-pipeline",
        aggregateType,
        eventStore: mockEventStore,
        foldProjections: [mockFoldProjection],
        mapProjections: [mockMapProjection],
      };

      const pipeline = new EventSourcingPipeline(definition);

      expect(pipeline.service).toBeInstanceOf(EventSourcingService);
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
        store: { store: vi.fn(), get: vi.fn() },
      };

      const mockMapProjection: MapProjectionDefinition<any, Event> = {
        name: "test-map",
        eventTypes: ["test.event"],
        map: () => ({}),
        store: { append: vi.fn() },
      };

      const definition: EventSourcingPipelineDefinition<Event> = {
        name: "full-pipeline",
        aggregateType,
        eventStore: mockEventStore,
        foldProjections: [mockFoldProjection],
        mapProjections: [mockMapProjection],
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

});
