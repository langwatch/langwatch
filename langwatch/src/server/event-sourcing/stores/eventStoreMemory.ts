import type {
  EventStore as BaseEventStore,
  EventStoreReadContext,
  EventStoreListCursor,
  ListAggregateIdsResult,
  Event,
  AggregateType,
} from "../library";
import { EventUtils } from "../library";

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
export class EventStoreMemory<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
> implements BaseEventStore<AggregateId, EventType>
{
  // Partition by tenant + aggregateType + aggregateId
  private readonly eventsByKey = new Map<string, EventType[]>();
  // Track tenant + aggregateType -> aggregateIds mapping for listAggregateIds
  private readonly aggregatesByTenantAndType = new Map<string, Set<string>>();

  async getEvents(
    aggregateId: AggregateId,
    context: EventStoreReadContext<AggregateId, EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.getEvents");

    const key = `${context.tenantId}:${aggregateType}:${String(aggregateId)}`;
    const events = this.eventsByKey.get(key) ?? [];
    // Deep clone to prevent mutation
    return events.map((event) => ({
      ...event,
      data: JSON.parse(JSON.stringify(event.data)),
      metadata: { ...event.metadata },
    }));
  }

  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<AggregateId, EventType>,
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

    for (const event of events) {
      const key = `${context.tenantId}:${aggregateType}:${String(event.aggregateId)}`;
      const aggregateEvents = this.eventsByKey.get(key) ?? [];
      // Deep clone to prevent mutation
      aggregateEvents.push({
        ...event,
        data: JSON.parse(JSON.stringify(event.data)),
        metadata: { ...event.metadata },
      });
      this.eventsByKey.set(key, aggregateEvents);

      // Track tenant + aggregateType -> aggregateId mapping
      const tenantTypeKey = `${context.tenantId}:${aggregateType}`;
      const aggregates =
        this.aggregatesByTenantAndType.get(tenantTypeKey) ?? new Set();
      aggregates.add(String(event.aggregateId));
      this.aggregatesByTenantAndType.set(tenantTypeKey, aggregates);
    }
  }

  async listAggregateIds(
    context: EventStoreReadContext<AggregateId, EventType>,
    aggregateType: AggregateType,
    cursor?: EventStoreListCursor,
    limit = 100,
  ): Promise<ListAggregateIdsResult<AggregateId>> {
    // Validate tenant context
    EventUtils.validateTenantId(context, "EventStoreMemory.listAggregateIds");

    const tenantTypeKey = `${context.tenantId}:${aggregateType}`;
    const aggregates =
      this.aggregatesByTenantAndType.get(tenantTypeKey) ?? new Set();
    const allIds = Array.from(aggregates).sort();

    // Apply cursor (skip IDs <= cursor)
    // Handle cursor as string comparison for special characters
    const cursorStr = cursor ? String(cursor) : void 0;
    const startIdx = cursorStr ? allIds.findIndex((id) => id > cursorStr) : 0;
    const filteredIds =
      startIdx === -1 ? [] : allIds.slice(startIdx, startIdx + limit);

    const nextCursor =
      filteredIds.length === limit
        ? filteredIds[filteredIds.length - 1]
        : void 0;

    return {
      aggregateIds: filteredIds as AggregateId[],
      nextCursor,
    };
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
    aggregateId: AggregateId,
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
