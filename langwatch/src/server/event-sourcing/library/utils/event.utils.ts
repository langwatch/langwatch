import { context, trace } from "@opentelemetry/api";
import { EventStream } from "../streams/eventStream";
import {
  EventSchema,
  ProjectionSchema,
  EventMetadataBaseSchema,
} from "../domain/types";
import type {
  Event,
  EventMetadataBase,
  Projection,
  EventOrderingStrategy,
  ProjectionMetadata,
} from "../domain/types";
import type { TenantId } from "../domain/tenantId";
import type { EventType } from "../domain/eventType";
import type { AggregateType } from "../domain/aggregateType";

/**
 * Generates a unique event ID.
 * Format: {timestamp}:{tenantId}:{aggregateId}:{aggregateType}
 * Timestamps within the same aggregate are guaranteed unique, ensuring Event ID uniqueness.
 *
 * @param timestamp - Event timestamp in milliseconds
 * @param tenantId - The tenant ID
 * @param aggregateId - The aggregate ID
 * @param aggregateType - The aggregate type
 * @returns Event ID in format {timestamp}:{tenantId}:{aggregateId}:{aggregateType}
 */
function generateEventId(
  timestamp: number,
  tenantId: string,
  aggregateId: string,
  aggregateType: string,
): string {
  return `${timestamp}:${tenantId}:${aggregateId}:${aggregateType}`;
}

/**
 * Creates an event with the given payload and metadata.
 *
 * @param aggregateId - The aggregate this event belongs to
 * @param tenantId - Tenant identifier for multi-tenant isolation
 * @param type - Event type identifier
 * @param data - Event-specific payload data
 * @param aggregateType - The aggregate type (used for event ID generation)
 * @param metadata - Optional metadata (e.g., trace context)
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns A new event with timestamp set to current time (or provided timestamp)
 */
function createEvent<
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
  TEventType extends EventType = EventType,
