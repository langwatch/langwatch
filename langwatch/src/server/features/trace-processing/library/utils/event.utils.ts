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
    Boolean(event) &&
    typeof event.aggregateId !== "undefined" &&
    event.aggregateId !== null &&
    typeof event.timestamp === "number" &&
    !Number.isNaN(event.timestamp) &&
    typeof event.type === "string" &&
    event.data !== void 0
  );
}

function isValidProjection(projection: any): projection is Projection {
  return (
    Boolean(projection) &&
    typeof projection.id === "string" &&
    typeof projection.aggregateId !== "undefined" &&
    projection.aggregateId !== null &&
    typeof projection.version === "number" &&
    !Number.isNaN(projection.version) &&
    projection.data !== void 0
  );
}

/**
 * Validates that a context has a valid tenantId.
 * Throws an error if tenantId is missing or invalid.
 * 
 * **Security:** This is a critical security check to prevent cross-tenant data leakage.
 * Store implementations MUST call this before any read or write operations.
 * 
 * @param context - The context to validate
 * @param operation - Description of the operation (for error messages)
 * @throws {Error} If tenantId is missing, empty, or invalid
 * 
 * @example
 * ```typescript
 * async storeEvents(events: Event[]): Promise<void> {
 *   // Extract tenantId from first event's metadata or from a context parameter
 *   const context = { tenantId: events[0].metadata?.tenantId };
 *   EventUtils.validateTenantId(context, 'storeEvents');
 *   // ... proceed with storage
 * }
 * ```
 */
function validateTenantId(
  context: { tenantId?: string } | undefined,
  operation: string,
): void {
  if (!context) {
    throw new Error(
      `[SECURITY] ${operation} requires a context with tenantId for tenant isolation`,
    );
  }

  if (!context.tenantId || context.tenantId.trim() === "") {
    throw new Error(
      `[SECURITY] ${operation} requires a non-empty tenantId for tenant isolation`,
    );
  }
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
  validateTenantId,
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
  validateTenantId,
  buildProjectionMetadata,
  buildEventMetadataWithCurrentProcessingTraceparent,
} as const;


