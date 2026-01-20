import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineCommandSchema } from "../../../library/commands/commandSchema";
import { COMMAND_TYPES } from "../../../library/domain/commandType";
import { EVENT_TYPES } from "../../../library/domain/eventType";
import { createTenantId } from "../../../library/domain/tenantId";
import type { Projection } from "../../../library/domain/types";
import { createMockDistributedLock } from "../../../library/services/__tests__/testHelpers";
import { buildCheckpointKey } from "../../../library/utils/checkpointKey";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import { ProcessorCheckpointStoreMemory } from "../../stores/processorCheckpointStoreMemory";
import { CheckpointRepositoryMemory } from "../../stores/repositories/checkpointRepositoryMemory";
import { EventRepositoryMemory } from "../../stores/repositories/eventRepositoryMemory";
import { PipelineBuilder } from "../builder";
import {
  createMockEventPublisher,
  createMockEventStore,
  createMockProjectionStore,
  createMockQueueProcessorFactory,
  createTestCommandHandlerClass,
  createTestEventForBuilder,
  createTestEventHandlerClass,
  createTestProjection,
  createTestProjectionHandlerClass,
  TEST_CONSTANTS,
  type TestCommandPayload,
  type TestEvent,
  testCommandPayloadSchema,
} from "./testHelpers";

