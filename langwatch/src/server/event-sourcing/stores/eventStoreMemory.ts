import type { AggregateType, Event } from "../";
import { ConfigurationError } from "../services/errorHandling";
import { AbstractEventStore } from "./abstractEventStore";
import { eventToRecord } from "./eventStoreUtils";
import type { EventRepository } from "./repositories/eventRepository.types";
import { EventRepositoryMemory } from "./repositories/eventRepositoryMemory";

/**
 * Simple in-memory EventStore used for tests and local development.
 *
 * **WARNING: NOT THREAD-SAFE**
 * This implementation is NOT safe for concurrent access.
 *
 * **Use Cases:**
 * - Unit tests
 * - Local development
 * - Single-threaded environments
 *
 * **DO NOT USE in production with multiple workers/processes.**
 * Use `EventStoreClickHouse` or another thread-safe implementation instead.
 *
 * Extends {@link AbstractEventStore} with:
 * - `postProcessEvents()`: sorts by timestamp then id, then deep clones to prevent mutation
 */
export class EventStoreMemory<
  EventType extends Event = Event,
> extends AbstractEventStore<EventType> {
  constructor(repository: EventRepository = new EventRepositoryMemory()) {
    super(repository);

    // Prevent accidental use in production - memory stores are not thread-safe
    if (process.env.NODE_ENV === "production") {
      throw new ConfigurationError(
        "EventStoreMemory",
        "EventStoreMemory is not thread-safe and cannot be used in production. Use EventStoreClickHouse or another thread-safe implementation instead.",
      );
    }
  }

  protected override postProcessEvents(events: EventType[]): EventType[] {
    // Sort by timestamp for consistent ordering (memory store doesn't guarantee order)
    const sorted = [...events].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.localeCompare(b.id);
    });

    // Deep clone to prevent mutation
    return sorted.map((event) => ({
      ...event,
      data: JSON.parse(JSON.stringify(event.data)),
      metadata: { ...event.metadata },
    }));
  }

  /**
   * Seeds the event store with events for a given aggregate.
   * Useful in tests.
   */
  async seed(
    _aggregateId: string,
    events: EventType[],
    _tenantId: string,
    _aggregateType: AggregateType,
  ): Promise<void> {
    const records = events.map((event) => eventToRecord(event));
    await this.repository.insertEventRecords(records);
  }
}
