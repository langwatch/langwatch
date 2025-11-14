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
