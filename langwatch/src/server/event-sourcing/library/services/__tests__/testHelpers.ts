import { vi } from "vitest";
import type { Event, Projection } from "../../domain/types";
import type { TenantId } from "../../domain/tenantId";
import type { EventType } from "../../domain/eventType";
import type { AggregateType } from "../../domain/aggregateType";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";
import type {
  ProjectionStore,
  ProjectionStoreReadContext,
} from "../../stores/projectionStore.types";
import type { EventPublisher } from "../../publishing/eventPublisher.types";
import type { EventHandler } from "../../domain/handlers/eventHandler";
import type { EventReactionHandler } from "../../domain/handlers/eventReactionHandler";
import type { EventHandlerDefinition } from "../../eventHandler.types";
import type { ProjectionDefinition } from "../../projection.types";
import type { DistributedLock, LockHandle } from "../../utils/distributedLock";
import type { EventHandlerCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type { Logger } from "pino";
import { createTenantId } from "../../domain/tenantId";
import { EVENT_TYPES } from "../../domain/eventType";

/**
 * Creates a mock EventStore with default implementations.
 */
export function createMockEventStore<T extends Event>(): EventStore<T> {
  return {
    storeEvents: vi.fn().mockResolvedValue(void 0),
    getEvents: vi.fn().mockResolvedValue([]),
  };
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
 * Creates a mock EventHandler (for projections) with default implementations.
 */
export function createMockEventHandler<
  TEvent extends Event,
  TProjection extends Projection,
>(): EventHandler<TEvent, TProjection> {
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
 * Creates a mock EventReactionHandler (for event handlers) with default implementations.
 */
export function createMockEventReactionHandler<
  T extends Event,
>(): EventReactionHandler<T> {
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
  handler?: EventReactionHandler<T>,
  options?: Partial<EventHandlerDefinition<T>["options"]>,
): EventHandlerDefinition<T> {
  return {
    name,
    handler: handler ?? createMockEventReactionHandler<T>(),
    options: {
      eventTypes: void 0,
      dependsOn: void 0,
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
  handler?: EventHandler<TEvent, TProjection>,
  store?: ProjectionStore<TProjection>,
): ProjectionDefinition<TEvent, TProjection> {
  return {
    name,
    handler: handler ?? createMockEventHandler<TEvent, TProjection>(),
    store: store ?? createMockProjectionStore<TProjection>(),
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
 * Creates a mock EventHandlerCheckpointStore with default implementations.
 */
export function createMockEventHandlerCheckpointStore(): EventHandlerCheckpointStore {
  return {
    saveCheckpoint: vi.fn().mockResolvedValue(void 0),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
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

/**
 * Creates a test event with predictable values.
 */
export function createTestEvent(
  aggregateId: string,
  aggregateType: AggregateType,
  tenantId: TenantId,
  type: EventType = EVENT_TYPES[0],
  timestamp = 1000000,
  data: unknown = {},
  id?: string,
): Event {
  return {
    id: id ?? `${timestamp}:${tenantId}:${aggregateId}:${aggregateType}`,
    aggregateId,
    aggregateType,
    tenantId,
    timestamp,
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
  version = 1000000,
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
  return "span_ingestion";
}

/**
 * Common test constants.
 */
export const TEST_CONSTANTS = {
  BASE_TIMESTAMP: 1000000,
  AGGREGATE_ID: "test-aggregate-123",
  TENANT_ID_VALUE: "test-tenant",
  PROJECTION_NAME: "test-projection",
  HANDLER_NAME: "test-handler",
  AGGREGATE_TYPE: "span_ingestion" as const satisfies AggregateType,
  EVENT_TYPE_1: EVENT_TYPES[0],
  EVENT_TYPE_2: EVENT_TYPES[1] ?? EVENT_TYPES[0],
} as const;
