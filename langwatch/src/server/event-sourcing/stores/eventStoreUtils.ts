import type { AggregateType, Event, EventStoreReadContext } from "../";
import { createTenantId } from "../";
import {
	ErrorCategory,
	SecurityError,
	StoreError,
	ValidationError,
} from "../services/errorHandling";
import type { EventRecord } from "./repositories/eventRepository.types";

/**
 * Transforms an EventRecord from storage into a domain Event.
 */
export function recordToEvent<EventType extends Event>(
  record: EventRecord,
  aggregateId: string,
): EventType {
  let timestampMs: number;
  if (
    typeof record.EventTimestamp === "number" &&
    !Number.isNaN(record.EventTimestamp)
  ) {
    timestampMs = record.EventTimestamp;
  } else if (typeof record.EventTimestamp === "string") {
    const parsed = Date.parse(record.EventTimestamp);
    timestampMs = Number.isNaN(parsed) ? Date.now() : parsed;
  } else {
    timestampMs = Date.now();
  }

  const payload = parseEventPayload(record.EventPayload);

  const event = {
    id: record.EventId,
    aggregateId: aggregateId,
    aggregateType: record.AggregateType as AggregateType,
    tenantId: createTenantId(record.TenantId),
    timestamp: timestampMs,
    occurredAt:
      record.EventOccurredAt != null && record.EventOccurredAt > 0
        ? record.EventOccurredAt
        : timestampMs,
    type: record.EventType as EventType["type"],
    version: record.EventVersion,
    data: payload,
    ...(record.ProcessingTraceparent && {
      metadata: {
        processingTraceparent: record.ProcessingTraceparent,
      },
    }),
  } satisfies Event;

  return event as EventType;
}

/**
 * Transforms a domain Event into an EventRecord for storage.
 */
export function eventToRecord<EventType extends Event>(
  event: EventType,
): EventRecord {
  return {
    TenantId: String(event.tenantId),
    AggregateType: event.aggregateType,
    AggregateId: String(event.aggregateId),
    EventId: event.id,
    EventTimestamp: event.timestamp,
    EventOccurredAt: event.occurredAt,
    EventType: event.type,
    EventVersion: event.version,
    EventPayload: event.data ?? {},
    ProcessingTraceparent: event.metadata?.processingTraceparent ?? "",
  };
}

/**
 * Parses raw EventPayload from storage into a usable object.
 *
 * Handles: JSON strings, already-parsed objects, empty strings (→ null).
 * Throws StoreError for unexpected types or malformed JSON.
 */
export function parseEventPayload(rawPayload: unknown): unknown {
  if (typeof rawPayload === "string") {
    if (rawPayload.length === 0) {
      return null;
    }
    try {
      return JSON.parse(rawPayload);
    } catch (error) {
      throw new StoreError(
        "parsePayload",
        "EventStore",
        `Failed to parse EventPayload JSON: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.CRITICAL,
        { rawPayloadLength: rawPayload.length },
      );
    }
  } else if (typeof rawPayload === "object") {
    return rawPayload;
  } else {
    throw new StoreError(
      "parsePayload",
      "EventStore",
      `EventPayload is not a string or object, it is of type ${typeof rawPayload}`,
      ErrorCategory.CRITICAL,
      { rawPayloadType: typeof rawPayload },
    );
  }
}

/**
 * Deduplicates events by Event ID, keeping the first occurrence.
 */
export function deduplicateEvents<EventType extends Event>(
  events: EventType[],
): EventType[] {
  const seenEventIds = new Set<string>();
  return events.filter((event) => {
    if (!event.id) return true;
    if (seenEventIds.has(event.id)) return false;
    seenEventIds.add(event.id);
    return true;
  });
}

/**
 * Validates that an event's tenantId matches the context tenantId.
 * Throws SecurityError with generic message (no tenant IDs in error text).
 */
export function validateEventTenant<EventType extends Event>(
  event: EventType,
  context: EventStoreReadContext<EventType>,
  index: number,
): void {
  const eventTenantId = event.tenantId;
  if (!eventTenantId) {
    throw new SecurityError(
      "validateEventTenant",
      `Event at index ${index} has no tenantId`,
      void 0,
      { index },
    );
  }
  if (eventTenantId !== context.tenantId) {
    throw new SecurityError(
      "validateEventTenant",
      `Event at index ${index} has a tenantId that does not match the context`,
      void 0,
      { index },
    );
  }
}

/**
 * Validates that an event's aggregateType matches the expected type.
 */
export function validateEventAggregateType<EventType extends Event>(
  event: EventType,
  aggregateType: AggregateType,
  index: number,
): void {
  if (event.aggregateType !== aggregateType) {
    throw new ValidationError(
      `Event at index ${index} has aggregate type '${event.aggregateType}' that does not match pipeline aggregate type '${aggregateType}'`,
      "aggregateType",
      event.aggregateType,
      { index, expectedAggregateType: aggregateType },
    );
  }
}
