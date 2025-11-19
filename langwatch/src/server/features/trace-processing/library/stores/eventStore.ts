import type { Event } from "../core/types";

/**
 * Context for reading events from the event store.
 *
 * **Security Note:** tenantId is REQUIRED for tenant isolation.
 * All queries MUST filter by tenant to prevent cross-tenant data access.
 *
 * **Concurrency Note:** Implementations should return a consistent snapshot of events
 * for a given aggregateId, even under concurrent writes.
 */
export interface EventStoreReadContext<
  AggregateId = string,

  // we will use this later i think
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all operations must be scoped to a specific tenant for security.
   */
  tenantId: string;
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
 * Cursor type used to resume listing aggregate IDs.
 * Implementations are free to encode any state they need, but in practice this
 * should be a small, serializable token.
 */
export type EventStoreListCursor =
  | string
  | number
  | null
  | Record<string, unknown>;

export interface ListAggregateIdsResult<AggregateId = string> {
  /**
   * Aggregate identifiers that have at least one event matching the provided context.
   */
  aggregateIds: readonly AggregateId[];
  /**
   * Cursor to resume listing from. Omitted when there are no more results.
   */
  nextCursor?: EventStoreListCursor;
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
export interface ReadOnlyEventStore<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  /**
   * Retrieves all events for a given aggregate.
   *
   * @param aggregateId - The aggregate to fetch events for
   * @param context - Security context with required tenantId
   * @returns Readonly array of events, typically ordered by timestamp
   * @throws {Error} If tenantId is missing or invalid
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'getEvents')
   * before executing the query to ensure tenant isolation.
   */
  getEvents(
    aggregateId: AggregateId,
    context: EventStoreReadContext<AggregateId, EventType>,
  ): Promise<readonly EventType[]>;

  /**
   * Lists aggregate IDs that have events, filtered by tenant context.
   * Implementations should return stable, deterministic ordering when used with cursors.
   *
   * @param context - Security context with required tenantId
   * @param cursor - Optional cursor to resume listing from
   * @param limit - Optional limit on number of results to return
   * @returns List of aggregate IDs and optional next cursor
   * @throws {Error} If tenantId is missing or invalid
   *
   * **Security:** Implementations MUST call validateTenantId(context, 'listAggregateIds')
   * before executing the query to ensure tenant isolation.
   *
   * **Concurrency Note:** This method may be called by multiple workers.
   * Consider adding distributed locking if rebuilds are parallelized.
   */
  listAggregateIds?(
    context: EventStoreReadContext<AggregateId, EventType>,
    cursor?: EventStoreListCursor,
    limit?: number,
  ): Promise<ListAggregateIdsResult<AggregateId>>;
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
export interface EventStore<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> extends ReadOnlyEventStore<AggregateId, EventType> {
  /**
   * Stores one or more events atomically.
   *
   * @param events - Events to store. Implementations MUST validate these before storage.
   * @param context - Security context with required tenantId
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
   *   context: EventStoreReadContext
   * ): Promise<void> {
   *   EventUtils.validateTenantId(context, 'EventStore.storeEvents');
   *   // Verify all events belong to context.tenantId
   *   // ... proceed with storage
   * }
   * ```
   */
  storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<AggregateId, EventType>,
  ): Promise<void>;
}
