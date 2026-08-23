import type { AggregateType } from "./aggregateType";
import type { EventType } from "./eventType";

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

export function defineEvent<const Type extends EventType>(
  type: Type,
): EventDefinition<Type> {
  return Object.freeze({ type });
}

export function defineEvents<const Types extends readonly EventType[]>(
  types: Types,
): { readonly [Index in keyof Types]: EventDefinition<Types[Index]> } {
  return types.map((type) => defineEvent(type)) as {
    readonly [Index in keyof Types]: EventDefinition<Types[Index]>;
  };
}

export function defineAggregate<
  const Type extends AggregateType,
  const Events extends readonly EventDefinition[],
>(definition: AggregateDefinition<Type, Events>): AggregateDefinition<Type, Events> {
  if (definition.type.trim().length === 0) {
    throw new Error("Aggregate type must be a non-empty string");
  }

  const seen = new Set<string>();
  for (const event of definition.events) {
    if (event.type.trim().length === 0) {
      throw new Error(`Aggregate \"${definition.type}\" has an empty event type`);
    }
    if (seen.has(event.type)) {
      throw new Error(
        `Aggregate \"${definition.type}\" declares event \"${event.type}\" more than once`,
      );
    }
    seen.add(event.type);
  }

  return Object.freeze({
    type: definition.type,
    events: Object.freeze([...definition.events]) as unknown as Events,
  });
}

type AnyAggregateDefinition = AggregateDefinition<
  AggregateType,
  readonly EventDefinition[]
>;

export class EventCatalogue {
  private readonly aggregatesByType = new Map<
    AggregateType,
    AnyAggregateDefinition
  >();
  private readonly aggregateByEventType = new Map<EventType, AggregateType>();

  constructor(aggregates: readonly AnyAggregateDefinition[]) {
    for (const aggregate of aggregates) {
      const existingAggregateDefinition = this.aggregatesByType.get(
        aggregate.type,
      );
      if (
        existingAggregateDefinition &&
        (existingAggregateDefinition.events.length > 0 ||
          aggregate.events.length > 0)
      ) {
        throw new Error(`Aggregate type \"${aggregate.type}\" is registered twice`);
      }
      if (existingAggregateDefinition) continue;
      this.aggregatesByType.set(aggregate.type, aggregate);

      for (const event of aggregate.events) {
        const existingAggregate = this.aggregateByEventType.get(event.type);
        if (existingAggregate !== undefined) {
          throw new Error(
            `Event type \"${event.type}\" belongs to both \"${existingAggregate}\" and \"${aggregate.type}\"`,
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
      throw new Error(`Event type \"${eventType}\" is not registered`);
    }
    if (registeredAggregate !== aggregateType) {
      throw new Error(
        `Event type \"${eventType}\" belongs to aggregate \"${registeredAggregate}\", not \"${aggregateType}\"`,
      );
    }
  }
}

export function createEventCatalogue(
  aggregates: readonly AnyAggregateDefinition[],
): EventCatalogue {
  return new EventCatalogue(aggregates);
}
