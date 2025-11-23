import type {
  EventStore as BaseEventStore,
  EventStoreReadContext,
  Event,
  AggregateType,
} from "../../library";
import { EventUtils, createTenantId } from "../../library";
import type { EventRepository, EventRecord } from "./repositories/eventRepository.types";
import { EventRepositoryMemory } from "./repositories/eventRepositoryMemory";

/**
 * Simple in-memory EventStore used for tests and local development.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access. Multiple operations
 * on the same aggregate from different threads/processes can result in:
 * - Lost updates (last write wins)
 * - Inconsistent state
 * - Race conditions
 *
 * **Use Cases:**
 * - Unit tests
 * - Local development
 * - Single-threaded environments
 *
 * **DO NOT USE in production with multiple workers/processes.**
 * Use `EventStoreClickHouse` or another thread-safe implementation instead.
 */
export class EventStoreMemory<EventType extends Event = Event>
  implements BaseEventStore<EventType>
{
  constructor(private readonly repository: EventRepository = new EventRepositoryMemory()) {
    // Prevent accidental use in production - memory stores are not thread-safe
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "EventStoreMemory is not thread-safe and cannot be used in production. Use EventStoreClickHouse or another thread-safe implementation instead.",
      );
    }
  }

  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.getEvents");

    // Get raw records from repository
    const records = await this.repository.getEventRecords(
      context.tenantId,
      aggregateType,
      aggregateId,
    );

    // Transform records to events
    const events = records.map((record) => this.recordToEvent(record, aggregateId));

    // Sort by timestamp first to ensure consistent ordering
    const sortedEvents = [...events].sort((a, b) => {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      // If timestamps are equal, sort by id for stability
      return a.id.localeCompare(b.id);
    });

    // Deduplicate by Event ID (keep first occurrence when sorted by timestamp)
    const seenEventIds = new Set<string>();
    const deduplicatedEvents = sortedEvents.filter((event) => {
      if (!event.id) {
        // If no Event ID, keep the event (shouldn't happen but handle gracefully)
        return true;
      }
      if (seenEventIds.has(event.id)) {
        return false; // Skip duplicate
      }
      seenEventIds.add(event.id);
      return true;
    });

    // Deep clone to prevent mutation
    return deduplicatedEvents.map((event) => ({
      ...event,
      data: JSON.parse(JSON.stringify(event.data)),
      metadata: { ...event.metadata },
    }));
  }

  async countEventsBefore(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.countEventsBefore");

    // Delegate to repository for counting
    return await this.repository.countEventRecords(
      context.tenantId,
      aggregateType,
      aggregateId,
      beforeTimestamp,
      beforeEventId,
    );
  }

  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.storeEvents");

    if (events.length === 0) {
      return;
    }

    // Validate all events before storage
    this.validateEvents(events, context, aggregateType);

    // Transform events to records
    const records = events.map((event) => this.eventToRecord(event));

    // Delegate to repository
    await this.repository.insertEventRecords(records);
  }

  /**
   * Seeds the event store with events for a given aggregate.
   * Useful in tests.
   *
   * @param _aggregateId - The aggregate ID
   * @param events - Events to seed
   * @param _tenantId - Tenant ID (required for proper partitioning)
   * @param _aggregateType - Aggregate type (required for proper partitioning)
   */
  async seed(
    _aggregateId: string,
    events: EventType[],
    _tenantId: string,
    _aggregateType: AggregateType,
  ): Promise<void> {
    // Transform events to records
    const records = events.map((event) => this.eventToRecord(event));

    // Store via repository
    await this.repository.insertEventRecords(records);
  }

  /**
   * Validates all events before storage.
   */
  private validateEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): void {
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(
          `[VALIDATION] Invalid event at index ${i}: event must have aggregateId, timestamp, type, and data`,
        );
      }

      // Validate that event aggregateType matches context aggregateType
      if (event.aggregateType !== aggregateType) {
        throw new Error(
          `[VALIDATION] Event at index ${i} has aggregate type '${event.aggregateType}' that does not match pipeline aggregate type '${aggregateType}'`,
        );
      }

      // Validate that event tenantId matches context tenantId
      const eventTenantId = event.tenantId;
      if (!eventTenantId) {
        throw new Error(`[SECURITY] Event at index ${i} has no tenantId`);
      }
      if (eventTenantId !== context.tenantId) {
        throw new Error(
          `[SECURITY] Event at index ${i} has tenantId '${eventTenantId}' that does not match context tenantId '${context.tenantId}'`,
        );
      }
    }
  }

  /**
   * Transforms an EventRecord to an Event.
   */
  private recordToEvent(record: EventRecord, aggregateId: string): EventType {
    // Handle invalid timestamps by falling back to current time
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

    const payload = this.parseEventPayload(record.EventPayload);

    const event = {
      id: record.EventId,
      aggregateId: aggregateId,
      aggregateType: record.AggregateType as AggregateType,
      tenantId: createTenantId(record.TenantId),
      timestamp: timestampMs,
      type: record.EventType as EventType["type"],
      data: payload,
      metadata: {
        processingTraceparent: record.ProcessingTraceparent || void 0,
      },
    } satisfies Event;

    return event as EventType;
  }

  /**
   * Transforms an Event to an EventRecord.
   */
  private eventToRecord(event: EventType): EventRecord {
    return {
      TenantId: String(event.tenantId),
      AggregateType: event.aggregateType,
      AggregateId: String(event.aggregateId),
      EventId: event.id,
      EventTimestamp: event.timestamp,
      EventType: event.type,
      EventPayload: event.data ?? {},
      ProcessingTraceparent: event.metadata?.processingTraceparent ?? "",
    };
  }

  /**
   * Parses the EventPayload from storage.
   */
  private parseEventPayload(rawPayload: unknown): unknown {
    if (typeof rawPayload === "string") {
      if (rawPayload.length === 0) {
        return null;
      } else {
        return JSON.parse(rawPayload);
      }
    } else if (typeof rawPayload === "object") {
      return rawPayload;
    } else {
      throw new Error(
        `[CORRUPTED_DATA] EventPayload is not a string or object, it is of type ${typeof rawPayload}`,
      );
    }
  }
}
