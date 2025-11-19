import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../../../library/domain/types";
import { PipelineBuilder } from "../builder";
import {
  createMockEventStore,
  createMockQueueProcessorFactory,
  createMockProjectionStore,
  createMockEventHandler,
  createMockEventReactionHandler,
  createMockEventPublisher,
  createTestCommandHandlerClass,
  createTestEventForBuilder,
  createTestProjection,
  TEST_CONSTANTS,
  type TestCommandPayload,
  type TestEvent,
} from "./testHelpers";
import { COMMAND_TYPES } from "../../../library/domain/commandType";
import { EVENT_TYPES } from "../../../library/domain/eventType";
import { createTenantId } from "../../../library/domain/tenantId";
import { defineCommandSchema } from "../../../library/commands/commandSchema";

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
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span_ingestion");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("span_ingestion");
      expect(pipeline.service).toBeDefined();
      expect(pipeline.commands).toBeDefined();
    });

    it("builds pipeline with projections when withProjection() called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const handler = createMockEventHandler<TestEvent, Projection>();
      const handleSpy = vi.spyOn(handler, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      handleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withProjection("test-projection", store, handler);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(getEventsSpy).toHaveBeenCalledWith(
        "aggregate-1",
        { tenantId },
        "span_ingestion",
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

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withEventPublisher(publisher);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], context);

      expect(publishSpy).toHaveBeenCalledWith([event], context);
    });

    it("builds pipeline with eventHandlers when withEventHandler() called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const handler = createMockEventReactionHandler<TestEvent>();
      const handleSpy = vi.spyOn(handler, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withEventHandler("test-handler", handler);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(handleSpy).toHaveBeenCalled();
    });

    it("builds pipeline with commands when withCommandHandler() called before build()", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const builder = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass);

      const pipeline = builder.build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
      expect(pipeline.commands.testDispatcher).toBeDefined();
    });

    it("builds pipeline with all components when all registration methods called before build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();
      const projectionHandler = createMockEventHandler<TestEvent, Projection>();
      const eventHandler = createMockEventReactionHandler<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();
      const commandHandler = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      const projectionHandleSpy = vi.spyOn(projectionHandler, "handle");
      const eventHandleSpy = vi.spyOn(eventHandler, "handle");
      const publishSpy = vi.spyOn(publisher, "publish");

      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      projectionHandleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const builder = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withProjection("test-projection", store, projectionHandler)
        .withEventPublisher(publisher)
        .withEventHandler("test-handler", eventHandler)
        .withCommandHandler(commandHandler);

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("span_ingestion");
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

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span_ingestion");

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], context);

      expect(storeEventsSpy).toHaveBeenCalledWith([event], context, "span_ingestion");
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
        dispatcherName: "testDispatcher",
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass)
        .build();

      const serviceStoreEventsSpy = vi.spyOn(pipeline.service, "storeEvents");
      serviceStoreEventsSpy.mockImplementation(storeEventsSpy);

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

      expect(storeEventsSpy).toHaveBeenCalledWith(events, {
        tenantId: createTenantId("tenant-1"),
      });
    });

    it("dispatcher.send() triggers event handlers registered in pipeline when events stored", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const eventHandler = createMockEventReactionHandler<TestEvent>();
      const handleSpy = vi.spyOn(eventHandler, "handle");

      const events: TestEvent[] = [
        createTestEventForBuilder("aggregate-1", createTenantId("tenant-1")),
      ];

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withEventHandler("test-handler", eventHandler)
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

      expect(handleSpy).toHaveBeenCalled();
    });

    it("dispatcher.send() updates projections registered in pipeline when events stored", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();
      const projectionHandler = createMockEventHandler<TestEvent, Projection>();
      const handleSpy = vi.spyOn(projectionHandler, "handle");

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
        dispatcherName: "testDispatcher",
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withProjection("test-projection", store, projectionHandler)
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

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
        dispatcherName: "testDispatcher",
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withEventPublisher(publisher)
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

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
        dispatcherName: "testDispatcher",
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await expect(
        pipeline.commands.testDispatcher!.send(payload),
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
        dispatcherName: "testDispatcher",
        handleImpl: handleSpy,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass)
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

      await pipeline.commands.testDispatcher!.send(payload1);
      await pipeline.commands.testDispatcher!.send(payload2);

      expect(handleSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Real-World Pipeline Scenarios", () => {
    it("builds pipeline matching span-ingestion pattern: name, aggregateType, commandHandler, eventHandler", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const eventHandler = createMockEventReactionHandler<TestEvent>();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "recordSpan",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("span-ingestion")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass)
        .withEventHandler("trace-aggregation-trigger", eventHandler, {
          eventTypes: [EVENT_TYPES[0]],
        })
        .build();

      expect(pipeline.name).toBe("span-ingestion");
      expect(pipeline.aggregateType).toBe("span_ingestion");
      expect(pipeline.commands).toHaveProperty("recordSpan");
      expect(pipeline.service).toBeDefined();
    });

    it("builds pipeline matching trace-aggregation pattern: name, aggregateType, projection, commandHandler", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const store = createMockProjectionStore<Projection>();
      const projectionHandler = createMockEventHandler<TestEvent, Projection>();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "triggerTraceAggregation",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("trace-aggregation")
        .withAggregateType("trace_aggregation")
        .withProjection("traceAggregationState", store, projectionHandler)
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.name).toBe("trace-aggregation");
      expect(pipeline.aggregateType).toBe("trace_aggregation");
      expect(pipeline.commands).toHaveProperty("triggerTraceAggregation");
      expect(pipeline.service).toBeDefined();
    });

    it("builds pipeline with multiple command handlers having different configurations", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler1",
        delay: 1000,
        concurrency: 5,
      });

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler2",
        delay: 2000,
        concurrency: 10,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass1)
        .withCommandHandler(HandlerClass2)
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

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("staticDispatcherName");
    });

    it("builds pipeline with command handlers using inferred dispatcherName", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      class RecordSpanCommandHandler {
        static readonly schema = defineCommandSchema<TestCommandPayload>(
          COMMAND_TYPES[0],
          (payload): payload is TestCommandPayload => {
            return (
              typeof payload === "object" &&
              payload !== null &&
              "tenantId" in payload &&
              "id" in payload &&
              "value" in payload
            );
          },
        );

        static readonly dispatcherName = "recordSpan";

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(RecordSpanCommandHandler)
        .build();

      expect(pipeline.commands).toHaveProperty("recordSpan");
    });

    it("builds pipeline with command handlers using custom dispatcherName in options", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "staticName",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span_ingestion")
        .withCommandHandler(HandlerClass, { dispatcherName: "customName" })
        .build();

      expect(pipeline.commands).toHaveProperty("customName");
      expect(pipeline.commands).not.toHaveProperty("staticName");
    });
  });
});
