import type { Event } from "./types";

/**
 * Ordering strategy for events in a stream.
 */
export type EventOrderingStrategy<EventType> =
  | "timestamp"
  | "as-is"
  | ((a: EventType, b: EventType) => number);

/**
 * Options for creating an event stream.
 */
export interface EventStreamOptions<EventType> {
  ordering?: EventOrderingStrategy<EventType>;
}

/**
 * Metadata about an event stream.
 */
export interface EventStreamMetadata {
  aggregateId: string;
  eventCount: number;
  firstEventTimestamp: number | null;
  lastEventTimestamp: number | null;
}

/**
 * Represents a stream of events for a specific aggregate.
 * Events are ordered according to the specified strategy.
 */
export class EventStream<TenantId = string, EventType extends Event = Event> {
  private readonly orderedEvents: readonly EventType[];
  private readonly metadata: EventStreamMetadata;

  constructor(
    private readonly aggregateId: string,
    private readonly tenantId: TenantId,
    events: readonly EventType[],
    { ordering = "timestamp" }: EventStreamOptions<EventType> = {},
  ) {
    let orderedEvents: readonly EventType[];
    if (ordering === "as-is") {
      orderedEvents = events;
    } else {
      const clonedEvents = [...events];
      if (ordering === "timestamp") {
        clonedEvents.sort((a, b) => a.timestamp - b.timestamp);
      } else {
        clonedEvents.sort(ordering);
      }
      orderedEvents = clonedEvents;
    }

    this.orderedEvents = orderedEvents;
    this.metadata = {
      aggregateId:
        typeof aggregateId === "string" ? aggregateId : String(aggregateId),
      eventCount: orderedEvents.length,
      firstEventTimestamp: orderedEvents[0]?.timestamp ?? null,
      lastEventTimestamp: orderedEvents.at(-1)?.timestamp ?? null,
    };
  }

  getAggregateId(): string {
    return this.aggregateId;
  }

  getEvents(): readonly EventType[] {
    return this.orderedEvents;
  }

  getMetadata(): EventStreamMetadata {
    return this.metadata;
  }

  getTenantId(): TenantId {
    return this.tenantId;
  }

  isEmpty(): boolean {
    return this.metadata.eventCount === 0;
  }
}
