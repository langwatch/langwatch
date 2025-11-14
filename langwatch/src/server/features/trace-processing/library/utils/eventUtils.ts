import { EventStream } from "../core/eventStream";
import type { Event, Projection, EventOrderingStrategy, ProjectionMetadata } from "../core/types";

/**
 * Utility function to create a basic event.
 */
export function createEvent<AggregateId = string>(
  aggregateId: AggregateId,
  type: string,
  data: unknown,
  metadata?: Record<string, unknown>
): Event<AggregateId> {
  return {
    aggregateId,
    timestamp: Date.now(),
    type,
    data,
    metadata,
  };
}

/**
 * Utility function to create a basic projection.
 */
export function createProjection<AggregateId = string, Data = unknown>(
  id: string,
  aggregateId: AggregateId,
  data: Data,
  version: number = Date.now()
): Projection<AggregateId, Data> {
  return {
    id,
    aggregateId,
    version,
    data,
  };
}

/**
 * Utility function to check if an event belongs to a specific aggregate.
 */
export function eventBelongsToAggregate<AggregateId>(
  event: Event<AggregateId>,
  aggregateId: AggregateId
): boolean {
  return event.aggregateId === aggregateId;
}

/**
 * Utility function to sort events by timestamp (chronological order).
 */
export function sortEventsByTimestamp<AggregateId, EventType extends Event<AggregateId>>(
  events: readonly EventType[]
): EventType[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Creates a typed, ordered event stream.
 */
export function createEventStream<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>
>(
  aggregateId: AggregateId,
  events: readonly EventType[],
  ordering: EventOrderingStrategy<EventType> = "timestamp"
): EventStream<AggregateId, EventType> {
  return new EventStream(aggregateId, events, { ordering });
}

/**
 * Utility function to filter events by type.
 */
export function filterEventsByType<AggregateId>(
  events: readonly Event<AggregateId>[],
  eventType: string
): Event<AggregateId>[] {
  return events.filter(event => event.type === eventType);
}

/**
 * Utility function to get the latest version from a list of projections.
 */
export function getLatestProjection<AggregateId, ProjectionType extends Projection<AggregateId>>(
  projections: readonly ProjectionType[]
): ProjectionType | null {
  if (projections.length === 0) return null;

  return projections.reduce((latest, current) =>
    current.version > latest.version ? current : latest
  );
}

/**
 * Builds metadata describing a processed event stream.
 */
export function buildProjectionMetadata<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>
>(
  stream: EventStream<AggregateId, EventType>,
  computedAtUnixMs: number = Date.now()
): ProjectionMetadata {
  const metadata = stream.getMetadata();
  return {
    eventCount: metadata.eventCount,
    firstEventTimestamp: metadata.firstEventTimestamp,
    lastEventTimestamp: metadata.lastEventTimestamp,
    computedAtUnixMs,
  };
}

/**
 * Utility function to validate an event structure.
 * 
 * @example
 * ```typescript
 * // Validate events from untrusted sources (e.g., external APIs)
 * const rawEvent = await fetchEventFromAPI();
 * if (isValidEvent(rawEvent)) {
 *   // TypeScript now knows rawEvent is an Event
 *   await eventStore.storeEvents([rawEvent]);
 * } else {
 *   throw new Error("Invalid event structure");
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Filter out invalid events from a batch
 * const events = rawData.filter(isValidEvent);
 * ```
 */
export function isValidEvent(event: any): event is Event {
  return (
    event &&
    typeof event.aggregateId !== 'undefined' &&
    typeof event.timestamp === 'number' &&
    typeof event.type === 'string' &&
    event.data !== undefined
  );
}

/**
 * Utility function to validate a projection structure.
 * 
 * @example
 * ```typescript
 * // Validate projection from cache or external storage
 * const cachedData = await cache.get(projectionId);
 * if (isValidProjection(cachedData)) {
 *   // TypeScript now knows cachedData is a Projection
 *   return cachedData;
 * } else {
 *   // Rebuild projection from events
 *   return await rebuildProjection(aggregateId);
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Validate projections before batch operations
 * const validProjections = projectionsBatch.filter(isValidProjection);
 * await projectionStore.storeBatch(validProjections);
 * ```
 */
export function isValidProjection(projection: any): projection is Projection {
  return (
    projection &&
    typeof projection.id === 'string' &&
    typeof projection.aggregateId !== 'undefined' &&
    typeof projection.version === 'number' &&
    projection.data !== undefined
  );
}
