import type { Event } from "../domain/types.ts";
import type {
  EventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "../stores/eventStore.types.ts";
import { compareOrdinal } from "../utils/compareOrdinal.ts";
import type { EventUpcaster } from "./eventUpcast.ts";

/**
 * One pipeline's reads of the shared log with its upcasts applied (§9; Alex, 2026-10-06): a read
 * of its own aggregate also reads the aggregate types it renamed, answers each event once, in log
 * order, and parses a stored type with the current schema. Spec: specs/event-upcast.feature.
 */
export function upcastEventStore<EventType extends Event>({
  store,
  upcaster,
  parseEvent,
}: {
  store: EventStore<EventType>;
  upcaster: EventUpcaster;
  parseEvent: (value: unknown) => EventType;
}): EventStore<EventType> {
  return upcaster.active ? new UpcastingEventStore(store, upcaster, parseEvent) : store;
}

class UpcastingEventStore<EventType extends Event> implements EventStore<EventType> {
  constructor(
    private readonly store: EventStore<EventType>,
    private readonly upcaster: EventUpcaster,
    private readonly parseEvent: (value: unknown) => EventType,
  ) {}

  storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: string,
  ): Promise<void> {
    return this.store.storeEvents(events, context, aggregateType);
  }

  async getEvent(input: EventStoreEventReadInput): Promise<EventType> {
    let firstError: unknown;
    for (const aggregateType of this.#aggregateTypes(input.aggregateType)) {
      try {
        return this.#current(await this.store.getEvent({ ...input, aggregateType }));
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError;
  }

  getEvents(request: Parameters<EventStore<EventType>["getEvents"]>[0]) {
    return this.#merged(request.aggregateType, (aggregateType) =>
      this.store.getEvents({ ...request, aggregateType }),
    );
  }

  findEventsOfAggregates(request: Parameters<EventStore<EventType>["findEventsOfAggregates"]>[0]) {
    return this.#merged(request.aggregateType, (aggregateType) =>
      this.store.findEventsOfAggregates({ ...request, aggregateType }),
    );
  }

  getEventsOccurredSince(request: Parameters<EventStore<EventType>["getEventsOccurredSince"]>[0]) {
    return this.#merged(request.aggregateType, (aggregateType) =>
      this.store.getEventsOccurredSince({ ...request, aggregateType }),
    );
  }

  getEventsUpTo(request: Parameters<EventStore<EventType>["getEventsUpTo"]>[0]) {
    return this.#merged(request.aggregateType, (aggregateType) =>
      this.store.getEventsUpTo({ ...request, aggregateType }),
    );
  }

  get getEventsUpToPaged(): EventStore<EventType>["getEventsUpToPaged"] {
    const paged = this.store.getEventsUpToPaged?.bind(this.store);
    if (!paged) return undefined;
    return (request) =>
      this.#page(request, ({ aggregateType, after }) =>
        paged({ ...request, aggregateType, after }),
      );
  }

  get getEventsPaged(): EventStore<EventType>["getEventsPaged"] {
    const paged = this.store.getEventsPaged?.bind(this.store);
    if (!paged) return undefined;
    return (request) =>
      this.#page(request, ({ aggregateType, after }) =>
        paged({ ...request, aggregateType, after }),
      );
  }

  /**
   * A page short only when the history is exhausted. One type: its raw page, never deduped (the
   * caller dedupes across pages). Several: one id under two types collapses, the rewritten row
   * winning, and reading continues until the page is full or every type is exhausted.
   */
  async #page(
    request: { aggregateType: string; after: PageCursor | undefined; limit: number },
    read: (page: {
      aggregateType: string;
      after: PageCursor | undefined;
    }) => Promise<readonly EventType[]>,
  ): Promise<readonly EventType[]> {
    const types = this.#aggregateTypes(request.aggregateType);
    if (types.length === 1) {
      const page = await read({ aggregateType: types[0]!, after: request.after });
      return page.map((stored) => this.#current(stored));
    }
    const byId = new Map<string, EventType>();
    let after = request.after;
    for (;;) {
      const reads = await Promise.all(types.map((aggregateType) => read({ aggregateType, after })));
      const fetched = reads.flat().toSorted(logOrder);
      for (const stored of fetched) this.#keepPreferred(byId, stored);
      const exhausted = reads.every((page) => page.length < request.limit);
      const last = fetched.at(-1);
      if (exhausted || last === undefined || byId.size >= request.limit) break;
      after = { timestamp: last.createdAt, eventId: last.id };
    }
    return [...byId.values()]
      .map((stored) => this.#current(stored))
      .toSorted(logOrder)
      .slice(0, request.limit);
  }

  async countEventsBefore(
    request: Parameters<EventStore<EventType>["countEventsBefore"]>[0],
  ): Promise<number> {
    const counts = await Promise.all(
      this.#aggregateTypes(request.aggregateType).map((aggregateType) =>
        this.store.countEventsBefore({ ...request, aggregateType }),
      ),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }

  /** The pipeline's own aggregate type and those it renamed; any other aggregate reads as asked. */
  #aggregateTypes(aggregateType: string): string[] {
    const own = this.upcaster.upcasts?.aggregateType;
    return aggregateType === own ? [own, ...this.upcaster.formerAggregateTypes] : [aggregateType];
  }

  /** A row rewritten to the current type wins over its stored original. */
  #keepPreferred(byId: Map<string, EventType>, stored: EventType): void {
    const known = byId.get(stored.id);
    if (!known || this.upcaster.declaresFrom(known.type)) byId.set(stored.id, stored);
  }

  async #merged(
    aggregateType: string,
    read: (aggregateType: string) => Promise<readonly EventType[]>,
  ): Promise<readonly EventType[]> {
    const types = this.#aggregateTypes(aggregateType);
    const reads = await Promise.all(types.map(read));
    const byId = new Map<string, EventType>();
    for (const stored of reads.flat()) this.#keepPreferred(byId, stored);
    const events = [...byId.values()].map((stored) => this.#current(stored));
    return types.length > 1 ? events.toSorted(logOrder) : events;
  }

  #current(stored: EventType): EventType {
    return this.upcaster.declaresFrom(stored.type)
      ? this.parseEvent(this.upcaster.apply(stored))
      : stored;
  }
}

/** The log's order, `EventTimestamp, EventId`, as ClickHouse and the memory repository read it. */
/** A paged read's strict cursor: the last row of the previous page. */
type PageCursor = { timestamp: number; eventId: string };

function logOrder(left: Event, right: Event): number {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return compareOrdinal(left.id, right.id);
}