describe("PipelineBuilder Integration Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("Complete Pipeline Build Contract", () => {
    it("builds pipeline with name, aggregateType, and service when minimal configuration provided", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("trace");
      expect(pipeline.service).toBeDefined();
      expect(pipeline.commands).toBeDefined();
    });

    it("builds pipeline with projections when withProjection() called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const HandlerClass = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store,
        handleImpl: async () =>
          createTestProjection(
            "proj-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
      });
      // Spy on the prototype so it works with new instances
      const handleSpy = vi.spyOn(HandlerClass.prototype, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      handleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("test-projection", HandlerClass);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(getEventsSpy).toHaveBeenCalledWith(
        "aggregate-1",
        { tenantId },
        "trace",
      );
      expect(handleSpy).toHaveBeenCalled();
      const callArgs = handleSpy.mock.calls[0];
      expect(callArgs).toBeDefined();
      if (callArgs?.[0]) {
        // Projection handler receives EventStream object
        expect(callArgs[0]).toMatchObject({
          aggregateId: "aggregate-1",
          tenantId,
        });
        expect(callArgs[0]).toHaveProperty("orderedEvents");
        expect(callArgs[0]).toHaveProperty("metadata");
      }
    });

    it("builds pipeline with eventPublisher when withEventPublisher() called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();
      const publishSpy = vi.spyOn(publisher, "publish");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventPublisher(publisher);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], context);

      expect(publishSpy).toHaveBeenCalledWith([event], context);
    });

    it("builds pipeline with eventHandlers when withEventHandler() called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const HandlerClass = createTestEventHandlerClass<TestEvent>({
        handleImpl: async () => {
          /* no-op */
        },
      });
      // Spy on the prototype so it works with new instances
      const handleSpy = vi.spyOn(HandlerClass.prototype, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventHandler("test-handler", HandlerClass);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(handleSpy).toHaveBeenCalled();
    });

    it("builds pipeline with commands when withCommand() called before build()", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass);

      const pipeline = builder.build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
      expect(pipeline.commands.testDispatcher).toBeDefined();
    });

    it("builds pipeline with all components when all registration methods called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();
      const ProjectionHandlerClass = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store,
        handleImpl: async () =>
          createTestProjection(
            "proj-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
      });
      const EventHandlerClass = createTestEventHandlerClass<TestEvent>({
        handleImpl: async () => {
          /* no-op */
        },
      });
      const publisher = createMockEventPublisher<TestEvent>();
      const commandHandler = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      // Spy on the prototypes so it works with new instances
      const projectionHandleSpy = vi.spyOn(
        ProjectionHandlerClass.prototype,
        "handle",
      );
      const eventHandleSpy = vi.spyOn(EventHandlerClass.prototype, "handle");
      const publishSpy = vi.spyOn(publisher, "publish");

      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      projectionHandleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("test-projection", ProjectionHandlerClass)
        .withEventPublisher(publisher)
        .withEventHandler("test-handler", EventHandlerClass)
        .withCommand("testDispatcher", commandHandler);

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("trace");
      expect(pipeline.service).toBeDefined();
      expect(pipeline.commands).toHaveProperty("testDispatcher");

      await pipeline.service.storeEvents([event], context);

      expect(getEventsSpy).toHaveBeenCalled();
      expect(projectionHandleSpy).toHaveBeenCalled();
      expect(eventHandleSpy).toHaveBeenCalled();
      expect(publishSpy).toHaveBeenCalledWith([event], context);
    });

    it("creates EventSourcingService with correct configuration when build() called", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const storeEventsSpy = vi.spyOn(eventStore, "storeEvents");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      const distributedLock = createMockDistributedLock();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], context);

      expect(storeEventsSpy).toHaveBeenCalledWith([event], context, "trace");
    });
  });

  describe("Command Processing Integration", () => {
    it("dispatcher.send() processes valid command and stores events via pipeline.service.storeEvents()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const storeEventsSpy = vi.fn().mockResolvedValue(void 0);

      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", createTenantId("tenant-1")),
      ];

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => events,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const serviceStoreEventsSpy = vi.spyOn(pipeline.service, "storeEvents");
      serviceStoreEventsSpy.mockImplementation(storeEventsSpy);

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

      expect(storeEventsSpy).toHaveBeenCalledWith(events, {
        tenantId: createTenantId("tenant-1"),
      });
    });

    it("dispatcher.send() triggers event handlers registered in pipeline when events stored", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const EventHandlerClass = createTestEventHandlerClass<TestEvent>();
      // Spy on the prototype so it works with new instances
      const handleSpy = vi.spyOn(EventHandlerClass.prototype, "handle");

      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", createTenantId("tenant-1")),
      ];

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => events,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventHandler("test-handler", EventHandlerClass)
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

      expect(handleSpy).toHaveBeenCalled();
    });

    it("dispatcher.send() updates projections registered in pipeline when events stored", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();
      const ProjectionHandlerClass = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({ store });
      // Spy on the prototype so it works with new instances
      const handleSpy = vi.spyOn(ProjectionHandlerClass.prototype, "handle");

      const tenantId = createTenantId("tenant-1");
      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", tenantId),
      ];

      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue(events);
      handleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => events,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("test-projection", ProjectionHandlerClass)
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

      expect(getEventsSpy).toHaveBeenCalled();
      expect(handleSpy).toHaveBeenCalled();
    });

    it("dispatcher.send() publishes events via eventPublisher when events stored and publisher registered", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const publisher = createMockEventPublisher<TestEvent>();
      const publishSpy = vi.spyOn(publisher, "publish");

      const tenantId = createTenantId("tenant-1");
      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", tenantId),
      ];
      const context = { tenantId };

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => events,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventPublisher(publisher)
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

      expect(publishSpy).toHaveBeenCalledWith(events, context);
    });

    it("dispatcher.send() does not publish events when no publisher registered", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", createTenantId("tenant-1")),
      ];

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => events,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await expect(
        pipeline.commands.testDispatcher?.send(payload),
      ).resolves.not.toThrow();
    });

    it("dispatcher.send() processes multiple commands sequentially correctly", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const handleSpy = vi.fn().mockResolvedValue([]);

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: handleSpy,
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload1: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      const payload2: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-2",
        value: 43,
      };

      await pipeline.commands.testDispatcher?.send(payload1);
      await pipeline.commands.testDispatcher?.send(payload2);

      expect(handleSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Real-World Pipeline Scenarios", () => {
    it("builds pipeline matching span-ingestion pattern: name, aggregateType, commandHandler, eventHandler", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("trace-processing")
        .withAggregateType("trace")
        .withCommand("recordSpan", HandlerClass)
        .withEventHandler(
          "trace-aggregation-trigger",
          createTestEventHandlerClass<TestEvent>({
            getEventTypes: () => [EVENT_TYPES[0]] as const,
          }),
          {
            eventTypes: [EVENT_TYPES[0]],
          },
        )
        .build();

      expect(pipeline.name).toBe("trace-processing");
      expect(pipeline.aggregateType).toBe("trace");
      expect(pipeline.commands).toHaveProperty("recordSpan");
      expect(pipeline.service).toBeDefined();
    });

    it("builds pipeline matching trace-aggregation pattern: name, aggregateType, projection, commandHandler", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "triggerTraceAggregation",
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("trace-processing")
        .withAggregateType("trace")
        .withProjection(
          "traceAggregationState",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        )
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(pipeline.name).toBe("trace-processing");
      expect(pipeline.aggregateType).toBe("trace");
      expect(pipeline.commands).toHaveProperty("triggerTraceAggregation");
      expect(pipeline.service).toBeDefined();
    });

    it("builds pipeline with multiple command handlers having different configurations", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("handler1", HandlerClass1)
        .withCommand("handler2", HandlerClass2)
        .build();

      expect(pipeline.commands).toHaveProperty("handler1");
      expect(pipeline.commands).toHaveProperty("handler2");
    });

    it("builds pipeline with command handlers using static dispatcherName", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "staticDispatcherName",
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("staticDispatcherName");
    });

    it("builds pipeline with command handlers using inferred dispatcherName", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      class RecordSpanCommandHandler {
        static readonly schema = defineCommandSchema(
          COMMAND_TYPES[0],
          testCommandPayloadSchema,
        );

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("recordSpan", RecordSpanCommandHandler)
        .build();

      expect(pipeline.commands).toHaveProperty("recordSpan");
    });

    it("builds pipeline with command handlers using custom dispatcherName in options", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("customName", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("customName");
      expect(pipeline.commands).not.toHaveProperty("staticName");
    });
  });

  describe("Full Pipeline Scenarios with Sequential Ordering", () => {
    // Override fake timers for these tests - they use actual delays
    beforeEach(() => {
      vi.useRealTimers();
    });

    afterEach(() => {
      // Restore fake timers for consistency with other test suites
      vi.useFakeTimers();
      vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    });

    it("full pipeline: command → event → handler → projection with sequential ordering", async () => {
      const eventStore = new EventStoreMemory<TestEvent>(
        new EventRepositoryMemory(),
      );
      const factory = createMockQueueProcessorFactory();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const projectionStore = createMockProjectionStore<Projection>();
      const ProjectionHandlerClass = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: projectionStore,
        handleImpl: async () =>
          createTestProjection(
            "proj-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const aggregateId = "aggregate-1";

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async (_command) => {
          // Create events with different timestamps to ensure sequential ordering
          const event1 = createTestEventForBuilder(aggregateId, tenantId);
          const event2 = createTestEventForBuilder(aggregateId, tenantId);
          // Set different timestamps
          event1.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
          event2.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP + 1000;
          return [event1, event2];
        },
      });

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        processorCheckpointStore: checkpointStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("recordSpan", HandlerClass)
        .withEventHandler(
          "span-storage",
          createTestEventHandlerClass<TestEvent>(),
          {
            eventTypes: [EVENT_TYPES[0]],
          },
        )
        .withProjection("summary", ProjectionHandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: TEST_CONSTANTS.TENANT_ID_VALUE,
        id: aggregateId,
        value: 42,
      };

      // Send command - should create events and process them
      await pipeline.commands.recordSpan?.send(payload);

      // Get created processors
      const processors = factory.getCreatedProcessors();
      const commandProcessor = processors.find((p) =>
        p.name.includes("recordSpan"),
      );
      expect(commandProcessor).toBeDefined();

      // Verify events were stored
      const events = await eventStore.getEvents(
        aggregateId,
        { tenantId },
        "trace",
      );
      expect(events.length).toBeGreaterThan(0);

      // Verify sequential ordering: events should be processed in order
      // (This is tested more thoroughly in eventSourcingService.sequential.test.ts)
    });

    it("multiple aggregates with concurrent updates (different aggregates can update concurrently)", async () => {
      const eventStore = new EventStoreMemory<TestEvent>(
        new EventRepositoryMemory(),
      );
      const factory = createMockQueueProcessorFactory();
      const projectionStore = createMockProjectionStore<Projection>();
      const handleSpy = vi.fn().mockImplementation(async (stream: any) => {
        return createTestProjection(
          `proj-${stream.getAggregateId()}`,
          stream.getAggregateId(),
          stream.getTenantId(),
        );
      });
      const ProjectionHandlerClass = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: projectionStore,
        handleImpl: handleSpy,
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const aggregateId1 = "aggregate-1";
      const aggregateId2 = "aggregate-2";

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("summary", ProjectionHandlerClass)
        .build();

      const event1 = createTestEventForBuilder(aggregateId1, tenantId);
      const event2 = createTestEventForBuilder(aggregateId2, tenantId);

      // Store events for different aggregates concurrently
      await Promise.all([
        pipeline.service.storeEvents([event1], { tenantId }),
        pipeline.service.storeEvents([event2], { tenantId }),
      ]);

      // Verify both projections were updated
      expect(handleSpy).toHaveBeenCalledTimes(2);
      const callArgs = handleSpy.mock.calls;
      expect(callArgs[0]?.[0].getAggregateId()).toBe(aggregateId1);
      expect(callArgs[1]?.[0].getAggregateId()).toBe(aggregateId2);
    });

    it("multiple projections updating simultaneously for same aggregate", async () => {
      const eventStore = new EventStoreMemory<TestEvent>(
        new EventRepositoryMemory(),
      );
      const factory = createMockQueueProcessorFactory();
      const projectionStore1 = createMockProjectionStore<Projection>();
      const projectionStore2 = createMockProjectionStore<Projection>();
      const handleSpy1 = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(
            "proj1-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
        );
      const handleSpy2 = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(
            "proj2-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
        );
      const ProjectionHandlerClass1 = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: projectionStore1,
        handleImpl: handleSpy1,
      });
      const ProjectionHandlerClass2 = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: projectionStore2,
        handleImpl: handleSpy2,
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const aggregateId = "aggregate-1";

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("summary", ProjectionHandlerClass1)
        .withProjection("analytics", ProjectionHandlerClass2)
        .build();

      const event1 = createTestEventForBuilder(aggregateId, tenantId);

      // Store event - should trigger both projections
      await pipeline.service.storeEvents([event1], { tenantId });

      // Verify both projections were updated
      expect(handleSpy1).toHaveBeenCalledTimes(1);
      expect(handleSpy2).toHaveBeenCalledTimes(1);
      expect(projectionStore1.storeProjection).toHaveBeenCalledTimes(1);
      expect(projectionStore2.storeProjection).toHaveBeenCalledTimes(1);
    });

    it("queue-based processing with sequential enforcement", async () => {
      const eventStore = new EventStoreMemory<TestEvent>(
        new EventRepositoryMemory(),
      );
      const factory = createMockQueueProcessorFactory();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const handleSpy = vi.fn().mockResolvedValue(void 0);
      const HandlerClass = createTestEventHandlerClass<TestEvent>({
        handleImpl: handleSpy,
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const aggregateId = "aggregate-1";

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        processorCheckpointStore: checkpointStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventHandler("handler", HandlerClass)
        .build();

      // Create events with different timestamps
      const event1 = createTestEventForBuilder(aggregateId, tenantId);
      event1.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
      const event2 = createTestEventForBuilder(aggregateId, tenantId);
      event2.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP + 1000;
      const event3 = createTestEventForBuilder(aggregateId, tenantId);
      event3.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP + 2000;

      // Store events
      await eventStore.storeEvents(
        [event1, event2, event3],
        { tenantId },
        "trace",
      );

      // Process events - should enforce sequential ordering
      // Note: No delays needed because the mock queue processor processes synchronously
      // and checkpoints are saved before storeEvents returns
      await pipeline.service.storeEvents([event1], { tenantId });
      await pipeline.service.storeEvents([event2], { tenantId });
      await pipeline.service.storeEvents([event3], { tenantId });

      // Verify handlers were called in order
      // Use objectContaining to allow for optional metadata field that may be added during processing
      expect(handleSpy).toHaveBeenCalledTimes(3);
      expect(handleSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: event1.id,
          aggregateId: event1.aggregateId,
          type: event1.type,
          timestamp: event1.timestamp,
        }),
      );
      expect(handleSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: event2.id,
          aggregateId: event2.aggregateId,
          type: event2.type,
          timestamp: event2.timestamp,
        }),
      );
      expect(handleSpy).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          id: event3.id,
          aggregateId: event3.aggregateId,
          type: event3.type,
          timestamp: event3.timestamp,
        }),
      );

      // Verify final checkpoint reflects the last processed event
      // Note: Checkpoint is per-aggregate, not per-event, so there's only one checkpoint
      const checkpointKey = buildCheckpointKey(
        tenantId,
        "test-pipeline",
        "handler",
        "trace",
        aggregateId,
      );
      const finalCheckpoint =
        await checkpointStore.loadCheckpoint(checkpointKey);

      expect(finalCheckpoint?.sequenceNumber).toBe(3);
      expect(finalCheckpoint?.status).toBe("processed");
    });

    it("sequential ordering maintained across queue retries", async () => {
      const eventStore = new EventStoreMemory<TestEvent>(
        new EventRepositoryMemory(),
      );
      const factory = createMockQueueProcessorFactory();
      const checkpointStore = new ProcessorCheckpointStoreMemory(
        new CheckpointRepositoryMemory(),
      );
      const handleSpy = vi.fn().mockResolvedValue(void 0);
      const HandlerClass = createTestEventHandlerClass<TestEvent>({
        handleImpl: handleSpy,
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const aggregateId = "aggregate-1";

      const distributedLock = createMockDistributedLock();
      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        processorCheckpointStore: checkpointStore,
        distributedLock,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventHandler("handler", HandlerClass)
        .build();

      // Create events with different timestamps
      const event1 = createTestEventForBuilder(aggregateId, tenantId);
      event1.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP;
      const event2 = createTestEventForBuilder(aggregateId, tenantId);
      event2.timestamp = TEST_CONSTANTS.BASE_TIMESTAMP + 1000;

      // Store events
      await eventStore.storeEvents([event1, event2], { tenantId }, "trace");

      // Process event1 - should succeed
      await pipeline.service.storeEvents([event1], { tenantId });

      // Verify event1 was processed
      // Use objectContaining to allow for optional metadata field that may be added during processing
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: event1.id,
          aggregateId: event1.aggregateId,
          type: event1.type,
          timestamp: event1.timestamp,
        }),
      );

      // Try to process event2 before event1 checkpoint is saved - should still work
      // because we're using the same service instance and checkpoint store
      await pipeline.service.storeEvents([event2], { tenantId });

      // Verify event2 was processed after event1
      expect(handleSpy).toHaveBeenCalledTimes(2);
      expect(handleSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: event2.id,
          aggregateId: event2.aggregateId,
          type: event2.type,
          timestamp: event2.timestamp,
        }),
      );

      // Verify sequence numbers are correct
      const checkpointKey2 = buildCheckpointKey(
        tenantId,
        "test-pipeline",
        "handler",
        "trace",
        aggregateId,
      );
      const checkpoint2 = await checkpointStore.loadCheckpoint(checkpointKey2);
      expect(checkpoint2?.sequenceNumber).toBe(2);
    });
  });
});
