import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import { DisabledPipeline } from "../../disabledPipeline";
import { EventSourcing } from "../../eventSourcing";
import { createMockEventStore } from "../../services/__tests__/testHelpers";
import { EventStoreMemory } from "../../stores/eventStoreMemory";

/**
 * Creates a minimal static pipeline definition for testing.
 */
function createTestPipelineDefinition() {
  return definePipeline<Event>()
    .withName("test-pipeline")
    .withAggregateType("trace")
    .build();
}

describe("EventSourcing", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("ENABLE_EVENT_SOURCING", "true");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("creates with default options (enabled, no clients)", () => {
      const es = new EventSourcing();

      expect(es.isEnabled).toBe(true);
    });

    it("creates disabled when enabled is false", () => {
      const es = new EventSourcing({ enabled: false });

      expect(es.isEnabled).toBe(false);
    });

    it("uses memory event store when no clickhouse provided in non-production", () => {
      const es = new EventSourcing();
      const eventStore = es.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });
  });

  describe("createForTesting", () => {
    it("uses injected event store", () => {
      const mockEventStore = createMockEventStore<Event>();
      const es = EventSourcing.createForTesting({
        eventStore: mockEventStore,
      });

      expect(es.getEventStore()).toBe(mockEventStore);
      expect(es.isEnabled).toBe(true);
    });

    it("returns enabled status", () => {
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });

      expect(es.isEnabled).toBe(true);
    });
  });

  describe("createWithStores", () => {
    it("uses injected event store and global queue", () => {
      const mockEventStore = createMockEventStore<Event>();
      const mockGlobalQueue = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };
      const es = EventSourcing.createWithStores({
        eventStore: mockEventStore,
        globalQueue: mockGlobalQueue,
      });

      expect(es.getEventStore()).toBe(mockEventStore);
    });
  });

  describe("getEventStore", () => {
    it("returns the same event store instance on multiple calls", () => {
      const mockEventStore = createMockEventStore<Event>();
      const es = EventSourcing.createForTesting({
        eventStore: mockEventStore,
      });

      expect(es.getEventStore()).toBe(mockEventStore);
      expect(es.getEventStore()).toBe(mockEventStore);
      expect(es.getEventStore()).toBe(mockEventStore);
    });

    it("preserves type casting for generic EventType", () => {
      interface TestEvent extends Event {
        data: { test: string };
      }

      const mockEventStore = createMockEventStore<TestEvent>();
      const es = EventSourcing.createForTesting({
        eventStore: mockEventStore,
      });

      const eventStore = es.getEventStore<TestEvent>();
      expect(eventStore).toBe(mockEventStore);
    });
  });

  describe("register", () => {
    it("returns a DisabledPipeline when no event store available", () => {
      const es = EventSourcing.createForTesting({
        eventStore: void 0,
      });

      const pipeline = es.register(createTestPipelineDefinition());

      expect(pipeline).toBeInstanceOf(DisabledPipeline);
    });

    it("registers a pipeline with a static definition", () => {
      const mockEventStore = createMockEventStore<Event>();
      const es = EventSourcing.createForTesting({
        eventStore: mockEventStore,
      });

      const pipeline = es.register(createTestPipelineDefinition());

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("trace");
    });
  });

  describe("close", () => {
    it("clears all registered pipelines", async () => {
      const mockEventStore = createMockEventStore<Event>();
      const es = EventSourcing.createForTesting({
        eventStore: mockEventStore,
      });

      es.register(createTestPipelineDefinition());
      await es.close();

      expect(() => es.getPipeline("test-pipeline")).toThrow(
        'Pipeline "test-pipeline" not found',
      );
    });
  });

  describe("getPipeline", () => {
    it("throws when pipeline not registered", () => {
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });

      expect(() => es.getPipeline("nonexistent")).toThrow(
        'Pipeline "nonexistent" not found',
      );
    });

    it("returns a registered pipeline", () => {
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
      });

      es.register(createTestPipelineDefinition());
      const pipeline = es.getPipeline("test-pipeline");

      expect(pipeline.name).toBe("test-pipeline");
    });
  });
});
