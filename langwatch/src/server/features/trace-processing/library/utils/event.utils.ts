import { context, trace } from "@opentelemetry/api";
import { EventStream } from "../core/eventStream";
import type {
  Event,
  EventMetadataBase,
  Projection,
  EventOrderingStrategy,
  ProjectionMetadata,
} from "../core/types";

function createEvent<
  AggregateId = string,
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
>(
  aggregateId: AggregateId,
  type: string,
  data: Payload,
  metadata?: Metadata,
): Event<AggregateId, Payload, Metadata> {
  return {
    aggregateId,
    timestamp: Date.now(),
    type,
    data,
    metadata,
  };
}

function getCurrentTraceparentFromActiveSpan(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) {
    return void 0;
  }

  const spanContext = span.spanContext();
  if (!spanContext.traceId || !spanContext.spanId) {
    return void 0;
  }

  const flagsHex = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flagsHex}`;
}

function buildEventMetadataWithCurrentProcessingTraceparent<
  Metadata extends EventMetadataBase = EventMetadataBase,
>(metadata?: Metadata): Metadata {
  if (metadata && typeof metadata.processingTraceparent === "string") {
    return metadata;
  }

  const traceparent = getCurrentTraceparentFromActiveSpan();
  if (!traceparent) {
    return (metadata ?? ({} as Metadata));
  }

  return {
    ...(metadata ?? ({} as Metadata)),
    processingTraceparent: traceparent,
  } as Metadata;
}

function createEventWithProcessingTraceContext<
  AggregateId = string,
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
>(
  aggregateId: AggregateId,
  type: string,
  data: Payload,
  metadata?: Metadata,
): Event<AggregateId, Payload, Metadata> {
  const enrichedMetadata =
    buildEventMetadataWithCurrentProcessingTraceparent<Metadata>(metadata);

  const hasMetadata =
    enrichedMetadata &&
    Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;

  return createEvent<AggregateId, Payload, Metadata>(
    aggregateId,
    type,
    data,
    hasMetadata ? enrichedMetadata : void 0,
  );
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
  createEventWithProcessingTraceContext,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
  buildEventMetadataWithCurrentProcessingTraceparent,
};

export const EventUtils = {
  createEvent,
  createEventWithProcessingTraceContext,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
  buildEventMetadataWithCurrentProcessingTraceparent,
} as const;


