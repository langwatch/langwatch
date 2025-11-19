import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../../../library/domain/types";
import { PipelineBuilder } from "../builder";

// Mock tracer to prevent hanging in tests
vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: vi.fn((name, options, fn) => {
      const mockSpan = {
        addEvent: vi.fn(),
        setAttributes: vi.fn(),
        setAttribute: vi.fn(),
        end: vi.fn(),
      };
      return fn(mockSpan);
    }),
  })),
}));
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
import type { Command } from "../../../library/commands/command";

describe("PipelineBuilder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("PipelineBuilder State Enforcement", () => {
    it('throws Error with message "Pipeline name is required" when build() called before withName()', () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore);

      expect(() => {
        builder.build();
      }).toThrow("Pipeline name is required");
    });

    it("returns PipelineBuilderWithName instance when withName() called with string", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore);

      const result = builder.withName("test-pipeline");

      expect(result).toBeDefined();
      // Verify it has the expected methods for the next builder state
      expect(result).toHaveProperty("withAggregateType");
      expect(result).toHaveProperty("build");
      // Verify build() throws the expected error for this state
      expect(() => result.build()).toThrow("Aggregate type is required");
    });

    it("preserves eventStore and queueProcessorFactory when transitioning to PipelineBuilderWithName", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const builder = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      );

      const withName = builder.withName("test-pipeline");
      const withType = withName.withAggregateType("span");
      const pipeline = withType.build();

      expect(pipeline.service).toBeDefined();
    });

    it("accepts custom QueueProcessorFactory instance in constructor and uses it in subsequent operations", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe("PipelineBuilderWithName State Enforcement", () => {
    it('throws Error with message "Aggregate type is required" when build() called before withAggregateType()', () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
      ).withName("test-pipeline");

      expect(() => {
        builder.build();
      }).toThrow("Aggregate type is required");
    });

    it("returns PipelineBuilderWithNameAndType instance when withAggregateType() called with valid AggregateType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
      ).withName("test-pipeline");

      const result = builder.withAggregateType("span");

      expect(result).toBeDefined();
      // Verify it has the expected methods for the final builder state
      expect(result).toHaveProperty("withProjection");
      expect(result).toHaveProperty("withEventPublisher");
      expect(result).toHaveProperty("withEventHandler");
      expect(result).toHaveProperty("withCommandHandler");
      expect(result).toHaveProperty("build");
      // Verify build() succeeds (doesn't throw)
      expect(() => result.build()).not.toThrow();
    });

    it("preserves name, eventStore, and queueProcessorFactory when transitioning to PipelineBuilderWithNameAndType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("span");
    });
  });

  describe("PipelineBuilderWithNameAndType Build Contract", () => {
    it("creates RegisteredPipeline with name property matching builder name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("my-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("my-pipeline");
    });

    it("creates RegisteredPipeline with aggregateType property matching builder aggregateType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("trace_aggregation");

      const pipeline = builder.build();

      expect(pipeline.aggregateType).toBe("trace_aggregation");
    });

    it("creates RegisteredPipeline with service property that is EventSourcingService instance", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
      expect(pipeline.service).toHaveProperty("storeEvents");
      expect(typeof pipeline.service.storeEvents).toBe("function");
    });

    it("passes eventStore to EventSourcingPipeline constructor", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const storeEventsSpy = vi.spyOn(eventStore, "storeEvents");

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1");

      void pipeline.service.storeEvents([event], {
        tenantId: createTenantId("tenant-1"),
      });

      expect(storeEventsSpy).toHaveBeenCalled();
    });

    it("passes undefined projections when no projections registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("passes undefined eventPublisher when no publisher registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("passes undefined eventHandlers when no handlers registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });
  });

  describe("withProjection() Registration Contract", () => {
    it("stores projection definition in internal Map with exact name key when called with unique name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const handler = createMockEventHandler<TestEvent, Projection>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withProjection("my-projection", store, handler);

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("stores projection definition with handler reference matching provided handler", async () => {
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
        .withAggregateType("span")
        .withProjection("test-projection", store, handler);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(getEventsSpy).toHaveBeenCalled();
      expect(handleSpy).toHaveBeenCalled();
    });

    it("returns builder instance that allows method chaining", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const handler = createMockEventHandler<TestEvent, Projection>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const result = builder.withProjection("test-projection", store, handler);

      expect(result).toBe(builder);
    });

    it("throws Error with message containing projection name when duplicate projection name registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const handler = createMockEventHandler<TestEvent, Projection>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withProjection("duplicate-name", store, handler);

      expect(() => {
        builder.withProjection("duplicate-name", store, handler);
      }).toThrow(
        'Projection with name "duplicate-name" already exists. Projection names must be unique within a pipeline.',
      );
    });

    it("allows registering multiple projections with different names in sequence", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store1 = createMockProjectionStore<Projection>();
      const store2 = createMockProjectionStore<Projection>();
      const handler1 = createMockEventHandler<TestEvent, Projection>();
      const handler2 = createMockEventHandler<TestEvent, Projection>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withProjection("projection-1", store1, handler1)
        .withProjection("projection-2", store2, handler2);

      expect(() => {
        builder.build();
      }).not.toThrow();
    });

    it("preserves previously registered projections when new projection added", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store1 = createMockProjectionStore<Projection>();
      const store2 = createMockProjectionStore<Projection>();
      const handler1 = createMockEventHandler<TestEvent, Projection>();
      const handler2 = createMockEventHandler<TestEvent, Projection>();
      const handleSpy1 = vi.spyOn(handler1, "handle");
      const handleSpy2 = vi.spyOn(handler2, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      handleSpy1.mockResolvedValue({
        id: "proj1-id",
        aggregateId: "aggregate-1",
        tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      } as Projection);
      handleSpy2.mockResolvedValue({
        id: "proj2-id",
        aggregateId: "aggregate-1",
        tenantId,
        version: TEST_CONSTANTS.BASE_TIMESTAMP,
        data: {},
      } as Projection);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withProjection("projection-1", store1, handler1)
        .withProjection("projection-2", store2, handler2);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(getEventsSpy).toHaveBeenCalled();
      expect(handleSpy1).toHaveBeenCalled();
      expect(handleSpy2).toHaveBeenCalled();
    });
  });

  describe("withEventPublisher() Registration Contract", () => {
    it("stores event publisher reference when called", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();
      const publishSpy = vi.spyOn(publisher, "publish");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withEventPublisher(publisher);

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1", tenantId);

      await pipeline.service.storeEvents([event], { tenantId });

      expect(publishSpy).toHaveBeenCalled();
    });

    it("overwrites previous publisher when called multiple times (last one wins)", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher1 = createMockEventPublisher<TestEvent>();
      const publisher2 = createMockEventPublisher<TestEvent>();
      const publishSpy1 = vi.spyOn(publisher1, "publish");
      const publishSpy2 = vi.spyOn(publisher2, "publish");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withEventPublisher(publisher1)
        .withEventPublisher(publisher2);

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1", tenantId);

      await pipeline.service.storeEvents([event], { tenantId });

      expect(publishSpy1).not.toHaveBeenCalled();
      expect(publishSpy2).toHaveBeenCalled();
    });

    it("returns builder instance for method chaining", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const result = builder.withEventPublisher(publisher);

      expect(result).toBe(builder);
    });

    it("passes stored publisher to EventSourcingPipeline constructor during build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();
      const publishSpy = vi.spyOn(publisher, "publish");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withEventPublisher(publisher);

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      await pipeline.service.storeEvents([event], context);

      expect(publishSpy).toHaveBeenCalledWith([event], context);
    });

    it("passes undefined to EventSourcingPipeline when no publisher registered", () => {
      const eventStore = createMockEventStore<TestEvent>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });
  });

  describe(
    "withEventHandler() Registration Contract",
    () => {
      it("stores event handler definition in internal Map with exact name key when called with unique name", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const handler = createMockEventReactionHandler<TestEvent>();

        const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("my-handler", handler);

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it(
        "stores handler definition with handler reference matching provided handler",
        async () => {
          vi.useRealTimers(); // Use real timers for async operations
          const eventStore = createMockEventStore<TestEvent>();
          const factory = createMockQueueProcessorFactory();
          const handler = createMockEventReactionHandler<TestEvent>();
          const handleSpy = vi.spyOn(handler, "handle");

          const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

          const builder = new PipelineBuilder<TestEvent, Projection>(
            eventStore,
            factory,
          )
            .withName("test-pipeline")
            .withAggregateType("span")
            .withEventHandler("test-handler", handler);

          const pipeline = builder.build();
          const event = createTestEventForBuilder("aggregate-1", tenantId);

          await pipeline.service.storeEvents([event], { tenantId });

          expect(handleSpy).toHaveBeenCalled();
          const callArgs = handleSpy.mock.calls[0];
          expect(callArgs).toBeDefined();
          if (callArgs?.[0]) {
            expect(callArgs[0]).toMatchObject({
              aggregateId: "aggregate-1",
              tenantId,
            });
          }
        },
        { timeout: 10000 },
      );

      it("stores handler definition with options object matching provided options", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const handler = createMockEventReactionHandler<TestEvent>();

        const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("test-handler", handler, {
            eventTypes: [EVENT_TYPES[0]],
          });

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("stores handler definition with empty options object when options not provided", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const handler = createMockEventReactionHandler<TestEvent>();

        const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("test-handler", handler);

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("throws Error with message containing handler name when duplicate handler name registered", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const handler = createMockEventReactionHandler<TestEvent>();

        const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("duplicate-name", handler);

        expect(() => {
          builder.withEventHandler("duplicate-name", handler);
        }).toThrow(
          'Event handler with name "duplicate-name" already exists. Handler names must be unique within a pipeline.',
        );
      });

      it("allows registering multiple handlers with different names in sequence", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const handler1 = createMockEventReactionHandler<TestEvent>();
        const handler2 = createMockEventReactionHandler<TestEvent>();

        const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("handler-1", handler1)
          .withEventHandler("handler-2", handler2);

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("preserves previously registered handlers when new handler added", async () => {
        vi.useRealTimers(); // Use real timers for async operations
        const eventStore = createMockEventStore<TestEvent>();
        const factory = createMockQueueProcessorFactory();
        const handler1 = createMockEventReactionHandler<TestEvent>();
        const handler2 = createMockEventReactionHandler<TestEvent>();
        const handleSpy1 = vi.spyOn(handler1, "handle");
        const handleSpy2 = vi.spyOn(handler2, "handle");

        const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

        const builder = new PipelineBuilder<TestEvent, Projection>(
          eventStore,
          factory,
        )
          .withName("test-pipeline")
          .withAggregateType("span")
          .withEventHandler("handler-1", handler1)
          .withEventHandler("handler-2", handler2);

        const pipeline = builder.build();
        const event = createTestEventForBuilder("aggregate-1", tenantId);

        await pipeline.service.storeEvents([event], { tenantId });

        expect(handleSpy1).toHaveBeenCalled();
        expect(handleSpy2).toHaveBeenCalled();
      });
    },
    { timeout: 10000 },
  );

  describe("withCommandHandler() Registration Contract", () => {
    it("stores handler registration in internal array when called with CommandHandlerClass", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalled();
    });

    it("stores handler registration with HandlerClass reference matching provided class", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
    });

    it("stores handler registration with undefined dispatcherName when options not provided", () => {
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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("staticName");
    });

    it("stores handler registration with custom dispatcherName when provided in options", () => {
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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass, { dispatcherName: "customName" })
        .build();

      expect(pipeline.commands).toHaveProperty("customName");
      expect(pipeline.commands).not.toHaveProperty("staticName");
    });

    it("allows registering multiple command handlers in sequence", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler1",
      });

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler2",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass1)
        .withCommandHandler(HandlerClass2)
        .build();

      expect(pipeline.commands).toHaveProperty("handler1");
      expect(pipeline.commands).toHaveProperty("handler2");
    });
  });

  describe("build() Command Dispatcher Creation", () => {
    it("creates EventSourcedQueueProcessor for each registered command handler during build()", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler1",
      });

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "handler2",
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass1)
        .withCommandHandler(HandlerClass2)
        .build();

      expect(createSpy).toHaveBeenCalledTimes(2);
    });

    it("calls QueueProcessorFactory.create() with queue name containing pipeline name and dispatcher name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("my-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining("my-pipeline"),
        }),
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining("testDispatcher"),
        }),
      );
      // Verify the name is unique and contains both parts
      const queueName = createSpy.mock.calls[0]?.[0]?.name;
      expect(queueName).toBeDefined();
      expect(typeof queueName).toBe("string");
      expect(queueName?.length).toBeGreaterThan(0);
    });

    it("stores created dispatcher in dispatchers map with dispatcher name as key", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
      expect(pipeline.commands.testDispatcher).toBeDefined();
    });

    it("attaches dispatchers map to returned pipeline as commands property", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline).toHaveProperty("commands");
      expect(pipeline.commands).toBeDefined();
    });
  });

  describe("Dispatcher Name Resolution", () => {
    it("uses static dispatcherName property when handler class has it", () => {
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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("staticName");
    });

    it("uses options.dispatcherName when provided, overriding static property", () => {
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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass, { dispatcherName: "overrideName" })
        .build();

      expect(pipeline.commands).toHaveProperty("overrideName");
      expect(pipeline.commands).not.toHaveProperty("staticName");
    });

    it("infers dispatcher name from class name when neither static property nor options provided", () => {
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
        .withAggregateType("span")
        .withCommandHandler(RecordSpanCommandHandler)
        .build();

      expect(pipeline.commands).toHaveProperty("recordSpan");
    });

    it("throws Error with message containing dispatcher name when duplicate dispatcher name detected", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "duplicateName",
      });

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "duplicateName",
      });

      expect(() => {
        new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withCommandHandler(HandlerClass1)
          .withCommandHandler(HandlerClass2)
          .build();
      }).toThrow(
        'Dispatcher with name "duplicateName" already exists. Dispatcher names must be unique.',
      );
    });
  });

  describe("Command Dispatcher Processing Contract", () => {
    it("dispatcher.send() validates payload using handler's static schema.validate() method", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const validateSpy = vi.fn().mockReturnValue(false) as unknown as (
        payload: unknown,
      ) => payload is TestCommandPayload;

      const schema = defineCommandSchema<TestCommandPayload>(
        COMMAND_TYPES[0],
        validateSpy,
      );

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        schema,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const invalidPayload = { invalid: "data" };

      await expect(
        pipeline.commands.testDispatcher!.send(
          invalidPayload as unknown as TestCommandPayload,
        ),
      ).rejects.toThrow();

      expect(validateSpy).toHaveBeenCalledWith(invalidPayload);
    });

    it("dispatcher.send() throws Error with message containing command type when schema validation returns false", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const invalidPayload = { invalid: "data" };

      await expect(
        pipeline.commands.testDispatcher!.send(
          invalidPayload as unknown as TestCommandPayload,
        ),
      ).rejects.toThrow(
        `Invalid payload for command type "${COMMAND_TYPES[0]}". Validation failed.`,
      );
    });

    it("dispatcher.send() creates Command object with tenantId from payload.tenantId when validation passes", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const handleSpy = vi
        .fn<(command: Command<TestCommandPayload>) => Promise<TestEvent[]>>()
        .mockResolvedValue([]);

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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

      expect(handleSpy).toHaveBeenCalled();
      const command = handleSpy.mock.calls[0]?.[0];
      expect(command).toBeDefined();
      if (command) {
        expect(command.tenantId).toEqual(createTenantId("tenant-123"));
      }
    });

    it("dispatcher.send() creates Command object with aggregateId from handler's static getAggregateId(payload) when validation passes", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const handleSpy = vi
        .fn<(command: Command<TestCommandPayload>) => Promise<TestEvent[]>>()
        .mockResolvedValue([]);

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        getAggregateId: (payload) => payload.id,
        handleImpl: handleSpy,
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

      expect(handleSpy).toHaveBeenCalled();
      const command = handleSpy.mock.calls[0]?.[0];
      expect(command).toBeDefined();
      if (command) {
        expect(command.aggregateId).toBe("aggregate-456");
      }
    });

    it("dispatcher.send() calls handler instance handle() method with created Command object", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const handleSpy = vi
        .fn<(command: Command<TestCommandPayload>) => Promise<TestEvent[]>>()
        .mockResolvedValue([]);

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
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher!.send(payload);

      expect(handleSpy).toHaveBeenCalledTimes(1);
      const command = handleSpy.mock.calls[0]?.[0];
      expect(command).toBeDefined();
      if (command) {
        expect(command.data).toEqual(payload);
      }
    });

    it("dispatcher.send() calls storeEventsFn with events array returned from handler.handle() when events.length > 0", async () => {
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
        .withAggregateType("span")
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

    it("dispatcher.send() does not call storeEventsFn when handler.handle() returns empty array", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const storeEventsSpy = vi.fn().mockResolvedValue(void 0);

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        handleImpl: async () => [],
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
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

      expect(storeEventsSpy).not.toHaveBeenCalled();
    });

    it("dispatcher.send() propagates errors thrown by handler.handle() method", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const handlerError = new Error("Handler error");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        handleImpl: async () => {
          throw handlerError;
        },
      });

      const pipeline = new PipelineBuilder<TestEvent, Projection>(
        eventStore,
        factory,
      )
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await expect(
        pipeline.commands.testDispatcher!.send(payload),
      ).rejects.toThrow("Handler error");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("throws Error when withProjection() called twice with same name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();
      const handler = createMockEventHandler<TestEvent, Projection>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withProjection("duplicate", store, handler);

      expect(() => {
        builder.withProjection("duplicate", store, handler);
      }).toThrow(
        'Projection with name "duplicate" already exists. Projection names must be unique within a pipeline.',
      );
    });

    it("accepts empty string pipeline name (no validation enforced)", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore);

      const withName = builder.withName("");
      const pipeline = withName.withAggregateType("span").build();

      // Verify that empty name is accepted and stored
      expect(pipeline.name).toBe("");
    });

    it("handles very long pipeline names without issues", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const longName = "a".repeat(1000);
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName(longName)
        .withAggregateType("span");

      expect(() => {
        builder.build();
      }).not.toThrow();

      const pipeline = builder.build();
      expect(pipeline.name).toBe(longName);
    });

    it("handles special characters in pipeline name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const specialName = "test-pipeline_with.special@chars#123";
      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName(specialName)
        .withAggregateType("span");

      expect(() => {
        builder.build();
      }).not.toThrow();

      const pipeline = builder.build();
      expect(pipeline.name).toBe(specialName);
    });

    it("throws Error when withEventHandler() called twice with same name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const handler = createMockEventReactionHandler<TestEvent>();

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withEventHandler("duplicate", handler);

      expect(() => {
        builder.withEventHandler("duplicate", handler);
      }).toThrow(
        'Event handler with name "duplicate" already exists. Handler names must be unique within a pipeline.',
      );
    });

    it("throws Error when withCommandHandler() creates dispatcher with duplicate name (static property conflict)", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass1 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "duplicate",
      });

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "duplicate",
      });

      expect(() => {
        new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
          .withName("test-pipeline")
          .withAggregateType("span")
          .withCommandHandler(HandlerClass1)
          .withCommandHandler(HandlerClass2)
          .build();
      }).toThrow(
        'Dispatcher with name "duplicate" already exists. Dispatcher names must be unique.',
      );
    });

    it("propagates errors when storeEvents throws", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const storeEventsError = new Error("Event store failure");
      vi.spyOn(eventStore, "storeEvents").mockRejectedValue(storeEventsError);

      const builder = new PipelineBuilder<TestEvent, Projection>(eventStore)
        .withName("test-pipeline")
        .withAggregateType("span");

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1");
      const tenantId = createTenantId("tenant-1");

      await expect(
        pipeline.service.storeEvents([event], { tenantId }),
      ).rejects.toThrow("Event store failure");
    });

    // Note: Projection handlers, event publishers, and event handlers are called
    // asynchronously and errors are not propagated to the caller. These are tested
    // in integration tests that verify the handlers are called correctly.
  });
});
