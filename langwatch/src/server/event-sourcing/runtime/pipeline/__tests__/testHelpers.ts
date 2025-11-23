import { vi } from "vitest";
import { z } from "zod";
import type { Event, Projection } from "../../../library/domain/types";
import type { CommandType } from "../../../library/domain/commandType";
import type { EventStore } from "../../../library/stores/eventStore.types";
import type { ProjectionStore } from "../../../library/stores/projectionStore.types";
import type { EventPublisher } from "../../../library/publishing/eventPublisher.types";
import type { EventHandler } from "../../../library/domain/handlers/eventHandler";
import type { EventHandlerClass } from "../../../library/domain/handlers/eventHandlerClass";
import type { ProjectionHandler } from "../../../library/domain/handlers/projectionHandler";
import type { ProjectionHandlerClass } from "../../../library/domain/handlers/projectionHandlerClass";
import type { CommandHandlerClass } from "../../../library/commands/commandHandlerClass";
import type { CommandSchema } from "../../../library/commands/commandSchema";
import type { Command } from "../../../library/commands/command";
import type {
  EventSourcedQueueProcessor,
  EventSourcedQueueDefinition,
} from "../../../library/queues";
import type { QueueProcessorFactory } from "../../queue";
import { COMMAND_TYPES } from "../../../library/domain/commandType";
import { EVENT_TYPES } from "../../../library/domain/eventType";
import { defineCommandSchema } from "../../../library/commands/commandSchema";
import { createTenantId } from "../../../library/domain/tenantId";
import { createTestEvent } from "../../../library/services/__tests__/testHelpers";
import { PipelineBuilder } from "../builder";
import type { AggregateType } from "~/server/event-sourcing/library";

/**
 * Creates a mock EventStore with spyable methods.
 */
export function createMockEventStore<T extends Event>(): EventStore<T> {
  return {
    storeEvents: vi.fn().mockResolvedValue(void 0),
    getEvents: vi.fn().mockResolvedValue([]),
    countEventsBefore: vi.fn().mockResolvedValue(0),
  };
}

/**
 * Creates a mock QueueProcessorFactory that creates spyable processors.
 * The created processors store their process function for testing.
 */
export function createMockQueueProcessorFactory(): QueueProcessorFactory & {
  getCreatedProcessors: () => Array<{
    name: string;
    process: (payload: unknown) => Promise<void>;
    definition: EventSourcedQueueDefinition<unknown>;
  }>;
} {
  const createdProcessors: Array<{
    name: string;
    process: (payload: unknown) => Promise<void>;
    definition: EventSourcedQueueDefinition<unknown>;
  }> = [];

  const factory = {
    create<Payload>(
      definition: EventSourcedQueueDefinition<Payload>,
    ): EventSourcedQueueProcessor<Payload> {
      const processFn = definition.process;
      const processor: EventSourcedQueueProcessor<Payload> = {
        send: vi.fn().mockImplementation(async (payload: Payload) => {
          await processFn(payload);
        }),
        close: vi.fn().mockResolvedValue(void 0),
      };
      createdProcessors.push({
        name: definition.name,
        process: processFn as (payload: unknown) => Promise<void>,
        definition: definition as EventSourcedQueueDefinition<unknown>,
      });
      return processor;
    },
    getCreatedProcessors: () => createdProcessors,
  };

  return factory;
}

/**
 * Creates a mock EventSourcedQueueProcessor with spyable send method.
 */
export function createMockQueueProcessor<
  Payload,
>(): EventSourcedQueueProcessor<Payload> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Test payload interface for command handlers.
 */
export interface TestCommandPayload {
  tenantId: string;
  id: string;
  value: number;
}

/**
 * Zod schema for test command payload.
 */
export const testCommandPayloadSchema = z.object({
  tenantId: z.string(),
  id: z.string(),
  value: z.number(),
});

/**
 * Test event interface.
 */
export interface TestEvent extends Event<{ result: string }> {
  type: (typeof EVENT_TYPES)[number];
}

/**
 * Creates a test command handler class with configurable properties.
 */
export function createTestCommandHandlerClass<
  Payload extends TestCommandPayload = TestCommandPayload,
  EventType extends Event = TestEvent,
>(config?: {
  getAggregateId?: (payload: Payload) => string;
  makeJobId?: (payload: Payload) => string;
  delay?: number;
  concurrency?: number;
  getSpanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  handleImpl?: (command: Command<Payload>) => Promise<EventType[]>;
  schema?: CommandSchema<Payload, CommandType>;
}): CommandHandlerClass<Payload, CommandType, EventType> {
  const getAggregateId =
    config?.getAggregateId ?? ((payload: Payload) => payload.id);
  const handleImpl =
    config?.handleImpl ??
    (async (): Promise<EventType[]> => {
      return [] as EventType[];
    });

  class TestCommandHandler {
    static readonly schema: CommandSchema<Payload, CommandType> =
      config?.schema ??
      (defineCommandSchema(
        COMMAND_TYPES[0],
        testCommandPayloadSchema,
      ) as CommandSchema<Payload, CommandType>);

    static getAggregateId(payload: Payload): string {
      return getAggregateId(payload);
    }

    static get makeJobId() {
      return config?.makeJobId;
    }

    static get delay() {
      return config?.delay;
    }

    static get concurrency() {
      return config?.concurrency;
    }

    static get getSpanAttributes() {
      return config?.getSpanAttributes;
    }

    async handle(command: Command<Payload>): Promise<EventType[]> {
      return handleImpl(command);
    }
  }

  return TestCommandHandler as CommandHandlerClass<
    Payload,
    CommandType,
    EventType
  >;
}

