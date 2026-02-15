import { generate } from "@langwatch/ksuid";
import { context, trace } from "@opentelemetry/api";
import type { AggregateType } from "../domain/aggregateType";
import type { EventType } from "../domain/eventType";
import type { TenantId } from "../domain/tenantId";
import { TenantIdSchema } from "../domain/tenantId";
import type {
  Event,
  EventMetadataBase,
  EventOrderingStrategy,
  Projection,
  ProjectionMetadata,
} from "../domain/types";
import {
  EventMetadataBaseSchema,
  EventSchema,
  ProjectionSchema,
} from "../domain/types";
import { SecurityError } from "../services/errorHandling";
import { EventStream } from "../streams/eventStream";

/**
 * Generates a unique event ID with entropy to prevent predictability and replay attacks.
 * Format: {timestamp}:{tenantId}:{aggregateId}:{aggregateType}:{ksuid}
 * The KSUID component ensures uniqueness even when timestamps collide and prevents.
 *
 * @param timestamp - Event timestamp in milliseconds
 * @param tenantId - The tenant ID
 * @param aggregateId - The aggregate ID
 * @param aggregateType - The aggregate type
 * @returns Event ID in format {timestamp}:{tenantId}:{aggregateId}:{aggregateType}:{ksuid}
 */
function generateEventId(
  timestamp: number,
  tenantId: string,
  aggregateId: string,
  aggregateType: string,
): string {
  return `${timestamp}:${tenantId}:${aggregateId}:${aggregateType}:${generate(
    "event",
  ).toString()}`;
}

/**
 * Parameters for creating an event.
 */
export interface CreateEventParams<
  TData = unknown,
  TMetadata extends EventMetadataBase = EventMetadataBase,
  TType extends EventType = EventType,
> {
  /** The aggregate type (used for event ID generation) */
  aggregateType: AggregateType;
  /** The aggregate this event belongs to */
  aggregateId: string;
  /** Tenant identifier for multi-tenant isolation */
  tenantId: TenantId;
  /** Event type identifier */
  type: TType;
  /** Event version */
  version: string;
  /** Event-specific payload data */
  data: TData;
  /** Optional metadata (e.g., trace context) */
  metadata?: TMetadata;
  /** Optional timestamp in ms (defaults to current time) */
  timestamp?: number;
  /** Whether to automatically enrich metadata with current OpenTelemetry trace context */
  includeTraceContext?: boolean;
  /**
   * When the business action was initiated (Unix ms).
   * Captures the moment the user/system triggered the action, before any queue delay.
   * Defaults to the event timestamp when not provided.
   */
  occurredAt?: number;
}

/**
 * Creates an event with the given parameters.
 *
 * @param params - Named parameters for event creation
 * @returns A new event with timestamp set to current time (or provided timestamp)
 */
// Overload for full Event type
function createEvent<TEvent extends Event>(
  params: CreateEventParams<TEvent["data"], NonNullable<TEvent["metadata"]>, TEvent["type"]>,
): TEvent;

// Implementation
function createEvent<
  Payload = unknown,
  Metadata extends EventMetadataBase = EventMetadataBase,
  TEventType extends EventType = EventType,
>(
  params: CreateEventParams<Payload, Metadata, TEventType>,
): Event<Payload, Metadata> {
  const {
    aggregateType,
    aggregateId,
    tenantId,
    type,
    version,
    data,
    metadata,
    timestamp,
    includeTraceContext,
    occurredAt,
  } = params;

  const eventTimestamp = timestamp ?? Date.now();

  let finalMetadata = metadata;
  if (includeTraceContext === true) {
    finalMetadata =
      buildEventMetadataWithCurrentProcessingTraceparent<Metadata>(metadata);
  }

  const hasMetadata =
    finalMetadata &&
    Object.keys(finalMetadata as Record<string, unknown>).length > 0;

  return {
    id: generateEventId(
      eventTimestamp,
      String(tenantId),
      aggregateId,
      aggregateType,
    ),
    version,
    aggregateId,
    aggregateType,
    tenantId,
    timestamp: eventTimestamp,
    occurredAt: occurredAt ?? eventTimestamp,
    type,
    data,
    ...(hasMetadata && { metadata: finalMetadata }),
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
  version: string,
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
 * Uses TenantIdSchema for consistent validation across the codebase.
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
    throw new SecurityError(
      operation,
      `${operation} requires a context with tenantId for tenant isolation`,
    );
  }

  if (!context.tenantId) {
    throw new SecurityError(
      operation,
      `${operation} requires a tenantId for tenant isolation`,
    );
  }

  // Use TenantIdSchema for consistent validation (handles empty strings, whitespace, etc.)
  const result = TenantIdSchema.safeParse(context.tenantId);
  if (!result.success) {
    const errorMessage =
      result.error.issues[0]?.message ??
      "TenantId must be a non-empty string for tenant isolation";
    throw new SecurityError(operation, errorMessage);
  }
}

export const EventUtils = {
  generateEventId,
  createEvent,
  createEventStream,
  createProjection,
  sortEventsByTimestamp,
  isValidEvent,
  isValidProjection,
  validateTenantId,
  buildProjectionMetadata,
  buildEventMetadataWithCurrentProcessingTraceparent,
} as const;
