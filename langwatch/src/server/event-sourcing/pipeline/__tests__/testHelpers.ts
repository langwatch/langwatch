import { vi } from "vitest";
import { z } from "zod";
import type { Command } from "../../commands/command";
import type { CommandHandlerClass } from "../../commands/commandHandlerClass";
import type { CommandSchema } from "../../commands/commandSchema";
import { defineCommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import { COMMAND_TYPES } from "../../domain/commandType";
import { EVENT_TYPES } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import type { Event, Projection } from "../../domain/types";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore, MapProjectionDefinition } from "../../projections/mapProjection.types";
import type {
  EventSourcedQueueProcessor,
} from "../../queues";
import type { JobRegistryEntry } from "../../services/queues/queueManager";
import { createTestEvent } from "../../services/__tests__/testHelpers";
import type { EventStore } from "../../stores/eventStore.types";
import { definePipeline } from "../staticBuilder";

/**
 * Creates a mock EventStore with spyable methods.
 */
export function createMockEventStore<T extends Event>(): EventStore<T> {
  const mockStore = {
    storeEvents: vi.fn().mockResolvedValue(void 0),
    getEvents: vi.fn().mockResolvedValue([]),
    getEventsUpTo: vi
      .fn()
      .mockImplementation(
        async (aggregateId, context, aggregateType, upToEvent) => {
          // Default implementation: get all events and filter
          const allEvents = await mockStore.getEvents(
            aggregateId,
            context,
            aggregateType,
          );
          const upToIndex = allEvents.findIndex(
            (e: T) => e.id === upToEvent.id,
          );
          if (upToIndex === -1) {
            throw new Error(
              `Event ${upToEvent.id} not found in aggregate ${aggregateId}`,
            );
          }
          return allEvents.slice(0, upToIndex + 1);
        },
      ),
    countEventsBefore: vi.fn().mockResolvedValue(0),
  };
  return mockStore;
}

/**
 * Creates a mock global queue and job registry for testing.
 * The global queue has mocked send, sendBatch, close, and waitUntilReady methods.
 */
export function createMockGlobalQueue(): {
  globalQueue: EventSourcedQueueProcessor<Record<string, unknown>>;
  globalJobRegistry: Map<string, JobRegistryEntry>;
} {
  const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };

  const globalJobRegistry = new Map<string, JobRegistryEntry>();

  return { globalQueue, globalJobRegistry };
}

/**
 * Creates a mock EventSourcedQueueProcessor with spyable send method.
 */
export function createMockQueueProcessor<
  Payload extends Record<string, unknown>,
>(): EventSourcedQueueProcessor<Payload> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
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
 *
 * Note: Configuration options like delay, concurrency, and deduplication should be
 * provided via registration options (e.g., `.withCommand("name", Handler, { delay: 1000 })`),
 * not as static class properties.
 */
export function createTestCommandHandlerClass<
  Payload extends TestCommandPayload = TestCommandPayload,
  EventType extends Event = TestEvent,
>(config?: {
  getAggregateId?: (payload: Payload) => string;
  getSpanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  handleImpl?: (command: Command<Payload>) => Promise<EventType[]>;
  schema?: CommandSchema<Payload, CommandType>;
  dispatcherName?: string;
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

    static readonly dispatcherName = config?.dispatcherName as
      | string
      | undefined;

    static getAggregateId(payload: Payload): string {
      return getAggregateId(payload);
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
 * Creates a mock FoldProjectionDefinition for testing.
 */
export function createMockFoldProjection<
  State = unknown,
  E extends Event = Event,
>(config?: {
  name?: string;
  eventTypes?: readonly string[];
  init?: () => State;
  apply?: (state: State, event: E) => State;
  store?: FoldProjectionStore<State>;
}): FoldProjectionDefinition<State, E> {
  return {
    name: config?.name ?? "test-fold-projection",
    version: "2025-01-01",
    eventTypes: config?.eventTypes ?? [EVENT_TYPES[0]],
    init: config?.init ?? (() => ({}) as State),
    apply: config?.apply ?? ((state) => state),
    store: config?.store ?? {
      store: vi.fn().mockResolvedValue(void 0),
      get: vi.fn().mockResolvedValue(null),
    },
  };
}

/**
 * Creates a mock MapProjectionDefinition for testing.
 */
export function createMockMapProjection<
  Record = unknown,
  E extends Event = Event,
>(config?: {
  name?: string;
  eventTypes?: readonly string[];
  map?: (event: E) => Record | null;
  store?: AppendStore<Record>;
}): MapProjectionDefinition<Record, E> {
  return {
    name: config?.name ?? "test-map-projection",
    eventTypes: config?.eventTypes ?? [EVENT_TYPES[0]],
    map: config?.map ?? (() => ({}) as Record),
    store: config?.store ?? {
      append: vi.fn().mockResolvedValue(void 0),
    },
  };
}

/**
 * Test constants.
 */
export const TEST_CONSTANTS = {
  BASE_TIMESTAMP: 1000000,
  AGGREGATE_ID: "test-aggregate-123",
  TENANT_ID_VALUE: "test-tenant",
  PROJECTION_VERSION: "2025-12-17",
  PROJECTION_NAME: "test-projection",
  HANDLER_NAME: "test-handler",
  PIPELINE_NAME: "test-pipeline",
  AGGREGATE_TYPE: "test-aggregate" as AggregateType,
  EVENT_TYPE_1: EVENT_TYPES[0],
  COMMAND_TYPE_1: COMMAND_TYPES[0],
} as const;

/**
 * Creates a test event with a unique ID.
 * IDs are auto-generated to be unique even for events with the same timestamp.
 */
export function createTestEventForBuilder(
  aggregateId: string,
  tenantId = createTenantId(TEST_CONSTANTS.TENANT_ID_VALUE),
  aggregateType: AggregateType = "trace",
): TestEvent {
  return createTestEvent(aggregateId, aggregateType, tenantId) as TestEvent;
}

/**
 * Creates a test projection with proper typing.
 */
export function createTestProjection<TData = unknown>(
  id: string,
  aggregateId: string,
  tenantId: ReturnType<typeof createTenantId>,
  version: string = TEST_CONSTANTS.PROJECTION_VERSION,
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
export const BASE_COMMAND_HANDLER_SCHEMA = defineCommandSchema(
  COMMAND_TYPES[0],
  testCommandPayloadSchema,
);

/**
 * Creates a minimal pipeline definition setup for common test patterns.
 * Returns eventStore, globalQueue, globalJobRegistry, and a helper function to build a pipeline definition with a handler.
 */
export function createMinimalPipelineDefinition() {
  const eventStore = createMockEventStore<TestEvent>();
  const { globalQueue, globalJobRegistry } = createMockGlobalQueue();

  const buildPipelineWithHandler = (
    HandlerClass: CommandHandlerClass<
      TestCommandPayload,
      (typeof COMMAND_TYPES)[number],
      TestEvent
    >,
  ) => {
    return definePipeline<TestEvent>()
      .withName("test-pipeline")
      .withAggregateType("trace")
      .withCommand("testCommand", HandlerClass)
      .build();
  };

  return { eventStore, globalQueue, globalJobRegistry, buildPipelineWithHandler };
}
