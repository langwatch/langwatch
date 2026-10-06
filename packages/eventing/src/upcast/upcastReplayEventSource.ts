import type { SealedPipelineDefinition } from "../pipeline/sealedPipeline.ts";
import type {
  DiscoveredAggregateWithEventTypes,
  ReplayEvent,
  ReplayEventSource,
} from "../replay/replayEventSource.ts";
import { EventUpcaster, type PipelineUpcasts } from "./eventUpcast.ts";

/** Every registered pipeline's upcasts, read off the definitions the process registered (§9). */
export function pipelineUpcastsOf(
  definitions: readonly SealedPipelineDefinition[],
): PipelineUpcasts[] {
  return definitions.flatMap((sealed) => sealed.open((definition) => definition.upcasts ?? []));
}

/**
 * A replay's reads with every registered pipeline's upcasts applied (§9; Alex, 2026-10-06):
 * discovery, counts, cutoffs and streams also ask for the stored types and renamed aggregate
 * types, and each event read answers the current type. Spec: specs/event-upcast.feature.
 */
export function upcastReplayEventSource({
  source,
  upcasts,
}: {
  source: ReplayEventSource;
  upcasts: readonly PipelineUpcasts[];
}): ReplayEventSource {
  const upcasters = upcasts.map((own) => EventUpcaster.of(own)).filter((one) => one.active);
  return upcasters.length === 0 ? source : new UpcastingReplayEventSource(source, upcasters);
}

class UpcastingReplayEventSource implements ReplayEventSource {
  constructor(
    private readonly source: ReplayEventSource,
    private readonly upcasters: readonly EventUpcaster[],
  ) {}

  get optimizeTables(): ReplayEventSource["optimizeTables"] {
    return this.source.optimizeTables?.bind(this.source);
  }

  async discoverAffectedAggregates(
    input: Parameters<ReplayEventSource["discoverAffectedAggregates"]>[0],
  ): Promise<DiscoveredAggregateWithEventTypes[]> {
    const found = await this.source.discoverAffectedAggregates({
      ...input,
      eventTypes: this.#widenTypes(input.eventTypes),
    });
    const byKey = new Map<string, DiscoveredAggregateWithEventTypes>();
    for (const aggregate of found) {
      const current = {
        ...aggregate,
        aggregateType: this.#currentAggregateType(aggregate.aggregateType),
        eventTypes: aggregate.eventTypes.map((type) => this.#currentType(type)),
      };
      const key = `${current.tenantId}\u0000${current.aggregateType}\u0000${current.aggregateId}`;
      const known = byKey.get(key);
      byKey.set(key, {
        ...current,
        eventTypes: [...new Set([...(known?.eventTypes ?? []), ...current.eventTypes])],
      });
    }
    return [...byKey.values()];
  }

  countEventsForAggregates(input: Parameters<ReplayEventSource["countEventsForAggregates"]>[0]) {
    return this.source.countEventsForAggregates({
      ...input,
      eventTypes: this.#widenTypes(input.eventTypes),
    });
  }

  getBoundedCutoffs(input: Parameters<ReplayEventSource["getBoundedCutoffs"]>[0]) {
    return this.source.getBoundedCutoffs({
      ...input,
      aggregateTypes: this.#widenAggregateTypes(input.aggregateTypes),
      eventTypes: this.#widenTypes(input.eventTypes),
    });
  }

  streamEventsForAggregates(input: Parameters<ReplayEventSource["streamEventsForAggregates"]>[0]) {
    return this.source.streamEventsForAggregates({
      ...input,
      eventTypes: this.#widenTypes(input.eventTypes),
      onEvent: (event) => input.onEvent(this.#current(event)),
    });
  }

  async loadAggregateEvents(
    input: Parameters<ReplayEventSource["loadAggregateEvents"]>[0],
  ): Promise<ReplayEvent[]> {
    const events = await this.source.loadAggregateEvents({
      ...input,
      eventTypes: this.#widenTypes(input.eventTypes),
    });
    return events.map((event) => this.#current(event));
  }

  #widenTypes(types: readonly string[]): string[] {
    return this.upcasters.reduce<string[]>((wide, one) => one.widenTypes(wide), [...types]);
  }

  #widenAggregateTypes(types: readonly string[]): string[] {
    const former = this.upcasters
      .filter((one) => one.upcasts && types.includes(one.upcasts.aggregateType))
      .flatMap((one) => one.formerAggregateTypes);
    return [...new Set([...types, ...former])];
  }

  #currentType(type: string): string {
    return this.upcasters.find((one) => one.declaresFrom(type))?.currentType(type) ?? type;
  }

  #currentAggregateType(aggregateType: string): string {
    const renamed = this.upcasters.find((one) => one.formerAggregateTypes.includes(aggregateType));
    return renamed ? renamed.currentAggregateType(aggregateType) : aggregateType;
  }

  #current(event: ReplayEvent): ReplayEvent {
    const upcaster = this.upcasters.find((one) => one.declaresFrom(event.type));
    return upcaster ? upcaster.apply(event) : event;
  }
}
