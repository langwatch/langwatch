import { z } from "zod";
import type { AggregateType } from "../domain/aggregateType";
import { type TenantId, TenantIdSchema } from "../domain/tenantId";
import type { Event } from "../domain/types";

/**
 * Zod schema for event store read context.
 * Context for reading events from the event store.
 *
 * **Security Note:** tenantId is REQUIRED for tenant isolation.
 * All queries MUST filter by tenant to prevent cross-tenant data access.
 *
 * **Concurrency Note:** Implementations should return a consistent snapshot of events
 * for a given aggregateId, even under concurrent writes.
 */
export const EventStoreReadContextSchema = z.object({
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantIdSchema,
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata: z.record(z.unknown()).optional(),
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw: z.record(z.unknown()).optional(),
});

export interface EventStoreReadContext<_EventType extends Event = Event> {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: TenantId;
  /**
   * Additional metadata for the read operation.
   * Should not be used to bypass security checks.
   */
  metadata?: Record<string, unknown>;
  /**
   * Raw/implementation-specific context.
   * Use with caution - should not bypass security or validation.
   */
  raw?: Record<string, unknown>;
}

/**
 * Read-only event store for querying events.
 * Use this interface when you only need to read events without storing new ones.
 *
 * **Implementation Requirements:**
 * - MUST enforce tenant isolation when context.tenantId is provided
 * - MUST validate tenantId using validateTenantId() before queries
 * - SHOULD validate aggregateId format before querying
 * - SHOULD return events in a consistent order (typically by timestamp)
 * - MUST return readonly array to prevent caller mutations
 */
export interface ReadOnlyEventStore<EventType extends Event = Event> {
  /**
   * Retrieves all events for a given aggregate.
   *
   * @param aggregateId - The aggregate to fetch events for
   * @param context - Security context with required tenantId
   * @param aggregateType - The type of aggregate root (e.g., "trace", "user")
   * @returns Readonly array of events, typically ordered by timestamp
   * @throws {Error} If tenantId is missing or invalid
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'getEvents')
   * before executing the query to ensure tenant isolation.
   */
  getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]>;

  /**
   * Retrieves events for a given aggregate up to and including a specific event.
   * Returns all events that come before or equal to the specified event in chronological order.
   *
   * @param aggregateId - The aggregate to fetch events for
   * @param context - Security context with required tenantId
   * @param aggregateType - The type of aggregate root (e.g., "trace", "user")
   * @param upToEvent - The event to fetch up to (inclusive)
   * @returns Readonly array of events up to and including the specified event, typically ordered by timestamp
   * @throws {Error} If tenantId is missing or invalid, or if the specified event is not found
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'getEventsUpTo')
   * before executing the query to ensure tenant isolation.
   */
  getEventsUpTo(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    upToEvent: EventType,
  ): Promise<readonly EventType[]>;

  /**
   * Counts events that come before a given event in chronological order.
   * Used to compute sequence numbers for event ordering.
   *
   * Counts events where:
   * - `timestamp < beforeTimestamp`, OR
   * - `timestamp === beforeTimestamp AND id < beforeEventId`
   *
   * **Performance:** Implementations SHOULD use efficient COUNT queries rather than
   * fetching all events. For example, ClickHouse implementations should use COUNT(*)
   * with WHERE clause filtering, leveraging indexes.
   *
   * @param aggregateId - The aggregate to count events for
   * @param context - Security context with required tenantId
   * @param aggregateType - The type of aggregate root (e.g., "trace", "user")
   * @param beforeTimestamp - The timestamp to compare against
   * @param beforeEventId - The event ID to compare against (for tie-breaking when timestamps are equal)
   * @returns The count of events that come before the specified event
   * @throws {Error} If tenantId is missing or invalid
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'countEventsBefore')
   * before executing the query to ensure tenant isolation.
   */
  countEventsBefore(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number>;
}

/**
 * Full event store with read and write capabilities.
 * Extends ReadOnlyEventStore with the ability to store events.
 *
 * **Implementation Requirements:**
 * - MUST validate events using isValidEvent before storage
 * - MUST enforce tenant isolation (events should only be queryable by same tenant)
 * - MUST validate tenantId using validateTenantId() before any operations
 * - SHOULD be idempotent (storing the same event twice should not fail)
 * - SHOULD support concurrent writes safely
 */
export interface EventStore<EventType extends Event = Event>
  extends ReadOnlyEventStore<EventType> {
  /**
   * Stores one or more events atomically.
   *
   * @param events - Events to store. Implementations MUST validate these before storage.
   * @param context - Security context with required tenantId
   * @param aggregateType - The type of aggregate root (e.g., "trace", "user")
   * @throws {Error} If events are malformed, tenantId is missing, or validation fails
   *
   * **Security:** Implementations MUST:
   * 1. Call validateTenantId(context, 'storeEvents') to ensure tenantId is present
   * 2. Verify all events belong to the same tenant as context
   * 3. Enforce that all events in the batch belong to the same tenant
   * 4. Filter queries by tenantId to prevent cross-tenant access
   *
   * **Concurrency:** Should be safe for concurrent calls with different aggregateIds.
   *
   * @example
   * ```typescript
   * async storeEvents(
   *   events: readonly Event[],
   *   context: EventStoreReadContext,
   *   aggregateType: AggregateType
   * ): Promise<void> {
   *   EventUtils.validateTenantId(context, 'EventStore.storeEvents');
   *   // Verify all events belong to context.tenantId
   *   // ... proceed with storage
   * }
   * ```
   */
  storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void>;
}
