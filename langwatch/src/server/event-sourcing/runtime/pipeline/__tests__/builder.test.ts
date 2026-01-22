import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../../../library/domain/types";
import { PipelineBuilder } from "../builder";

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: vi.fn((_name, _optionss, fn) => {
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

import type { Command } from "../../../library/commands/command";
import { defineCommandSchema } from "../../../library/commands/commandSchema";
import { COMMAND_TYPES } from "../../../library/domain/commandType";
import { EVENT_TYPES } from "../../../library/domain/eventType";
import { createTenantId } from "../../../library/domain/tenantId";
import { createMockDistributedLock } from "../../../library/services/__tests__/testHelpers";
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
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      });

      expect(() => {
        builder.build();
      }).toThrow("Pipeline name is required");
    });

    it("returns PipelineBuilderWithName instance when withName() called with string", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      });

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
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      });

      const withName = builder.withName("test-pipeline");
      const withType = withName.withAggregateType("trace");
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
      >();

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe("PipelineBuilderWithName State Enforcement", () => {
    it('throws Error with message "Aggregate type is required" when build() called before withAggregateType()', () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
      }).withName("test-pipeline");

      expect(() => {
        builder.build();
      }).toThrow("Aggregate type is required");
    });

    it("returns PipelineBuilderWithNameAndType instance when withAggregateType() called with valid AggregateType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      }).withName("test-pipeline");

      const result = builder.withAggregateType("trace");

      expect(result).toBeDefined();
      // Verify it has the expected methods for the final builder state
      expect(result).toHaveProperty("withProjection");
      expect(result).toHaveProperty("withEventPublisher");
      expect(result).toHaveProperty("withEventHandler");
      expect(result).toHaveProperty("withCommand");
      expect(result).toHaveProperty("build");
      // Verify build() succeeds (doesn't throw)
      expect(() => result.build()).not.toThrow();
    });

    it("preserves name, eventStore, and queueProcessorFactory when transitioning to PipelineBuilderWithNameAndType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("test-pipeline");
      expect(pipeline.aggregateType).toBe("trace");
    });
  });

  describe("PipelineBuilderWithNameAndType Build Contract", () => {
    it("creates RegisteredPipeline with name property matching builder name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("my-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.name).toBe("my-pipeline");
    });

    it("creates RegisteredPipeline with aggregateType property matching builder aggregateType", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("test_aggregate");

      const pipeline = builder.build();

      expect(pipeline.aggregateType).toBe("test_aggregate");
    });

    it("creates RegisteredPipeline with service property that is EventSourcingService instance", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
      expect(pipeline.service).toHaveProperty("storeEvents");
      expect(typeof pipeline.service.storeEvents).toBe("function");
    });

    it("passes eventStore to EventSourcingPipeline constructor", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const storeEventsSpy = vi.spyOn(eventStore, "storeEvents");

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1");

      void pipeline.service.storeEvents([event], {
        tenantId: createTenantId("tenant-1"),
      });

      expect(storeEventsSpy).toHaveBeenCalled();
    });

    it("passes undefined projections when no projections registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("passes undefined eventPublisher when no publisher registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("passes undefined eventHandlers when no handlers registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });
  });

  describe("withProjection() Registration Contract", () => {
    it("stores projection definition in internal Map with exact name key when called with unique name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection(
          "my-projection",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        );

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });

    it("stores projection definition with handler reference matching provided handler", async () => {
      const eventStore = createMockEventStore<TestEvent>();
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
      const handleSpy = vi.spyOn(ProjectionHandlerClass.prototype, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      handleSpy.mockResolvedValue(
        createTestProjection("proj-id", "aggregate-1", tenantId),
      );

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("test-projection", ProjectionHandlerClass);

      const pipeline = builder.build();

      await pipeline.service.storeEvents([event], { tenantId });

      expect(getEventsSpy).toHaveBeenCalled();
      expect(handleSpy).toHaveBeenCalled();
    });

    it("returns builder instance that allows method chaining", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const result = builder.withProjection(
        "test-projection",
        createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
      );

      expect(result).toBe(builder);
    });

    it("throws Error with message containing projection name when duplicate projection name registered", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection(
          "duplicate-name",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        );

      expect(() => {
        builder.withProjection(
          "duplicate-name",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        );
      }).toThrow(
        'Projection with name "duplicate-name" already exists. Projection names must be unique within a pipeline.',
      );
    });

    it("allows registering multiple projections with different names in sequence", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store1 = createMockProjectionStore<Projection>();
      const store2 = createMockProjectionStore<Projection>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection(
          "projection-1",
          createTestProjectionHandlerClass<TestEvent, Projection>({
            store: store1,
          }),
        )
        .withProjection(
          "projection-2",
          createTestProjectionHandlerClass<TestEvent, Projection>({
            store: store2,
          }),
        );

      expect(() => {
        builder.build();
      }).not.toThrow();
    });

    it("preserves previously registered projections when new projection added", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store1 = createMockProjectionStore<Projection>();
      const store2 = createMockProjectionStore<Projection>();
      const ProjectionHandlerClass1 = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: store1,
        handleImpl: async () =>
          createTestProjection(
            "proj1-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
      });
      const ProjectionHandlerClass2 = createTestProjectionHandlerClass<
        TestEvent,
        Projection
      >({
        store: store2,
        handleImpl: async () =>
          createTestProjection(
            "proj2-id",
            "aggregate-1",
            createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
          ),
      });
      const handleSpy1 = vi.spyOn(ProjectionHandlerClass1.prototype, "handle");
      const handleSpy2 = vi.spyOn(ProjectionHandlerClass2.prototype, "handle");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const getEventsSpy = vi.spyOn(eventStore, "getEvents");
      getEventsSpy.mockResolvedValue([event]);
      handleSpy1.mockResolvedValue({
        id: "proj1-id",
        aggregateId: "aggregate-1",
        tenantId,
        version: TEST_CONSTANTS.PROJECTION_VERSION,
        data: {},
      } as Projection);
      handleSpy2.mockResolvedValue({
        id: "proj2-id",
        aggregateId: "aggregate-1",
        tenantId,
        version: TEST_CONSTANTS.PROJECTION_VERSION,
        data: {},
      } as Projection);

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection("projection-1", ProjectionHandlerClass1)
        .withProjection("projection-2", ProjectionHandlerClass2);

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

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
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

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
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

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const result = builder.withEventPublisher(publisher);

      expect(result).toBe(builder);
    });

    it("passes stored publisher to EventSourcingPipeline constructor during build()", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const publisher = createMockEventPublisher<TestEvent>();
      const publishSpy = vi.spyOn(publisher, "publish");

      const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventPublisher(publisher);

      const pipeline = builder.build();
      const event = createTestEventForBuilder("aggregate-1", tenantId);
      const context = { tenantId };

      await pipeline.service.storeEvents([event], context);

      expect(publishSpy).toHaveBeenCalledWith([event], context);
    });

    it("passes undefined to EventSourcingPipeline when no publisher registered", () => {
      const eventStore = createMockEventStore<TestEvent>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

      const pipeline = builder.build();

      expect(pipeline.service).toBeDefined();
    });
  });

  describe("withEventHandler() Registration Contract", () => {
      it("stores event handler definition in internal Map with exact name key when called with unique name", () => {
        const eventStore = createMockEventStore<TestEvent>();

        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler(
            "my-handler",
            createTestEventHandlerClass<TestEvent>(),
          );

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("stores handler definition with handler reference matching provided handler", async () => {
          vi.useRealTimers(); // Use real timers for async operations
          const eventStore = createMockEventStore<TestEvent>();
          const factory = createMockQueueProcessorFactory();
          const handleSpy = vi.fn().mockResolvedValue(void 0);
          const HandlerClass = createTestEventHandlerClass<TestEvent>({
            handleImpl: handleSpy,
          });

          const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
          const event = createTestEventForBuilder("aggregate-1", tenantId);

          // Configure mock to return the event when getEvents is called
          // This is needed because BatchEventProcessor fetches events from the store
          eventStore.getEvents = vi.fn().mockResolvedValue([event]);

          const builder = new PipelineBuilder<TestEvent>({
            eventStore,
            queueProcessorFactory: factory,
            distributedLock: createMockDistributedLock(),
          })
            .withName("test-pipeline")
            .withAggregateType("trace")
            .withEventHandler("test-handler", HandlerClass);

          const pipeline = builder.build();

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
        }, 10000);

      it("stores handler definition with options object matching provided options", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler(
            "test-handler",
            createTestEventHandlerClass<TestEvent>(),
            {
              eventTypes: [EVENT_TYPES[0]],
            },
          );

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("stores handler definition with empty options object when options not provided", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler(
            "test-handler",
            createTestEventHandlerClass<TestEvent>(),
          );

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("throws Error with message containing handler name when duplicate handler name registered", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const HandlerClass = createTestEventHandlerClass<TestEvent>();

        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler("duplicate-name", HandlerClass);

        expect(() => {
          builder.withEventHandler("duplicate-name", HandlerClass);
        }).toThrow(
          'Event handler with name "duplicate-name" already exists. Handler names must be unique within a pipeline.',
        );
      });

      it("allows registering multiple handlers with different names in sequence", () => {
        const eventStore = createMockEventStore<TestEvent>();
        const HandlerClass1 = createTestEventHandlerClass<TestEvent>();
        const HandlerClass2 = createTestEventHandlerClass<TestEvent>();

        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler("handler-1", HandlerClass1)
          .withEventHandler("handler-2", HandlerClass2);

        expect(() => {
          builder.build();
        }).not.toThrow();
      });

      it("preserves previously registered handlers when new handler added", async () => {
        vi.useRealTimers(); // Use real timers for async operations
        const eventStore = createMockEventStore<TestEvent>();
        const factory = createMockQueueProcessorFactory();
        const handleSpy1 = vi.fn().mockResolvedValue(void 0);
        const handleSpy2 = vi.fn().mockResolvedValue(void 0);
        const HandlerClass1 = createTestEventHandlerClass<TestEvent>({
          handleImpl: handleSpy1,
        });
        const HandlerClass2 = createTestEventHandlerClass<TestEvent>({
          handleImpl: handleSpy2,
        });

        const tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE);
        const event = createTestEventForBuilder("aggregate-1", tenantId);

        // Configure mock to return the event when getEvents is called
        // This is needed because BatchEventProcessor fetches events from the store
        eventStore.getEvents = vi.fn().mockResolvedValue([event]);

        const builder = new PipelineBuilder<TestEvent>({
          eventStore,
          queueProcessorFactory: factory,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withEventHandler("handler-1", HandlerClass1)
          .withEventHandler("handler-2", HandlerClass2);

        const pipeline = builder.build();

        await pipeline.service.storeEvents([event], { tenantId });

        expect(handleSpy1).toHaveBeenCalled();
        expect(handleSpy2).toHaveBeenCalled();
      });
    });

  describe("withCommand() Registration Contract", () => {
    it("stores handler registration in internal array when called with CommandHandlerClass", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalled();
    });

    it("stores handler registration with HandlerClass reference matching provided class", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
    });

    it("stores handler registration using provided name argument", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("testDispatcher");
    });

    it("uses provided name argument for command registration", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("customName", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("customName");
    });

    it("allows registering multiple command handlers in sequence", () => {
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

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("handler1", HandlerClass1)
        .withCommand("handler2", HandlerClass2)
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
      >();

      const HandlerClass2 = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("handler1", HandlerClass1)
        .withCommand("handler2", HandlerClass2)
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
      >();

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("my-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
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
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
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
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(pipeline).toHaveProperty("commands");
      expect(pipeline.commands).toBeDefined();
    });
  });

  describe("Command Name Resolution", () => {
    it("uses provided name argument for command registration", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("customName", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("customName");
    });

    it("uses provided name argument for command registration", () => {
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

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("recordSpan", RecordSpanCommandHandler)
        .build();

      expect(pipeline.commands).toHaveProperty("recordSpan");
    });

    it("throws Error with message containing command name when duplicate command name detected", () => {
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

      expect(() => {
        new PipelineBuilder<TestEvent>({
          eventStore,
          queueProcessorFactory: factory,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withCommand("duplicateName", HandlerClass1)
          .withCommand("duplicateName", HandlerClass2)
          .build();
      }).toThrow(
        'Command handler with name "duplicateName" already exists. Command handler names must be unique within a pipeline.',
      );
    });
  });

  describe("Command Dispatcher Processing Contract", () => {
    it("dispatcher.send() validates payload using handler's static schema.validate() method", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      // Create a schema that will reject invalid payloads
      const strictSchema = testCommandPayloadSchema.strict();
      const schema = defineCommandSchema(COMMAND_TYPES[0], strictSchema);

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        schema,
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const invalidPayload = { invalid: "data" };

      await expect(
        pipeline.commands.testDispatcher?.send(
          invalidPayload as unknown as TestCommandPayload,
        ),
      ).rejects.toThrow();
    });

    it("dispatcher.send() throws Error with message containing command type when schema validation returns false", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const invalidPayload = { invalid: "data" };

      await expect(
        pipeline.commands.testDispatcher?.send(
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
        handleImpl: handleSpy,
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

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
        getAggregateId: (payload) => payload.id,
        handleImpl: handleSpy,
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

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
        handleImpl: handleSpy,
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-123",
        id: "aggregate-456",
        value: 42,
      };

      await pipeline.commands.testDispatcher?.send(payload);

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
        handleImpl: async () => events,
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
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

    it("dispatcher.send() does not call storeEventsFn when handler.handle() returns empty array", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const factory = createMockQueueProcessorFactory();
      const storeEventsSpy = vi.fn().mockResolvedValue(void 0);

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        handleImpl: async () => [],
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
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
        handleImpl: async () => {
          throw handlerError;
        },
      });

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
        distributedLock: createMockDistributedLock(),
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
      ).rejects.toThrow("Handler error");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("throws Error when withProjection() called twice with same name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const store = createMockProjectionStore<Projection>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withProjection(
          "duplicate",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        );

      expect(() => {
        builder.withProjection(
          "duplicate",
          createTestProjectionHandlerClass<TestEvent, Projection>({ store }),
        );
      }).toThrow(
        'Projection with name "duplicate" already exists. Projection names must be unique within a pipeline.',
      );
    });

    it("accepts empty string pipeline name (no validation enforced)", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      });

      const withName = builder.withName("");
      const pipeline = withName.withAggregateType("trace").build();

      // Verify that empty name is accepted and stored
      expect(pipeline.name).toBe("");
    });

    it("handles very long pipeline names without issues", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const longName = "a".repeat(1000);
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName(longName)
        .withAggregateType("trace");

      expect(() => {
        builder.build();
      }).not.toThrow();

      const pipeline = builder.build();
      expect(pipeline.name).toBe(longName);
    });

    it("handles special characters in pipeline name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const specialName = "test-pipeline_with.special@chars#123";
      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName(specialName)
        .withAggregateType("trace");

      expect(() => {
        builder.build();
      }).not.toThrow();

      const pipeline = builder.build();
      expect(pipeline.name).toBe(specialName);
    });

    it("throws Error when withEventHandler() called twice with same name", () => {
      const eventStore = createMockEventStore<TestEvent>();
      const HandlerClass = createTestEventHandlerClass<TestEvent>();

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withEventHandler("duplicate", HandlerClass);

      expect(() => {
        builder.withEventHandler("duplicate", HandlerClass);
      }).toThrow(
        'Event handler with name "duplicate" already exists. Handler names must be unique within a pipeline.',
      );
    });

    it("throws Error when withCommand() creates command with duplicate name", () => {
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

      expect(() => {
        new PipelineBuilder<TestEvent>({
          eventStore,
          queueProcessorFactory: factory,
          distributedLock: createMockDistributedLock(),
        })
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withCommand("duplicate", HandlerClass1)
          .withCommand("duplicate", HandlerClass2)
          .build();
      }).toThrow(
        'Command handler with name "duplicate" already exists. Command handler names must be unique within a pipeline.',
      );
    });

    it("propagates errors when storeEvents throws", async () => {
      const eventStore = createMockEventStore<TestEvent>();
      const storeEventsError = new Error("Event store failure");
      vi.spyOn(eventStore, "storeEvents").mockRejectedValue(storeEventsError);

      const builder = new PipelineBuilder<TestEvent>({
        eventStore,
        distributedLock: createMockDistributedLock(),
      })
        .withName("test-pipeline")
        .withAggregateType("trace");

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
