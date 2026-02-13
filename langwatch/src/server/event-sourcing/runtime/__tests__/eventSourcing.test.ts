import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to define the mock function so it's available when vi.mock runs
const { mockGetClickHouseClient } = vi.hoisted(() => ({
  mockGetClickHouseClient: vi.fn(),
}));

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: mockGetClickHouseClient,
}));

import type { ClickHouseClient } from "@clickhouse/client";
import type { Event } from "../../library";
import type { TenantId } from "../../library/domain/tenantId";
import { createMockEventStore } from "../../library/services/__tests__/testHelpers";
import { DisabledPipelineBuilder } from "../disabledPipeline";
import { EventSourcing } from "../eventSourcing";
import {
  EventSourcingRuntime,
  initializeEventSourcing,
  initializeEventSourcingForTesting,
  resetEventSourcingRuntime,
} from "../eventSourcingRuntime";
import { PipelineBuilder } from "../index";
import { EventStoreClickHouse } from "../stores/eventStoreClickHouse";
import { EventStoreMemory } from "../stores/eventStoreMemory";

describe("EventSourcing", () => {
  beforeEach(() => {
    // Reset singleton instances between tests
    EventSourcing.resetInstance();
    resetEventSourcingRuntime();

    // Disable BUILD_TIME to enable event sourcing in tests
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("ENABLE_EVENT_SOURCING", "true");
    vi.stubEnv("ENABLE_CLICKHOUSE", "true");
    vi.stubEnv("NODE_ENV", "test");

    // Reset the mock
    mockGetClickHouseClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // Reset singleton instances after each test
    EventSourcing.resetInstance();
    resetEventSourcingRuntime();
  });

  describe("getInstance", () => {
    it("returns the same singleton instance on multiple calls", () => {
      // Initialize with in-memory stores for testing
      initializeEventSourcingForTesting();

      const instance1 = EventSourcing.getInstance();
      const instance2 = EventSourcing.getInstance();
      const instance3 = EventSourcing.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it("creates Memory store when ClickHouse client is not available", () => {
      // Initialize with null client (uses memory store)
      initializeEventSourcing({ clickHouseClient: null, redisConnection: null });

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });

    it("creates ClickHouse store when client is available", () => {
      const mockClient = {} as ClickHouseClient;
      // Initialize with mock ClickHouse client
      initializeEventSourcing({
        clickHouseClient: mockClient,
        redisConnection: null,
      });

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreClickHouse);
    });

    it("returns the same event store instance across multiple getInstance calls", () => {
      // Initialize with in-memory stores for testing
      initializeEventSourcingForTesting();

      const instance1 = EventSourcing.getInstance();
      const eventStore1 = instance1.getEventStore();

      const instance2 = EventSourcing.getInstance();
      const eventStore2 = instance2.getEventStore();

      expect(instance1).toBe(instance2);
      expect(eventStore1).toBe(eventStore2);
    });
  });

  describe("constructor with runtime injection", () => {
    it("uses injected event store from runtime", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const eventStore = instance.getEventStore();

      expect(eventStore).toBe(mockEventStore);
    });

    it("returns PipelineBuilder when event sourcing is enabled", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("returns disabled status from runtime", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);

      expect(instance.isEnabled).toBe(true);
    });
  });

  describe("getEventStore", () => {
    it("returns the event store instance from runtime", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const eventStore = instance.getEventStore();

      expect(eventStore).toBe(mockEventStore);
    });

    it("returns the same event store instance on multiple calls", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const eventStore1 = instance.getEventStore();
      const eventStore2 = instance.getEventStore();
      const eventStore3 = instance.getEventStore();

      expect(eventStore1).toBe(mockEventStore);
      expect(eventStore2).toBe(mockEventStore);
      expect(eventStore3).toBe(mockEventStore);
    });

    it("preserves type casting for generic EventType", () => {
      interface TestEvent extends Event {
        data: { test: string };
      }

      const mockEventStore = createMockEventStore<TestEvent>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const eventStore = instance.getEventStore<TestEvent>();

      expect(eventStore).toBe(mockEventStore);
    });
  });

  describe("registerPipeline", () => {
    it("returns a new PipelineBuilder instance", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("preserves generic type parameters for EventType and ProjectionType", () => {
      interface TestEvent extends Event {
        data: { test: string };
      }
      interface _TestProjection {
        id: string;
        aggregateId: string;
        tenantId: TenantId;
        version: number;
        data: { result: string };
      }

      const mockEventStore = createMockEventStore<TestEvent>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const builder = instance.registerPipeline<TestEvent>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("creates new builder instance on each call", () => {
      const mockEventStore = createMockEventStore<Event>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const builder1 = instance.registerPipeline<Event>();
      const builder2 = instance.registerPipeline<Event>();

      expect(builder1).toBeInstanceOf(PipelineBuilder);
      expect(builder2).toBeInstanceOf(PipelineBuilder);
      expect(builder1).not.toBe(builder2);
    });

    it("returns DisabledPipelineBuilder when runtime has no event store", () => {
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: void 0,
      });

      const instance = new EventSourcing(runtime);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(DisabledPipelineBuilder);
    });
  });

  describe("edge cases and security", () => {
    it("handles null ClickHouse client gracefully", () => {
      // Initialize with null client (uses memory store)
      initializeEventSourcing({ clickHouseClient: null, redisConnection: null });

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });

    it("maintains type safety with generic EventType", () => {
      interface SpecificEvent extends Event {
        data: { specific: boolean };
      }

      const mockEventStore = createMockEventStore<SpecificEvent>();
      const runtime = EventSourcingRuntime.createForTesting({
        eventStore: mockEventStore,
      });

      const instance = new EventSourcing(runtime);
      const eventStore = instance.getEventStore<SpecificEvent>();

      expect(eventStore).toBe(mockEventStore);
    });

    it("handles multiple concurrent getInstance calls deterministically", async () => {
      // Initialize with in-memory stores for testing
      initializeEventSourcingForTesting();

      const promises = Array.from({ length: 10 }, () =>
        Promise.resolve(EventSourcing.getInstance()),
      );

      const instances = await Promise.all(promises);

      const firstInstance = instances[0];
      instances.forEach((instance) => {
        expect(instance).toBe(firstInstance);
      });
    });
  });
});
