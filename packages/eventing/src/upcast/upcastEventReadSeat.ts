import type { Event } from "../domain/types.ts";
import type { AggregateEventsReadInput, EventReadSeat } from "../stores/eventReadSeat.ts";
import type { EventStoreEventReadInput } from "../stores/eventStore.types.ts";
import { EventUpcaster, type PipelineUpcasts } from "./eventUpcast.ts";
import { logOrder } from "./upcastEventStore.ts";

/**
 * The read seat with every pipeline's upcasts applied, re-read at each read as pipelines register
 * after the seat is composed (§9): a stored type answers as the current one, and a renamed
 * aggregate's read also reads its stored aggregate type. Spec: specs/event-read-seat.feature.
 */
export function upcastEventReadSeat<EventType extends Event>({
  seat,
  upcasts,
  parseEvent,
}: {
  seat: EventReadSeat<EventType>;
  upcasts: () => readonly PipelineUpcasts[];
  /** Parses an upcast event against the current schema of the pipeline that declares its type. */
  parseEvent: (value: unknown) => EventType;
}): EventReadSeat<EventType> {
  return new UpcastingEventReadSeat(seat, upcasts, parseEvent);
}

class UpcastingEventReadSeat<EventType extends Event> implements EventReadSeat<EventType> {
  constructor(
    private readonly seat: EventReadSeat<EventType>,
    private readonly upcasts: () => readonly PipelineUpcasts[],
    private readonly parseEvent: (value: unknown) => EventType,
  ) {}

  async getEvent(input: EventStoreEventReadInput): Promise<EventType> {
    const upcasters = this.#upcasters();
    let firstError: unknown;
    for (const aggregateType of aggregateTypesOf({
      upcasters,
      aggregateType: input.aggregateType,
    })) {
      let event: EventType;
      try {
        event = await this.seat.getEvent({ ...input, aggregateType });
      } catch (error) {
        firstError ??= error;
        continue;
      }
      // A stored row that fails its current schema is the failure to report, not "not found".
      return this.#current({ upcasters, event });
    }
    throw firstError;
  }

  async findAggregateEvents(input: AggregateEventsReadInput): Promise<readonly EventType[]> {
    const upcasters = this.#upcasters();
    const types = aggregateTypesOf({ upcasters, aggregateType: input.aggregateType });
    const reads = await Promise.all(
      types.map((aggregateType) => this.seat.findAggregateEvents({ ...input, aggregateType })),
    );
    const byId = new Map<string, EventType>();
    for (const stored of reads.flat()) {
      const known = byId.get(stored.id);
      // A row rewritten to the current type wins over its stored original.
      if (!known || upcasters.some((one) => one.declaresFrom(known.type))) {
        byId.set(stored.id, stored);
      }
    }
    const events = [...byId.values()].map((event) => this.#current({ upcasters, event }));
    return types.length > 1 ? events.toSorted(logOrder) : events;
  }

  /** An upcast event is parsed against its current schema, so a bad stored row fails the read. */
  #current({
    upcasters,
    event,
  }: {
    upcasters: readonly EventUpcaster[];
    event: EventType;
  }): EventType {
    const upcaster = upcasters.find((one) => one.declaresFrom(event.type));
    return upcaster ? this.parseEvent(upcaster.apply(event)) : event;
  }

  #upcasters(): EventUpcaster[] {
    return this.upcasts()
      .map((own) => EventUpcaster.of(own))
      .filter((one) => one.active);
  }
}

/** The asked aggregate type and every stored aggregate type a pipeline renamed into it. */
function aggregateTypesOf({
  upcasters,
  aggregateType,
}: {
  upcasters: readonly EventUpcaster[];
  aggregateType: string;
}): string[] {
  const former = upcasters
    .filter((one) => one.upcasts?.aggregateType === aggregateType)
    .flatMap((one) => one.formerAggregateTypes);
  return [...new Set([aggregateType, ...former])];
}
