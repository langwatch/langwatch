import type { Event } from "../domain/types.ts";
import { compareOrdinal } from "../utils/compareOrdinal.ts";
import { AbstractEventStore } from "./abstractEventStore.ts";
import { eventToRecord } from "./eventStoreUtils.ts";
import type { EventRepository } from "./repositories/eventRepository.types.ts";
import { EventRepositoryMemory } from "./repositories/eventRepositoryMemory.ts";

/**
 * In-memory EventStore for tests and local development. NOT thread-safe; use
 * EventingClickHouseEventStore in production.
 */
export class EventStoreMemory<
  EventType extends Event = Event,
> extends AbstractEventStore<EventType> {
  private constructor(repository: EventRepository) {
    super(repository);
  }

  static createForTesting<EventType extends Event = Event>(
    repository?: EventRepository,
  ): EventStoreMemory<EventType> {
    return new EventStoreMemory<EventType>(repository ?? EventRepositoryMemory.createForTesting());
  }

  static createForLocalDevelopment<EventType extends Event = Event>(
    repository?: EventRepository,
  ): EventStoreMemory<EventType> {
    return new EventStoreMemory<EventType>(
      repository ?? EventRepositoryMemory.createForLocalDevelopment(),
    );
  }

  protected override postProcessEvents(events: EventType[]): EventType[] {
    // Sort by createdAt for consistent ordering (memory store doesn't
    // guarantee order). The id tie-break is plain relational (byte-wise),
    // never localeCompare — it must match ClickHouse's EventId ordering and
    // the shared cursor comparator on same-millisecond ties.
    const sorted = [...events].toSorted((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return compareOrdinal(a.id, b.id);
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
  async seed({ events }: { events: EventType[] }): Promise<void> {
    const records = events.map((event) => eventToRecord(event));
    await this.repository.insertEventRecords(records);
  }
}
