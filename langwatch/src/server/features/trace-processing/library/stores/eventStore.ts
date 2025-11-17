import type { Event } from "../core/types";

export interface EventStoreReadContext<
  AggregateId = string,

  // we will use this later i think
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  tenantId?: string;
  metadata?: Record<string, unknown>;
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
 */
export interface ReadOnlyEventStore<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  getEvents(
    aggregateId: AggregateId,
    context?: EventStoreReadContext<AggregateId, EventType>,
  ): Promise<readonly EventType[]>;

  /**
   * Lists aggregate IDs that have events, optionally filtered by context.
   * Implementations should return stable, deterministic ordering when used with cursors.
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
 */
export interface EventStore<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> extends ReadOnlyEventStore<AggregateId, EventType> {
  storeEvents(events: readonly EventType[]): Promise<void>;
}
