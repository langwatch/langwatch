import { EventStream } from "../core/eventStream";
import type {
  Event,
  Projection,
  EventOrderingStrategy,
  ProjectionMetadata,
} from "../core/types";

function createEvent<AggregateId = string>(
  aggregateId: AggregateId,
  type: string,
  data: unknown,
  metadata?: Record<string, unknown>,
): Event<AggregateId> {
  return {
    aggregateId,
    timestamp: Date.now(),
    type,
    data,
    metadata,
  };
}

function createProjection<AggregateId = string, Data = unknown>(
  id: string,
  aggregateId: AggregateId,
  data: Data,
  version: number = Date.now(),
): Projection<AggregateId, Data> {
  return {
    id,
    aggregateId,
    version,
    data,
  };
}

function eventBelongsToAggregate<AggregateId>(
  event: Event<AggregateId>,
  aggregateId: AggregateId,
): boolean {
  return event.aggregateId === aggregateId;
}

function sortEventsByTimestamp<
  AggregateId,
  EventType extends Event<AggregateId>,
>(events: readonly EventType[]): EventType[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

function createEventStream<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
>(
  aggregateId: AggregateId,
  events: readonly EventType[],
  ordering: EventOrderingStrategy<EventType> = "timestamp",
): EventStream<AggregateId, EventType> {
  return new EventStream(aggregateId, events, { ordering });
}

function filterEventsByType<AggregateId>(
  events: readonly Event<AggregateId>[],
  eventType: string,
): Event<AggregateId>[] {
  return events.filter((event) => event.type === eventType);
}

function getLatestProjection<
  AggregateId,
  ProjectionType extends Projection<AggregateId>,
>(projections: readonly ProjectionType[]): ProjectionType | null {
  if (projections.length === 0) return null;

  return projections.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
}

function buildProjectionMetadata<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
>(
  stream: EventStream<AggregateId, EventType>,
  computedAtUnixMs: number = Date.now(),
): ProjectionMetadata {
  const metadata = stream.getMetadata();
  return {
    eventCount: metadata.eventCount,
    firstEventTimestamp: metadata.firstEventTimestamp,
    lastEventTimestamp: metadata.lastEventTimestamp,
    computedAtUnixMs,
  };
}

function isValidEvent(event: any): event is Event {
  return (
    event &&
    typeof event.aggregateId !== "undefined" &&
    typeof event.timestamp === "number" &&
    typeof event.type === "string" &&
    event.data !== void 0
  );
}

function isValidProjection(projection: any): projection is Projection {
  return (
    Boolean(projection) &&
    typeof projection.id === "string" &&
    typeof projection.aggregateId !== "undefined" &&
    typeof projection.version === "number" &&
    projection.data !== void 0
  );
}

export {
  createEvent,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
};

export const EventUtils = {
  createEvent,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
} as const;


