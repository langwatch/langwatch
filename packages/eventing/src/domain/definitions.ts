import type { AggregateType } from "./aggregateType.ts";
import type { EventType } from "./eventType.ts";

export interface EventDefinition<Type extends EventType = EventType> {
  readonly type: Type;
}

export interface AggregateDefinition<
  Type extends AggregateType = AggregateType,
  Events extends readonly EventDefinition[] = readonly EventDefinition[],
> {
  readonly type: Type;
  readonly events: Events;
}

export function defineAggregate<const Type extends AggregateType>(definition: {
  readonly type: Type;
}): AggregateDefinition<Type, readonly []> {
  if (definition.type.trim().length === 0) {
    throw new Error("Aggregate type must be a non-empty string");
  }
  return Object.freeze({ type: definition.type, events: Object.freeze([] as const) });
}

/** The aggregate a pipeline registers: its type and the types its `.withEvents` schemas name. */
export function aggregateWithEvents<const Type extends AggregateType>({
  aggregate,
  eventTypes,
}: {
  aggregate: AggregateDefinition<Type>;
  eventTypes: readonly EventType[];
}): AggregateDefinition<Type> {
  const seen = new Set<string>();
  for (const type of eventTypes) {
    if (type.trim().length === 0) {
      throw new Error(`Aggregate "${aggregate.type}" has an empty event type`);
    }
    if (seen.has(type)) {
      throw new Error(`Aggregate "${aggregate.type}" declares event "${type}" more than once`);
    }
    seen.add(type);
  }
  return Object.freeze({
    type: aggregate.type,
    events: Object.freeze(eventTypes.map((type) => Object.freeze({ type }))),
  });
}

type AnyAggregateDefinition = AggregateDefinition<AggregateType, readonly EventDefinition[]>;

export class EventCatalogue {
  private readonly aggregatesByType = new Map<AggregateType, AnyAggregateDefinition>();
  private readonly aggregateByEventType = new Map<EventType, AggregateType>();

  constructor(aggregates: readonly AnyAggregateDefinition[]) {
    for (const aggregate of aggregates) {
      const existingAggregateDefinition = this.aggregatesByType.get(aggregate.type);
      if (
        existingAggregateDefinition &&
        (existingAggregateDefinition.events.length > 0 || aggregate.events.length > 0)
      ) {
        throw new Error(`Aggregate type "${aggregate.type}" is registered twice`);
      }
      if (existingAggregateDefinition) continue;
      this.aggregatesByType.set(aggregate.type, aggregate);

      for (const event of aggregate.events) {
        const existingAggregate = this.aggregateByEventType.get(event.type);
        if (existingAggregate !== undefined) {
          throw new Error(
            `Event type "${event.type}" belongs to both "${existingAggregate}" and "${aggregate.type}"`,
          );
        }
        this.aggregateByEventType.set(event.type, aggregate.type);
      }
    }
  }

  get aggregates(): readonly AnyAggregateDefinition[] {
    return [...this.aggregatesByType.values()];
  }

  hasAggregate(type: AggregateType): boolean {
    return this.aggregatesByType.has(type);
  }

  hasEvent(type: EventType): boolean {
    return this.aggregateByEventType.has(type);
  }

  assertEvent(aggregateType: AggregateType, eventType: EventType): void {
    const registeredAggregate = this.aggregateByEventType.get(eventType);
    if (registeredAggregate === undefined) {
      throw new Error(`Event type "${eventType}" is not registered`);
    }
    if (registeredAggregate !== aggregateType) {
      throw new Error(
        `Event type "${eventType}" belongs to aggregate "${registeredAggregate}", not "${aggregateType}"`,
      );
    }
  }
}

export function createEventCatalogue(
  aggregates: readonly AnyAggregateDefinition[],
): EventCatalogue {
  return new EventCatalogue(aggregates);
}
