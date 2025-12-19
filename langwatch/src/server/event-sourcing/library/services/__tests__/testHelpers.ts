import type { Logger } from "pino";
import { vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { EventType } from "../../domain/eventType";
import { EVENT_TYPES } from "../../domain/eventType";
import type { EventHandler } from "../../domain/handlers/eventHandler";
import type { ProjectionHandler } from "../../domain/handlers/projectionHandler";
import type { TenantId } from "../../domain/tenantId";
import { createTenantId } from "../../domain/tenantId";
import type { Event, Projection } from "../../domain/types";
import type { EventHandlerDefinition } from "../../eventHandler.types";
import type { ProjectionDefinition, ProjectionOptions } from "../../projection.types";
import type { EventPublisher } from "../../publishing/eventPublisher.types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
} from "../../stores/projectionStore.types";
import type { DistributedLock, LockHandle } from "../../utils/distributedLock";

/**
 * Creates a mock EventStore with default implementations.
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
 * Creates a mock ProjectionStore with default implementations.
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
 * Creates a mock EventPublisher with default implementations.
 */
export function createMockEventPublisher<T extends Event>(): EventPublisher<T> {
  return {
    publish: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock ProjectionHandler (for projections) with default implementations.
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
      version: "2025-12-17",
      data: {},
    } as TProjection),
  };
}

/**
 * Creates a mock EventHandler (for event handlers) with default implementations.
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
 * Creates a mock EventHandlerDefinition.
 */
export function createMockEventHandlerDefinition<T extends Event>(
  name: string,
  handler?: EventHandler<T>,
  options?: Partial<EventHandlerDefinition<T>["options"]>,
): EventHandlerDefinition<T> {
  return {
    name,
    handler: handler ?? createMockEventReactionHandler<T>(),
    options: {
      eventTypes: void 0,
      ...options,
    },
  };
}

/**
 * Creates a mock ProjectionDefinition.
 */
export function createMockProjectionDefinition<
  TEvent extends Event,
  TProjection extends Projection,
>(
  name: string,
  handler?: ProjectionHandler<TEvent, TProjection>,
  options?: ProjectionOptions,
  store?: ProjectionStore<TProjection>,
): ProjectionDefinition<TEvent, TProjection> {
  return {
    name,
    handler: handler ?? createMockEventHandler<TEvent, TProjection>(),
    store: store ?? createMockProjectionStore<TProjection>(),
    options,
  };
}

/**
 * Creates a mock DistributedLock with default implementations.
 */
export function createMockDistributedLock(): DistributedLock {
  return {
    acquire: vi.fn().mockResolvedValue({
      key: "test-key",
      value: "test-value",
    } as LockHandle),
    release: vi.fn().mockResolvedValue(void 0),
  };
}

/**
 * Creates a mock ProcessorCheckpointStore with default implementations.
 */
export function createMockProcessorCheckpointStore(): ProcessorCheckpointStore {
  return {
    saveCheckpoint: vi.fn().mockResolvedValue(void 0),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
    getLastProcessedEvent: vi.fn().mockResolvedValue(null),
    getCheckpointBySequenceNumber: vi.fn().mockResolvedValue(null),
    hasFailedEvents: vi.fn().mockResolvedValue(false),
    getFailedEvents: vi.fn().mockResolvedValue([]),
    clearCheckpoint: vi.fn().mockResolvedValue(void 0),
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
  type: EventType = EVENT_TYPES[0],
  timestamp = 1000000,
  version = "2025-12-17",
  data: unknown = {},
  id?: string,
): Event {
  const uniqueId =
    id ??
    `${timestamp}:${tenantId}:${aggregateId}:${aggregateType}:${testEventIdCounter++}`;
  return {
    id: uniqueId,
    aggregateId,
    aggregateType,
    tenantId,
    timestamp,
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
 * Creates a test ProjectionStoreReadContext.
 */
export function createTestProjectionStoreReadContext(
  tenantId: TenantId,
  metadata?: Record<string, unknown>,
): ProjectionStoreReadContext {
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
  EVENT_TYPE_1: EVENT_TYPES[0],
  EVENT_TYPE_2: EVENT_TYPES[1] ?? EVENT_TYPES[0],
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
