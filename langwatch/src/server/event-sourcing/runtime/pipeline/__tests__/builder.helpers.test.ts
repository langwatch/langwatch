import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineBuilder } from "../builder";
import {
  BASE_COMMAND_HANDLER_SCHEMA,
  createMinimalPipelineBuilder,
  createTestCommandHandlerClass,
  TEST_CONSTANTS,
  type TestCommandPayload,
  type TestEvent,
} from "./testHelpers";

describe("Pipeline Builder Helper Functions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("withCommand() name parameter", () => {
    it("uses provided name parameter for command registration", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >();

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("customDispatcher", HandlerClass)
        .build();

      expect(pipeline.commands).toHaveProperty("customDispatcher");
      expect(pipeline.commands.customDispatcher).toBeDefined();
    });
  });

  describe("extractHandlerConfig() behavior (tested via builder)", () => {
    it("preserves HandlerClass context when binding getAggregateId method", async () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      let calledWithContext: unknown = null;

      class TestHandler {
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          calledWithContext = TestHandler;
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      const pipeline = new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", TestHandler)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher.send(payload);

      expect(calledWithContext).toBe(TestHandler);
    });

    it("uses deduplication config from registration options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      const customDeduplicationId = (payload: TestCommandPayload): string =>
        `dedup-${payload.id}`;

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass, {
          deduplication: { makeId: customDeduplicationId },
        })
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deduplication: { makeId: customDeduplicationId },
        }),
      );
    });

    it("does not have deduplication when not provided in options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deduplication: void 0,
        }),
      );
    });

    it("uses delay from registration options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass, { delay: 5000 })
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 5000,
        }),
      );
    });

    it("does not have delay when not provided in options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: void 0,
        }),
      );
    });

    it("extracts spanAttributes function when handler class has getSpanAttributes method", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      class TestHandler {
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        static getSpanAttributes(
          payload: TestCommandPayload,
        ): Record<string, string | number | boolean> {
          return { "payload.id": payload.id, "payload.value": payload.value };
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", TestHandler)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          spanAttributes: expect.any(Function),
        }),
      );

      const spanAttributes = createSpy.mock.calls[0]?.[0]?.spanAttributes;
      expect(spanAttributes).toBeDefined();
      if (spanAttributes) {
        const payload: TestCommandPayload = {
          tenantId: "tenant-1",
          id: "aggregate-1",
          value: 42,
        };
        const attrs = spanAttributes(payload);
        expect(attrs).toEqual({
          "payload.id": "aggregate-1",
          "payload.value": 42,
        });
      }
    });

    it("does not extract spanAttributes when handler class lacks getSpanAttributes method", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          spanAttributes: void 0,
        }),
      );
    });

    it("uses concurrency from registration options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass, { concurrency: 10 })
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { concurrency: 10 },
        }),
      );
    });

    it("does not have concurrency options when not provided in registration options", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({});

      new PipelineBuilder<TestEvent>({
        eventStore,
        queueProcessorFactory: factory,
      })
        .withName("test-pipeline")
        .withAggregateType("trace")
        .withCommand("testDispatcher", HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          options: void 0,
        }),
      );
    });
  });
});
