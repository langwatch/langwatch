import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcing } from "../eventSourcing";
import { EventStoreClickHouse } from "../stores/eventStoreClickHouse";
import { EventStoreMemory } from "../stores/eventStoreMemory";
import { PipelineBuilder } from "../pipeline";
import type { Event } from "../../library";
import type { QueueProcessorFactory } from "../queue";
import { createMockEventStore } from "../../library/services/__tests__/testHelpers";
import * as clickhouseUtils from "../../../../utils/clickhouse";
import type { ClickHouseClient } from "@clickhouse/client";
import type { TenantId } from "../../library/domain/tenantId";

describe("EventSourcing", () => {
  let getClickHouseClientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset singleton instance between tests
    (EventSourcing as unknown as { instance: EventSourcing | null }).instance =
      null;

    getClickHouseClientSpy = vi.spyOn(clickhouseUtils, "getClickHouseClient");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset singleton instance after each test
    (EventSourcing as unknown as { instance: EventSourcing | null }).instance =
      null;
  });

  describe("getInstance", () => {
    it("returns the same singleton instance on multiple calls", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance1 = EventSourcing.getInstance();
      const instance2 = EventSourcing.getInstance();
      const instance3 = EventSourcing.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it("creates Memory store when ClickHouse client is not available", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
      expect(getClickHouseClientSpy).toHaveBeenCalledTimes(1);
    });

    it("creates ClickHouse store when client is available", () => {
      const mockClient = {} as ClickHouseClient;
      getClickHouseClientSpy.mockReturnValue(mockClient);

      const instance = EventSourcing.getInstance();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreClickHouse);
      expect(getClickHouseClientSpy).toHaveBeenCalledTimes(1);
    });

    it("returns the same event store instance across multiple getInstance calls", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance1 = EventSourcing.getInstance();
      const eventStore1 = instance1.getEventStore();

      const instance2 = EventSourcing.getInstance();
      const eventStore2 = instance2.getEventStore();

      expect(instance1).toBe(instance2);
      expect(eventStore1).toBe(eventStore2);
    });
  });

  describe("constructor", () => {
    it("uses default event store when no parameters provided", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance = new EventSourcing();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });

    it("uses injected event store when provided", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore);
      const eventStore = instance.getEventStore();

      expect(eventStore).toBe(mockEventStore);
    });

    it("uses injected queue processor factory when provided", () => {
      const mockEventStore = createMockEventStore<Event>();
      const mockFactory: QueueProcessorFactory = {
        create: vi.fn(),
      };

      const instance = new EventSourcing(mockEventStore, mockFactory);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("creates ClickHouse store when client is available and no store provided", () => {
      const mockClient = {} as ClickHouseClient;
      getClickHouseClientSpy.mockReturnValue(mockClient);

      const instance = new EventSourcing();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreClickHouse);
      expect(getClickHouseClientSpy).toHaveBeenCalledTimes(1);
    });

    it("creates Memory store when client is not available and no store provided", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance = new EventSourcing();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
      expect(getClickHouseClientSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getEventStore", () => {
    it("returns the event store instance", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore);
      const eventStore = instance.getEventStore();

      expect(eventStore).toBe(mockEventStore);
    });

    it("returns the same event store instance on multiple calls", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore);
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

      const instance = new EventSourcing(mockEventStore);
      const eventStore = instance.getEventStore<TestEvent>();

      expect(eventStore).toBe(mockEventStore);
    });
  });

  describe("registerPipeline", () => {
    it("returns a new PipelineBuilder instance", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("preserves generic type parameters for EventType and ProjectionType", () => {
      interface TestEvent extends Event {
        data: { test: string };
      }
      interface TestProjection {
        id: string;
        aggregateId: string;
        tenantId: TenantId;
        version: number;
        data: { result: string };
      }

      const mockEventStore = createMockEventStore<TestEvent>();

      const instance = new EventSourcing(mockEventStore);
      const builder = instance.registerPipeline<TestEvent, TestProjection>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("creates new builder instance on each call", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore);
      const builder1 = instance.registerPipeline<Event>();
      const builder2 = instance.registerPipeline<Event>();

      expect(builder1).toBeInstanceOf(PipelineBuilder);
      expect(builder2).toBeInstanceOf(PipelineBuilder);
      expect(builder1).not.toBe(builder2);
    });
  });

  describe("edge cases and security", () => {
    it("handles null ClickHouse client gracefully", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance = new EventSourcing();
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });

    it("handles undefined event store parameter by using default", () => {
      getClickHouseClientSpy.mockReturnValue(null);

      const instance = new EventSourcing(undefined);
      const eventStore = instance.getEventStore();

      expect(eventStore).toBeInstanceOf(EventStoreMemory);
    });

    it("handles undefined queue processor factory parameter by using default", () => {
      const mockEventStore = createMockEventStore<Event>();

      const instance = new EventSourcing(mockEventStore, undefined);
      const builder = instance.registerPipeline<Event>();

      expect(builder).toBeInstanceOf(PipelineBuilder);
    });

    it("maintains type safety with generic EventType", () => {
      interface SpecificEvent extends Event {
        data: { specific: boolean };
      }

      const mockEventStore = createMockEventStore<SpecificEvent>();

      const instance = new EventSourcing(mockEventStore);
      const eventStore = instance.getEventStore<SpecificEvent>();

      expect(eventStore).toBe(mockEventStore);
    });

    it("handles multiple concurrent getInstance calls deterministically", async () => {
      getClickHouseClientSpy.mockReturnValue(null);

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
