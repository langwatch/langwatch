import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event } from "../domain/types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type {
  EventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "./eventStore.types.ts";

/**
 * Event store for producer-only processes; refuses all operations loudly to prevent silent
 * failures and signal when a consumer was added without an event store.
 */
export class EventStoreProducerOnly<
  EventType extends Event = Event,
> implements EventStore<EventType> {
  static create<EventType extends Event = Event>(options: {
    /** Names the process in the refusal, so a stack trace says whose store this is. */
    processName: string;
  }): EventStoreProducerOnly<EventType> {
    return new EventStoreProducerOnly<EventType>(options.processName);
  }

  private constructor(private readonly processName: string) {}

  getEvent(_input: EventStoreEventReadInput): Promise<EventType> {
    return Promise.reject(this.refuse("getEvent"));
  }

  getEvents(
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _aggregateType: AggregateType,
    _anchorOccurredAtMs?: number,
  ): Promise<readonly EventType[]> {
    return Promise.reject(this.refuse("getEvents"));
  }

  getEventsOccurredSince(
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _aggregateType: AggregateType,
    _occurredAtFromMs: number,
  ): Promise<readonly EventType[]> {
    return Promise.reject(this.refuse("getEventsOccurredSince"));
  }

  getEventsUpTo(
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _aggregateType: AggregateType,
    _upToEvent: EventType,
  ): Promise<readonly EventType[]> {
    return Promise.reject(this.refuse("getEventsUpTo"));
  }

  countEventsBefore(
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _aggregateType: AggregateType,
    _beforeTimestamp: number,
    _beforeEventId: string,
  ): Promise<number> {
    return Promise.reject(this.refuse("countEventsBefore"));
  }

  storeEvents(
    _events: readonly EventType[],
    _context: EventStoreReadContext<EventType>,
    _aggregateType: AggregateType,
  ): Promise<void> {
    return Promise.reject(this.refuse("storeEvents"));
  }

  private refuse(operation: string): ConfigurationError {
    return new ConfigurationError(
      "EventStoreProducerOnly",
      `${this.processName} produces commands and does not consume them, so it has no event log to ${operation} against. Compose a durable event store in the process that claims the shared queue.`,
      { operation, processName: this.processName },
    );
  }
}
