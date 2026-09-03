import type { AggregateType } from "../domain/aggregateType";
import type { Event } from "../domain/types";
import { ConfigurationError } from "../services/errorHandling";
import type {
  EventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "./eventStore.types";

/**
 * The event store of a process that only PRODUCES commands.
 *
 * A producer sends commands to `event-sourcing/jobs` and stops there: the
 * process that claims the queue is the one that runs the handlers, appends
 * their events and folds the projections. Nothing on the producer's side of
 * that boundary reads or writes the event log — `EventSourcingService` touches
 * the store from `storeEvents` and from the fold loaders it builds for
 * projections, and both run on the consumer.
 *
 * The runtime still requires a store, and for a good reason: registering a
 * pipeline without one hands back a {@link DisabledPipeline} whose commands are
 * silently dropped, which is the worst possible answer for a write path. This
 * class is how a producer says "I have no event log" without taking that
 * answer. Every method refuses, loudly and by name, so the property is
 * structural rather than a thing the composition root has to keep true:
 *
 *  - a producer that grew a consumer without composing an event store fails on
 *    its first append instead of writing nowhere, and
 *  - a memory store in the same seat would ACCEPT that append, hold the event
 *    in one process's heap, and lose it — a silent, total loss of exactly the
 *    durable write the ledger exists to guarantee.
 *
 * It is not a test double and does not belong in one: `EventStoreMemory` is the
 * store a test wants. This one is a production composition's honest statement
 * about which half of the system it is.
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
