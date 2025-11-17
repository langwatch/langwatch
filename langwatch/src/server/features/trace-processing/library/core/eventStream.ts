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
 * **Aggregate ID Handling:**
 * AggregateId values are converted to strings for metadata storage using String().
 * - String and numeric IDs work well
 * - Complex objects will be converted using String(), which typically produces "[object Object]"
 *
 * **SECURITY WARNING:** Using complex objects as aggregate IDs without a proper toString()
 * implementation can cause ID collisions (multiple different objects map to "[object Object]").
 * This could allow cross-aggregate data leakage.
 *
 * **Best Practice:** Use string or number aggregate IDs. If you must use objects,
 * ensure they implement toString() to return a unique, stable identifier.
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
      // Use "as-is" when upstream (e.g. ClickHouse) has already provided a correctly
      // ordered stream so we can avoid an extra copy + sort.
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
