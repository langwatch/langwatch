import type {
  EventStore as BaseEventStore,
  EventStoreReadContext,
  Event,
  AggregateType,
} from "../../library";
import { EventUtils } from "../../library";

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
  // Partition by tenant + aggregateType + aggregateId
  private readonly eventsByKey = new Map<string, EventType[]>();
  // Track tenant + aggregateType -> aggregateIds mapping for listAggregateIds
  private readonly aggregatesByTenantAndType = new Map<string, Set<string>>();

  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.getEvents");

    const key = `${context.tenantId}:${aggregateType}:${String(aggregateId)}`;
    const events = this.eventsByKey.get(key) ?? [];

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

    // Get all events for the aggregate
    const events = await this.getEvents(aggregateId, context, aggregateType);

    // Count events that come before the specified event
    // Events where: (timestamp < beforeTimestamp) OR (timestamp === beforeTimestamp AND id < beforeEventId)
    const count = events.filter((event) => {
      if (event.timestamp < beforeTimestamp) {
        return true;
      }
      if (event.timestamp === beforeTimestamp && event.id < beforeEventId) {
        return true;
      }
      return false;
    }).length;

    return count;
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
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(
          `[VALIDATION] Invalid event at index ${i}: event must have aggregateId, timestamp, type, and data`,
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

    // Store all events - deduplication happens in getEvents() after sorting by timestamp
    // This matches the behavior of EventStoreClickHouse which inserts all events
    // and deduplicates during retrieval.
    for (const event of events) {
      const key = `${context.tenantId}:${event.aggregateType}:${String(event.aggregateId)}`;
      const aggregateEvents = this.eventsByKey.get(key) ?? [];

      // Deep clone to prevent mutation
      aggregateEvents.push({
        ...event,
        data: JSON.parse(JSON.stringify(event.data)),
        metadata: { ...event.metadata },
      });
      this.eventsByKey.set(key, aggregateEvents);

      // Track tenant + aggregateType -> aggregateId mapping
      const tenantTypeKey = `${context.tenantId}:${event.aggregateType}`;
      const aggregates =
        this.aggregatesByTenantAndType.get(tenantTypeKey) ?? new Set();
      aggregates.add(String(event.aggregateId));
      this.aggregatesByTenantAndType.set(tenantTypeKey, aggregates);
    }
  }

  /**
   * Seeds the event store with events for a given aggregate.
   * Useful in tests.
   *
   * @param aggregateId - The aggregate ID
   * @param events - Events to seed
   * @param tenantId - Tenant ID (required for proper partitioning)
   * @param aggregateType - Aggregate type (required for proper partitioning)
   */
  seed(
    aggregateId: string,
    events: EventType[],
    tenantId: string,
    aggregateType: AggregateType,
  ): void {
    const key = `${tenantId}:${aggregateType}:${String(aggregateId)}`;
    this.eventsByKey.set(key, [...events]);

    // Update tenant + aggregateType tracking
    const tenantTypeKey = `${tenantId}:${aggregateType}`;
    const aggregates =
      this.aggregatesByTenantAndType.get(tenantTypeKey) ?? new Set();
    aggregates.add(String(aggregateId));
    this.aggregatesByTenantAndType.set(tenantTypeKey, aggregates);
  }
}
