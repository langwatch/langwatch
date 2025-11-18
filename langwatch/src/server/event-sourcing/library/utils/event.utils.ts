import { context, trace } from "@opentelemetry/api";
import { EventStream } from "../core/eventStream";
import type {
  Event,
  EventMetadataBase,
  Projection,
  EventOrderingStrategy,
  ProjectionMetadata,
} from "../core/types";
import type { EventType } from "../core/eventType";
import type { TenantId } from "../core/tenantId";

function createEvent<
  AggregateId = string,
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
  TEventType extends EventType = EventType,
>(
  aggregateId: AggregateId,
  tenantId: TenantId,
  type: TEventType,
  data: Payload,
  metadata?: Metadata,
): Event<AggregateId, Payload, Metadata> {
  return {
    aggregateId,
    tenantId,
    timestamp: Date.now(),
    type,
    data,
    ...(metadata !== void 0 && { metadata }),
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
>(metadata?: Metadata): Metadata | undefined {
  if (metadata && typeof metadata.processingTraceparent === "string") {
    return metadata;
  }

  const traceparent = getCurrentTraceparentFromActiveSpan();
  if (!traceparent) {
    return metadata;
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
  TEventType extends EventType = EventType,
>(
  aggregateId: AggregateId,
  tenantId: TenantId,
  type: TEventType,
  data: Payload,
  metadata?: Metadata,
): Event<AggregateId, Payload, Metadata> {
  const enrichedMetadata =
    buildEventMetadataWithCurrentProcessingTraceparent<Metadata>(metadata);

  const hasMetadata =
    enrichedMetadata &&
    Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;

  return createEvent<AggregateId, Payload, Metadata, TEventType>(
    aggregateId,
    tenantId,
    type,
    data,
    hasMetadata ? enrichedMetadata : void 0,
  );
}

function createProjection<AggregateId = string, Data = unknown>(
  id: string,
  aggregateId: AggregateId,
  tenantId: TenantId,
  data: Data,
  version: number = Date.now(),
): Projection<AggregateId, Data> {
  return {
    id,
    aggregateId,
    tenantId,
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

function isValidEvent(event: unknown): event is Event {
  return (
    Boolean(event) &&
    typeof event === "object" &&
    event !== null &&
    typeof (event as Record<string, unknown>).aggregateId !== "undefined" &&
    (event as Record<string, unknown>).aggregateId !== null &&
    typeof (event as Record<string, unknown>).tenantId === "string" &&
    ((event as Record<string, unknown>).tenantId as string).trim() !== "" &&
    typeof (event as Record<string, unknown>).timestamp === "number" &&
    !Number.isNaN((event as Record<string, unknown>).timestamp as number) &&
    typeof (event as Record<string, unknown>).type === "string" &&
    (event as Record<string, unknown>).data !== void 0
  );
}

function isValidProjection(projection: unknown): projection is Projection {
  return (
    Boolean(projection) &&
    typeof projection === "object" &&
    projection !== null &&
    typeof (projection as Record<string, unknown>).id === "string" &&
    typeof (projection as Record<string, unknown>).aggregateId !==
      "undefined" &&
    (projection as Record<string, unknown>).aggregateId !== null &&
    typeof (projection as Record<string, unknown>).tenantId === "string" &&
    ((projection as Record<string, unknown>).tenantId as string).trim() !==
      "" &&
    typeof (projection as Record<string, unknown>).version === "number" &&
    !Number.isNaN((projection as Record<string, unknown>).version as number) &&
    (projection as Record<string, unknown>).data !== void 0
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
 *   // Extract tenantId from first event's root level
 *   const context = { tenantId: events[0].tenantId };
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
