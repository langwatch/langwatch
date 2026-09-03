import type { Logger } from "@langwatch/observability";
import { vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { EventType } from "../../domain/eventType";
import type { TenantId } from "../../domain/tenantId";
import { createTenantId } from "../../domain/tenantId";
import type { Event, Projection } from "../../domain/types";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../../projections/foldProjection.types";
import type { AppendStore, MapProjectionDefinition } from "../../projections/mapProjection.types";
import type { EventStore, EventStoreReadContext } from "../../stores/eventStore.types";
import type { QueueManager } from "../queues/queueManager";

export const TEST_EVENT_TYPES = ["test.event.one", "test.event.two"] as const;
export const TEST_COMMAND_TYPES = ["test.command.run"] as const;

/**
 * Creates a mock QueueManager. Defaults to the inline (no-queue) configuration
 * so routers process projections and subscribers synchronously without Redis or
 * a queue.
 */
export function createMockQueueManager(overrides?: {
  hasProjectionSubscriberQueues?: boolean;
  getProjectionSubscriberQueue?: ReturnType<typeof vi.fn>;
}): QueueManager<Event> {
  return {
    hasProjectionQueues: vi.fn().mockReturnValue(false),
    hasHandlerQueues: vi.fn().mockReturnValue(false),
    hasSubscriberQueues: vi.fn().mockReturnValue(false),
    hasProjectionSubscriberQueues: vi
      .fn()
      .mockReturnValue(overrides?.hasProjectionSubscriberQueues ?? false),
    getProjectionQueue: vi.fn().mockReturnValue(undefined),
    getHandlerQueue: vi.fn().mockReturnValue(undefined),
    getSubscriberQueue: vi.fn().mockReturnValue(undefined),
    getProjectionSubscriberQueue:
      overrides?.getProjectionSubscriberQueue ?? vi.fn().mockReturnValue(undefined),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
    initializeProjectionQueues: vi.fn(),
    initializeHandlerQueues: vi.fn(),
    initializeSubscriberQueues: vi.fn(),
    initializeProjectionSubscriberQueues: vi.fn(),
  } as unknown as QueueManager<Event>;
}

/**
 * Creates a mock EventStore with default implementations.
 */
export function createMockEventStore<T extends Event>(): EventStore<T> {
  const mockStore = {
    storeEvents: vi.fn().mockResolvedValue(void 0),
    getEvent: vi.fn(),
    getEvents: vi.fn().mockResolvedValue([]),
    getEventsOccurredSince: vi.fn().mockResolvedValue([]),
    getEventsUpTo: vi
      .fn()
      .mockImplementation(async (aggregateId, context, aggregateType, upToEvent) => {
        // Default implementation: get all events and filter
        const allEvents = await mockStore.getEvents(aggregateId, context, aggregateType);
        const upToIndex = allEvents.findIndex((e: T) => e.id === upToEvent.id);
        if (upToIndex === -1) {
          throw new Error(`Event ${upToEvent.id} not found in aggregate ${aggregateId}`);
        }
        return allEvents.slice(0, upToIndex + 1);
      }),
    countEventsBefore: vi.fn().mockResolvedValue(0),
  };
  return mockStore;
}

/**
 * Creates a mock FoldProjectionStore with default implementations.
 */
export function createMockFoldProjectionStore<State>(): FoldProjectionStore<State> {
  return {
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock AppendStore with default implementations.
 */
export function createMockAppendStore<Record>(): AppendStore<Record> {
  return {
    append: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock FoldProjectionDefinition for testing.
 *
 * The apply function acts as a pass-through by default: it returns the state unchanged.
 * Tests can override apply behavior by mocking the returned definition's apply function.
 */
export function createMockFoldProjectionDefinition<TEvent extends Event = Event>(
  name: string,
  overrides?: {
    store?: FoldProjectionStore<any>;
    init?: () => any;
    apply?: (state: any, event: TEvent) => any;
    eventTypes?: readonly string[];
    version?: string;
    options?: FoldProjectionDefinition<any, TEvent>["options"];
  },
): FoldProjectionDefinition<any, TEvent> {
  const store = overrides?.store ?? createMockFoldProjectionStore();
  return {
    name,
    version: overrides?.version ?? "2025-01-01",
    LastEventOccurredAtKey: "LastEventOccurredAt",
    eventTypes: overrides?.eventTypes ?? TEST_EVENT_TYPES,
    init: overrides?.init ?? vi.fn().mockReturnValue({}),
    apply: overrides?.apply ?? vi.fn().mockImplementation((state: any) => state),
    store,
    options: overrides?.options,
  };
}

/**
 * Creates a mock MapProjectionDefinition for testing.
 *
 * The map function returns the event by default (pass-through).
 * Tests can override map behavior by mocking the returned definition's map function.
 */
export function createMockMapProjectionDefinition<TEvent extends Event = Event>(
  name: string,
  overrides?: {
    store?: AppendStore<any>;
    map?: (event: TEvent) => any;
    eventTypes?: readonly string[];
    options?: MapProjectionDefinition<any, TEvent>["options"];
  },
): MapProjectionDefinition<any, TEvent> {
  const store = overrides?.store ?? createMockAppendStore();
  return {
    name,
    eventTypes: overrides?.eventTypes ?? [],
    map: overrides?.map ?? vi.fn().mockImplementation((event: TEvent) => event),
    store,
    options: overrides?.options,
  };
}

/**
 * Creates a mock Logger.
 */
export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: false,
  } as unknown as Logger;
}

// Counter for generating unique event IDs in tests
let testEventIdCounter = 0;

/**
 * Creates a test event with predictable values.
 * IDs are auto-generated to be unique even for events with the same timestamp.
 */
export function createTestEvent(
  aggregateId: string,
  aggregateType: AggregateType,
  tenantId: TenantId,
  type: EventType = TEST_EVENT_TYPES[0],
  createdAt = 1000000,
  version = "2025-12-17",
  data: unknown = {},
  id?: string,
): Event {
  const uniqueId =
    id ?? `${createdAt}:${tenantId}:${aggregateId}:${aggregateType}:${testEventIdCounter++}`;
  return {
    id: uniqueId,
    aggregateId,
    aggregateType,
    tenantId,
    createdAt,
    occurredAt: createdAt,
    version,
    type,
    data,
  };
}

/**
 * Creates a test projection with predictable values.
 */
export function createTestProjection<Data = unknown>(
  aggregateId: string,
  tenantId: TenantId,
  data: Data = {} as Data,
  version = "2025-12-17",
  id?: string,
): Projection<Data> {
  return {
    id: id ?? `projection-${aggregateId}`,
    aggregateId,
    tenantId,
    version,
    data,
  };
}

/**
 * Creates a test EventStoreReadContext.
 */
export function createTestEventStoreReadContext<T extends Event>(
  tenantId: TenantId,
  metadata?: Record<string, unknown>,
): EventStoreReadContext<T> {
  return {
    tenantId,
    ...(metadata && { metadata }),
  };
}

/**
 * Creates a test TenantId.
 */
export function createTestTenantId(value = "test-tenant"): TenantId {
  return createTenantId(value);
}

/**
 * Creates a test AggregateType.
 */
export function createTestAggregateType(): AggregateType {
  return "trace";
}

/**
 * Common test constants.
 */
export const TEST_CONSTANTS = {
  BASE_TIMESTAMP: 1000000,
  AGGREGATE_ID: "test-aggregate-123",
  TENANT_ID_VALUE: "test-tenant",
  PROJECTION_NAME: "test-projection",
  PIPELINE_NAME: "test-pipeline",
  HANDLER_NAME: "test-handler",
  AGGREGATE_TYPE: "trace" as const satisfies AggregateType,
  EVENT_TYPE_1: TEST_EVENT_TYPES[0],
  EVENT_TYPE_2: TEST_EVENT_TYPES[1],
} as const;

/**
 * Sets up common test environment (fake timers, base timestamp).
 * Call this in beforeEach() hooks.
 */
export function setupTestEnvironment(): void {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
}

/**
 * Cleans up test environment (restore real timers, clear mocks).
 * Call this in afterEach() hooks.
 */
export function cleanupTestEnvironment(): void {
  vi.useRealTimers();
  vi.restoreAllMocks();
}

/**
 * Creates a standard test context with common test values.
 * Returns an object with aggregateType, tenantId, and context.
 */
export function createTestContext() {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const eventVersion = "2025-12-17";
  const context = createTestEventStoreReadContext(tenantId);
  return { aggregateType, tenantId, eventVersion, context };
}
