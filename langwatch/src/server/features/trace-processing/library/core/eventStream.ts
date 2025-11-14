import type { Event, EventOrderingStrategy } from "./types";

export interface EventStreamMetadata {
  readonly aggregateId: string | number;
  readonly eventCount: number;
  readonly firstEventTimestamp: number | null;
  readonly lastEventTimestamp: number | null;
}

export interface EventStreamOptions<EventType> {
  ordering?: EventOrderingStrategy<EventType>;
}

/**
 * Represents a stream of events for a specific aggregate.
 * Events are ordered according to the specified strategy.
 *
 * Note: AggregateId values are converted to strings for metadata storage.
 * String and numeric IDs work well, but complex objects will be converted using String(),
 * be careful as this MIGHT NOT create meaningful results
 * (e.g., objects become the JS meme result of "[object Object]").
 * For complex aggregate IDs, make sure that they have a not-shit toString() impl.
 */
export class EventStream<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> {
  private readonly orderedEvents: readonly EventType[];
  private readonly metadata: EventStreamMetadata;

  constructor(
    private readonly aggregateId: AggregateId,
    events: readonly EventType[],
    { ordering = "timestamp" }: EventStreamOptions<EventType> = {},
  ) {
    // Only clone and sort if ordering is needed!
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

  getAggregateId(): AggregateId {
    return this.aggregateId;
  }

  getEvents(): readonly EventType[] {
    return this.orderedEvents;
  }

  getMetadata(): EventStreamMetadata {
    return this.metadata;
  }

  isEmpty(): boolean {
    return this.metadata.eventCount === 0;
  }
}
