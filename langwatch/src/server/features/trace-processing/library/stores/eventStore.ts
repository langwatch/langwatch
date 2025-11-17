import type { Event } from "../core/types";

/**
 * Context for reading events from the event store.
 * 
 * **Security Note:** Implementations MUST enforce tenant isolation when tenantId is provided.
 * In multi-tenant systems, tenantId should be treated as required and validated.
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
   * Implementations MUST use this for tenant isolation when provided.
   * Consider making this required in your concrete implementation for security.
   */
  tenantId?: string;
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
   * @param aggregateId - The aggregate to fetch events for
   * @param context - Optional filtering/security context
   * @returns Readonly array of events, typically ordered by timestamp
   */
  getEvents(
    aggregateId: AggregateId,
    context?: EventStoreReadContext<AggregateId, EventType>,
  ): Promise<readonly EventType[]>;

  /**
   * Lists aggregate IDs that have events, optionally filtered by context.
   * Implementations should return stable, deterministic ordering when used with cursors.
   * 
   * **Concurrency Note:** This method may be called by multiple workers.
   * Consider adding distributed locking if rebuilds are parallelized.
   */
  listAggregateIds?(
    context?: EventStoreReadContext<AggregateId, EventType>,
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
   * @throws {Error} If events are malformed or validation fails
   * 
   * **Security:** Implementations MUST extract and enforce tenant boundaries.
   * **Concurrency:** Should be safe for concurrent calls with different aggregateIds.
   */
  storeEvents(events: readonly EventType[]): Promise<void>;
}