>(
  aggregateId: string,
  tenantId: TenantId,
  type: TEventType,
  data: Payload,
  aggregateType: AggregateType,
  metadata?: Metadata,
  timestamp?: number,
): Event<Payload, Metadata> {
  const eventTimestamp = timestamp ?? Date.now();
  return {
    id: generateEventId(eventTimestamp, String(tenantId), aggregateId, aggregateType),
    aggregateId,
    aggregateType,
    tenantId,
    timestamp: eventTimestamp,
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

/**
 * Enriches event metadata with the current OpenTelemetry traceparent if not already present.
 * Used to track which processing pipeline (ingestion, reprocessing, etc.) created the event.
 *
 * @param metadata - Existing metadata to enrich
 * @returns Enriched metadata with processingTraceparent, or original metadata if no active span
 */
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

  const result = EventMetadataBaseSchema.safeParse({
    ...(metadata ?? {}),
    processingTraceparent: traceparent,
  });

  if (!result.success) {
    return metadata;
  }

  // result.data is EventMetadataBase, and Metadata extends EventMetadataBase,
  // so this is safe. The passthrough() in EventMetadataBaseSchema preserves
  // any additional properties from the original metadata.
  return result.data as Metadata;
}

/**
 * Creates an event and automatically enriches metadata with current OpenTelemetry trace context.
 * Convenience wrapper around createEvent that adds processingTraceparent for observability.
 *
 * @param aggregateId - The aggregate this event belongs to
 * @param tenantId - Tenant identifier for multi-tenant isolation
 * @param type - Event type identifier
 * @param data - Event-specific payload data
 * @param aggregateType - The aggregate type (used for event ID generation)
 * @param metadata - Optional metadata (will be enriched with trace context)
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns A new event with trace context in metadata
 */
function createEventWithProcessingTraceContext<
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
  TEventType extends EventType = EventType,
>(
  aggregateId: string,
  tenantId: TenantId,
  type: TEventType,
  data: Payload,
  aggregateType: AggregateType,
  metadata?: Metadata,
  timestamp?: number,
): Event<Payload, Metadata> {
  const enrichedMetadata =
    buildEventMetadataWithCurrentProcessingTraceparent<Metadata>(metadata);

  const hasMetadata =
    enrichedMetadata &&
    Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;

  return createEvent<Payload, Metadata, TEventType>(
    aggregateId,
    tenantId,
    type,
    data,
    aggregateType,
    hasMetadata ? enrichedMetadata : void 0,
    timestamp,
  );
}

/**
 * Creates a projection representing the current state of an aggregate.
 *
 * @param id - Unique identifier for this projection
 * @param aggregateId - The aggregate this projection represents
 * @param tenantId - Tenant identifier for multi-tenant isolation
 * @param data - Projection-specific data
 * @param version - Version/timestamp (defaults to current time)
 * @returns A new projection object
 */
function createProjection<Data = unknown>(
  id: string,
  aggregateId: string,
  tenantId: TenantId,
  data: Data,
  version: number = Date.now(),
): Projection<Data> {
  return {
    id,
    aggregateId,
    tenantId,
    version,
    data,
  };
}

/**
 * Checks if an event belongs to a specific aggregate.
 *
 * @param event - The event to check
 * @param aggregateId - The aggregate ID to check against
 * @returns True if the event belongs to the aggregate, false otherwise
 */
function eventBelongsToAggregate(event: Event, aggregateId: string): boolean {
  return event.aggregateId === aggregateId;
}

/**
 * Sorts events chronologically by timestamp (earliest first).
 * Returns a new array without mutating the input.
 *
 * @param events - Events to sort
 * @returns New array of events sorted by timestamp
 */
function sortEventsByTimestamp<EventType extends Event>(
  events: readonly EventType[],
): EventType[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Creates an event stream for an aggregate with the specified ordering strategy.
 *
 * @param aggregateId - The aggregate ID
 * @param tenantId - Tenant identifier
 * @param events - Events to include in the stream
 * @param ordering - Ordering strategy: "as-is", "timestamp", or custom comparator
 * @returns A new EventStream instance
 */
function createEventStream<
  TTenantId = TenantId,
  EventType extends Event = Event,
>(
  aggregateId: string,
  tenantId: TTenantId,
  events: readonly EventType[],
  ordering: EventOrderingStrategy<EventType> = "timestamp",
): EventStream<TTenantId, EventType> {
  return new EventStream(aggregateId, tenantId, events, { ordering });
}

/**
 * Filters events to only include those matching the specified event type.
 *
 * @param events - Events to filter
 * @param eventType - Event type to match
 * @returns New array containing only matching events
 */
function filterEventsByType(
  events: readonly Event[],
  eventType: string,
): Event[] {
  return events.filter((event) => event.type === eventType);
}

/**
 * Returns the projection with the highest version number from an array.
 *
 * @param projections - Array of projections to search
 * @returns The latest projection, or null if the array is empty
 */
function getLatestProjection<ProjectionType extends Projection>(
  projections: readonly ProjectionType[],
): ProjectionType | null {
  if (projections.length === 0) return null;

  return projections.reduce((latest, current) =>
    current.version > latest.version ? current : latest,
  );
}

/**
 * Builds projection metadata from an event stream.
 * Extracts event count, timestamps, and computation time.
 *
 * @param stream - The event stream to extract metadata from
 * @param computedAtUnixMs - When the projection was computed (defaults to now)
 * @returns Projection metadata object
 */
function buildProjectionMetadata<EventType extends Event = Event>(
  stream: EventStream<EventType["tenantId"], EventType>,
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

/**
 * Type guard that checks if a value is a valid Event.
 * Validates against the EventSchema and ensures data is not undefined.
 *
 * @param event - Value to validate
 * @returns True if the value is a valid Event, false otherwise
 */
function isValidEvent(event: unknown): event is Event {
  if (typeof event !== "object" || event === null) return false;
  const result = EventSchema.safeParse(event);
  if (!result.success) return false;
  // Explicitly check that data is not undefined
  return "data" in event && (event as any).data !== undefined;
}

/**
 * Type guard that checks if a value is a valid Projection.
 * Validates against the ProjectionSchema and ensures data is not undefined.
 *
 * @param projection - Value to validate
 * @returns True if the value is a valid Projection, false otherwise
 */
function isValidProjection(projection: unknown): projection is Projection {
  if (typeof projection !== "object" || projection === null) return false;
  const result = ProjectionSchema.safeParse(projection);
  if (!result.success) return false;
  // Explicitly check that data is not undefined
  return "data" in projection && (projection as any).data !== undefined;
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
  generateEventId,
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
  generateEventId,
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