/**
 * Creates a test PipelineBuilder with mock dependencies.
 */
export function createTestPipelineBuilder<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
>(
  eventStore?: EventStore<EventType>,
  queueProcessorFactory?: QueueProcessorFactory,
): PipelineBuilder<EventType, ProjectionType> {
  const mockEventStore = eventStore ?? createMockEventStore<EventType>();
  const mockFactory =
    queueProcessorFactory ?? createMockQueueProcessorFactory();

  return new PipelineBuilder<EventType, ProjectionType>(
    mockEventStore,
    mockFactory,
  );
}

/**
 * Creates a mock ProjectionStore.
 */
export function createMockProjectionStore<
  T extends Projection,
>(): ProjectionStore<T> {
  return {
    getProjection: vi.fn().mockResolvedValue(null),
    storeProjection: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock ProjectionHandler for projections.
 */
export function createMockEventHandler<
  TEvent extends Event,
  TProjection extends Projection,
>(): ProjectionHandler<TEvent, TProjection> {
  return {
    handle: vi.fn().mockResolvedValue({
      id: "test-projection-id",
      aggregateId: "test-aggregate",
      tenantId: createTenantId("test-tenant"),
      version: 1000000,
      data: {},
    } as TProjection),
  };
}

/**
 * Creates a mock EventHandler.
 */
export function createMockEventReactionHandler<
  T extends Event,
>(): EventHandler<T> {
  return {
    handle: vi.fn().mockResolvedValue(void 0),
    getEventTypes: vi.fn().mockReturnValue(void 0),
  };
}

/**
 * Creates a test event handler class with configurable properties.
 */
export function createTestEventHandlerClass<
  T extends Event = TestEvent,
>(config?: {
  getEventTypes?: () => readonly T["type"][] | undefined;
  handleImpl?: (event: T) => Promise<void>;
}): EventHandlerClass<T> {
  class TestEventHandler {
    static getEventTypes() {
      return config?.getEventTypes?.();
    }

    async handle(event: T): Promise<void> {
      if (config?.handleImpl) {
        return config.handleImpl(event);
      }
    }
  }

  return TestEventHandler as EventHandlerClass<T>;
}

/**
 * Creates a test projection handler class with configurable properties.
 */
export function createTestProjectionHandlerClass<
  TEvent extends Event = TestEvent,
  TProjection extends Projection = Projection,
>(config?: {
  store?: ProjectionStore<TProjection>;
  handleImpl?: (stream: any) => Promise<TProjection> | TProjection;
}): ProjectionHandlerClass<TEvent, TProjection> {
  const store = config?.store ?? createMockProjectionStore<TProjection>();

  class TestProjectionHandler {
    static readonly store = store;

    handle(stream: any): Promise<TProjection> | TProjection {
      if (config?.handleImpl) {
        return config.handleImpl(stream);
      }
      return {
        id: "test-projection-id",
        aggregateId: "test-aggregate",
        tenantId: createTenantId("test-tenant"),
        version: 1000000,
        data: {},
      } as TProjection;
    }
  }

  return TestProjectionHandler as ProjectionHandlerClass<TEvent, TProjection>;
}

/**
 * Creates a mock EventPublisher.
 */
export function createMockEventPublisher<T extends Event>(): EventPublisher<T> {
  return {
    publish: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Test constants.
 */
export const TEST_CONSTANTS = {
  BASE_TIMESTAMP: 1000000,
  AGGREGATE_ID: "test-aggregate-123",
  TENANT_ID_VALUE: "test-tenant",
  PROJECTION_NAME: "test-projection",
  HANDLER_NAME: "test-handler",
  PIPELINE_NAME: "test-pipeline",
  AGGREGATE_TYPE: "test-aggregate" as AggregateType,
  EVENT_TYPE_1: EVENT_TYPES[0],
  COMMAND_TYPE_1: COMMAND_TYPES[0],
} as const;

/**
 * Creates a test event.
 */
export function createTestEventForBuilder(
  aggregateId: string,
  tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
): TestEvent {
  return createTestEvent(aggregateId, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId) as TestEvent;
}

/**
 * Creates a test projection with proper typing.
 */
export function createTestProjection<TData = unknown>(
  id: string,
  aggregateId: string,
  tenantId: ReturnType<typeof createTenantId>,
  version: number = TEST_CONSTANTS.BASE_TIMESTAMP,
  data: TData = {} as TData,
): Projection<TData> {
  return {
    id,
    aggregateId,
    tenantId,
    version,
    data,
  };
}

/**
 * Common schema definition for command handler tests that need name inference.
 * This reduces duplication in tests that create classes with specific names.
 */
export const BASE_COMMAND_HANDLER_SCHEMA =
  defineCommandSchema(
    COMMAND_TYPES[0],
    testCommandPayloadSchema,
  );

/**
 * Creates a minimal pipeline builder setup for common test patterns.
 * Returns eventStore, factory, and a helper function to build a pipeline with a handler.
 */
export function createMinimalPipelineBuilder() {
  const eventStore = createMockEventStore<TestEvent>();
  const factory = createMockQueueProcessorFactory();

  const buildPipelineWithHandler = (
    HandlerClass: CommandHandlerClass<
      TestCommandPayload,
      (typeof COMMAND_TYPES)[number],
      TestEvent
    >,
  ) => {
    return new PipelineBuilder<TestEvent, Projection>(eventStore, factory)
      .withName("test-pipeline")
      .withAggregateType("span_ingestion")
      .withCommand("testCommand", HandlerClass)
      .build();
  };

  return { eventStore, factory, buildPipelineWithHandler };
}
