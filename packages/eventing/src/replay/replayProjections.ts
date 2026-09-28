import { createTenantId } from "../domain/tenantId.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { SealedPipelineDefinition } from "../pipeline/sealedPipeline.ts";
import type {
  RegisteredCommand,
  StaticPipelineDefinition,
} from "../pipeline/staticBuilder.types.ts";
import type {
  FoldProjectionDefinition,
  FoldProjectionStore,
} from "../projections/foldProjection.types.ts";
import { RedisCachedFoldStore } from "../projections/redisCachedFoldStore.ts";
import {
  projectionConsumes,
  type SealedFoldProjection,
  type SealedStateProjection,
  sealFoldProjection,
  sealMapProjection,
  sealStateProjection,
} from "../projections/sealedProjection.ts";
import type { StateProjectionDefinition } from "../projections/stateProjection.types.ts";
import type { ReplayEvent } from "./replayEventSource.ts";
import type {
  RegisteredFoldProjection,
  RegisteredMapProjection,
  RegisteredStateProjection,
} from "./types.ts";

/** Every projection a process registered, in the shape a replay rebuilds it. */
export interface ReplayProjections {
  projections: RegisteredFoldProjection[];
  mapProjections: RegisteredMapProjection[];
  stateProjections: RegisteredStateProjection[];
}

/**
 * Reads the replayable projections off the registered pipelines (ARCHITECTURE §9): a fold's
 * Redis-cached store is unwrapped to its durable tier, and a map carries the `targetTable` its
 * owner declared, so no list outside the owning module names a store or a table.
 */
export function replayProjectionsOf(
  definitions: readonly SealedPipelineDefinition[],
): ReplayProjections {
  const replayable: ReplayProjections = {
    projections: [],
    mapProjections: [],
    stateProjections: [],
  };
  for (const sealed of definitions) {
    const own = sealed.open((definition) => replayProjectionsOfPipeline(definition));
    replayable.projections.push(...own.projections);
    replayable.mapProjections.push(...own.mapProjections);
    replayable.stateProjections.push(...own.stateProjections);
  }
  return replayable;
}

/**
 * The ADR-022 lean for replayed events: each pipeline declaring the event's type and a
 * projection preparation applies it, as live dispatch does before its projections.
 */
export function replayLeanOf(
  definitions: readonly SealedPipelineDefinition[],
): (event: ReplayEvent) => ReplayEvent {
  const leans = definitions.flatMap((sealed) => sealed.open((definition) => leanOf(definition)));
  if (leans.length === 0) return (event) => event;
  return (event) => leans.reduce((leaned, lean) => lean(leaned), event);
}

/** The durable tier a replay writes: never the Redis cache in front of it. */
export function durableFoldStoreOf<State>(
  store: FoldProjectionStore<State>,
): FoldProjectionStore<State> {
  return store instanceof RedisCachedFoldStore ? store.durableTier() : store;
}

function leanOf<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
  Commands extends RegisteredCommand,
>(
  definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
): ((event: ReplayEvent) => ReplayEvent)[] {
  const prepare = definition.prepareEventForProjection;
  const eventTypes = definition.aggregate.events.map((event) => event.type);
  if (!prepare || eventTypes.length === 0) return [];
  const declares = projectionConsumes<EventType, Event>({ eventTypes });
  return [
    (event) => {
      const domainEvent: Event = { ...event, tenantId: createTenantId(event.tenantId) };
      if (!declares(domainEvent)) return event;
      return { ...event, data: prepare(domainEvent).data };
    },
  ];
}

function replayProjectionsOfPipeline<
  EventType extends Event,
  ProjectionTypes extends Record<string, Projection>,
  Commands extends RegisteredCommand,
>(definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>): ReplayProjections {
  const { name: pipelineName, aggregateType } = definition.metadata;
  const identity = { pipelineName, aggregateType, source: "pipeline" as const };

  const projections = Array.from(definition.foldProjections.values()).map(
    (fold): RegisteredFoldProjection => ({
      ...identity,
      ...replayFold(fold),
      projectionName: fold.definition.name,
      // Folds enqueue as `__jobType=projection`, so the pause entry names that segment.
      pauseKey: `${pipelineName}/projection/${fold.definition.name}`,
      kind: "fold",
    }),
  );
  const mapProjections = Array.from(definition.mapProjections.values()).map(
    (map): RegisteredMapProjection => ({
      ...identity,
      ...map.open((own) => sealMapProjection(own)),
      projectionName: map.definition.name,
      // Maps enqueue as `__jobType=handler`; the dispatcher's pause check reads that segment.
      pauseKey: `${pipelineName}/handler/${map.definition.name}`,
      kind: "map",
      ...(map.definition.targetTable === undefined
        ? {}
        : { targetTable: map.definition.targetTable }),
    }),
  );
  const stateProjections = Array.from(definition.stateProjections?.values() ?? []).map(
    (state): RegisteredStateProjection => ({
      ...identity,
      ...replayState(state),
      projectionName: state.definition.name,
      pauseKey: `${pipelineName}/stateProjection/${state.definition.name}`,
      kind: "state",
    }),
  );
  return { projections, mapProjections, stateProjections };
}

/** A fold over its pipeline's events, opened over any replayed event through its own guard. */
function replayFold<EventType extends Event>(
  sealed: SealedFoldProjection<EventType>,
): SealedFoldProjection<Event> {
  return sealed.open((fold) => sealFoldProjection(widenedFold(fold)));
}

function widenedFold<State, EventType extends Event>(
  fold: FoldProjectionDefinition<State, EventType>,
): FoldProjectionDefinition<State, Event> {
  const consumes = projectionConsumes<EventType, Event>(fold);
  const key = fold.key;
  return {
    name: fold.name,
    version: fold.version,
    eventTypes: fold.eventTypes,
    init: () => fold.init(),
    apply: (state, event) => (consumes(event) ? fold.apply(state, event) : state),
    store: durableFoldStoreOf(fold.store),
    LastEventOccurredAtKey: fold.LastEventOccurredAtKey,
    ...(key === undefined
      ? {}
      : { key: (event: Event) => (consumes(event) ? key(event) : event.aggregateId) }),
    ...(fold.options === undefined ? {} : { options: fold.options }),
  };
}

function replayState<EventType extends Event>(
  sealed: SealedStateProjection<EventType>,
): SealedStateProjection<Event> {
  return sealed.open((state) => sealStateProjection(widenedState(state)));
}

function widenedState<State, EventType extends Event>(
  state: StateProjectionDefinition<State, EventType>,
): StateProjectionDefinition<State, Event> {
  const consumes = projectionConsumes<EventType, Event>(state);
  const key = state.key;
  return {
    name: state.name,
    version: state.version,
    eventTypes: state.eventTypes,
    init: () => state.init(),
    apply: (current, event) => (consumes(event) ? state.apply(current, event) : current),
    store: state.store,
    ...(key === undefined
      ? {}
      : { key: (event: Event) => (consumes(event) ? key(event) : event.aggregateId) }),
    ...(state.options === undefined ? {} : { options: state.options }),
  };
}
