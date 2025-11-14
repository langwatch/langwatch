import type { EventStore, EventStoreContext } from "./eventStore";
import type { SpanEvent } from "../types";

/**
 * Simple in-memory EventStore used for tests and local development.
 */
export class EventStoreMemory implements EventStore {
  private readonly eventsByAggregate = new Map<string, SpanEvent[]>();

  async getEvents(traceId: string, _context?: EventStoreContext): Promise<SpanEvent[]> {
    return this.eventsByAggregate.get(traceId) ?? [];
  }

  async storeEvents(events: readonly SpanEvent[]): Promise<void> {
    for (const event of events) {
      const aggregateEvents = this.eventsByAggregate.get(event.aggregateId) ?? [];
      aggregateEvents.push(event);
      this.eventsByAggregate.set(event.aggregateId, aggregateEvents);
    }
  }

  /**
   * Seeds the event store with events for a given aggregate.
   * Useful in tests.
   */
  seed(traceId: string, events: SpanEvent[]): void {
    this.eventsByAggregate.set(traceId, [...events]);
  }
}

