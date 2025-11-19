import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Projection } from "../../../library/domain/types";
import type { CommandHandlerClass } from "../../../library/commands/commandHandlerClass";
import type { CommandType } from "../../../library/domain/commandType";
import { PipelineBuilder } from "../builder";
import {
  createTestCommandHandlerClass,
  TEST_CONSTANTS,
  BASE_COMMAND_HANDLER_SCHEMA,
  createMinimalPipelineBuilder,
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

  describe("inferDispatcherName() behavior (tested via builder)", () => {
    it("prefers static dispatcherName property over class name inference", () => {
      const { buildPipelineWithHandler } = createMinimalPipelineBuilder();
      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "customDispatcher",
      });

      const pipeline = buildPipelineWithHandler(HandlerClass);

      expect(pipeline.commands).toHaveProperty("customDispatcher");
      expect(pipeline.commands.customDispatcher).toBeDefined();
    });

    it("infers dispatcher name from class name by removing Command/CommandHandler suffix and converting to camelCase", () => {
      const { buildPipelineWithHandler } = createMinimalPipelineBuilder();

      // Test multiple name patterns: CommandHandler suffix, Command suffix, and edge cases
      class RecordSpanCommandHandler {
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      class CreateUserCommandHandler {
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      class ACommandHandler {
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      const pipeline1 = buildPipelineWithHandler(
        RecordSpanCommandHandler as unknown as CommandHandlerClass<
          TestCommandPayload,
          CommandType,
          TestEvent
        >,
      );
      expect(pipeline1.commands).toHaveProperty("recordSpan");

      const pipeline2 = buildPipelineWithHandler(
        CreateUserCommandHandler as unknown as CommandHandlerClass<
          TestCommandPayload,
          CommandType,
          TestEvent
        >,
      );
      expect(pipeline2.commands).toHaveProperty("createUser");

      const pipeline3 = buildPipelineWithHandler(
        ACommandHandler as unknown as CommandHandlerClass<
          TestCommandPayload,
          CommandType,
          TestEvent
        >,
      );
      expect(pipeline3.commands).toHaveProperty("a");
    });
  });

  describe("extractHandlerConfig() behavior (tested via builder)", () => {
    it("preserves HandlerClass context when binding getAggregateId method", async () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      let calledWithContext: unknown = null;

      class TestHandler {
        static readonly dispatcherName = "testDispatcher" as const;
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          calledWithContext = TestHandler;
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
        .withCommandHandler(TestHandler)
        .build();

      const payload: TestCommandPayload = {
        tenantId: "tenant-1",
        id: "aggregate-1",
        value: 42,
      };

      await pipeline.commands.testDispatcher.send(payload);

      expect(calledWithContext).toBe(TestHandler);
    });

    it("extracts makeJobId method when handler class has it", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      class TestHandler {
        static readonly dispatcherName = "testDispatcher" as const;
        static readonly schema = BASE_COMMAND_HANDLER_SCHEMA;

        static getAggregateId(payload: TestCommandPayload): string {
          return payload.id;
        }

        static makeJobId(payload: TestCommandPayload): string {
          return `job-${payload.id}`;
        }

        async handle(): Promise<TestEvent[]> {
          return [];
        }
      }

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(TestHandler)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          makeJobId: expect.any(Function),
        }),
      );

      const makeJobId = createSpy.mock.calls[0]?.[0]?.makeJobId;
      expect(makeJobId).toBeDefined();
      if (makeJobId) {
        const payload: TestCommandPayload = {
          tenantId: "tenant-1",
          id: "aggregate-1",
          value: 42,
        };
        const jobId = makeJobId(payload);
        expect(jobId).toBe("job-aggregate-1");
      }
    });

    it("does not extract makeJobId when handler class lacks the method", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
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

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          makeJobId: void 0,
        }),
      );
    });

    it("extracts delay number when handler class has delay property", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        delay: 5000,
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 5000,
        }),
      );
    });

    it("does not extract delay when handler class lacks the property", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
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
        static readonly dispatcherName = "testDispatcher" as const;
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

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(TestHandler)
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
      >({
        dispatcherName: "testDispatcher",
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          spanAttributes: void 0,
        }),
      );
    });

    it("extracts concurrency number when handler class has concurrency property", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
      const createSpy = vi.spyOn(factory, "create");

      const HandlerClass = createTestCommandHandlerClass<
        TestCommandPayload,
        TestEvent
      >({
        dispatcherName: "testDispatcher",
        concurrency: 10,
      });

      new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
        .withName("test-pipeline")
        .withAggregateType("span")
        .withCommandHandler(HandlerClass)
        .build();

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { concurrency: 10 },
        }),
      );
    });

    it("does not extract concurrency options when handler class lacks the property", () => {
      const { eventStore, factory } = createMinimalPipelineBuilder();
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

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          options: void 0,
        }),
      );
    });
  });
});
