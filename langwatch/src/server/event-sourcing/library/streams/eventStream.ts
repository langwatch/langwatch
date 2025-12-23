import { z } from "zod";
import type { TenantId as ConcreteTenantId } from "../domain/tenantId";
import type { Event, EventOrderingStrategy } from "../domain/types";

/**
 * Zod schema for event stream metadata.
 */
export const EventStreamMetadataSchema = z.object({
  aggregateId: z.string(),
  eventCount: z.number().int().nonnegative(),
  firstEventTimestamp: z.number().int().nonnegative().nullable(),
  lastEventTimestamp: z.number().int().nonnegative().nullable(),
});

/**
 * Metadata about an event stream, including aggregate ID, event count, and timestamp range.
 */
export type EventStreamMetadata = z.infer<typeof EventStreamMetadataSchema>;

/**
 * Options for creating an event stream.
 */
export interface EventStreamOptions<EventType> {
  /**
   * Strategy for ordering events in the stream.
   * Defaults to "timestamp" (chronological order).
   */
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
  TenantId = ConcreteTenantId,
  EventType extends Event = Event,
> {
  private readonly orderedEvents: readonly EventType[];
  private readonly metadata: EventStreamMetadata;

  constructor(
    private readonly aggregateId: string,
    private readonly tenantId: TenantId,
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

  /**
   * Returns the aggregate ID for this event stream.
   *
   * @returns The aggregate ID as a string
   */
  getAggregateId(): string {
    return this.aggregateId;
  }

  /**
   * Returns the ordered events in this stream.
   * Events are ordered according to the strategy specified during construction.
   *
   * @returns Readonly array of events in order
   */
  getEvents(): readonly EventType[] {
    return this.orderedEvents;
  }

  /**
   * Returns metadata about this event stream.
   * Includes aggregate ID, event count, and timestamp range.
   *
   * @returns Event stream metadata
   */
  getMetadata(): EventStreamMetadata {
    return this.metadata;
  }

  /**
   * Returns the tenant ID for this event stream.
   *
   * @returns The tenant ID
   */
  getTenantId(): TenantId {
    return this.tenantId;
  }

  /**
   * Checks if this event stream is empty.
   *
   * @returns True if the stream contains no events, false otherwise
   */
  isEmpty(): boolean {
    return this.metadata.eventCount === 0;
  }
}
