import type { z } from "zod";

import type { Event } from "../domain/types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type { FoldProjectionDefinition } from "./foldProjection.types.ts";
import type { MapProjectionDefinition, MapProjectionOptions } from "./mapProjection.types.ts";

/** One owner event a peer projection consumes: the owner contract's type and data schema. */
export interface PeerEventSchema<Type extends string = string, Data extends z.ZodType = z.ZodType> {
  readonly type: Type;
  readonly data: Data;
}

/** An owner event as a peer projection sees it: the envelope, its data parsed by contract. */
export type PeerEvent<Events extends readonly PeerEventSchema[]> = {
  [K in keyof Events]: Events[K] extends PeerEventSchema<infer Type, infer Data>
    ? Event<z.output<Data>> & { type: Type }
    : never;
}[number];

/** A peer fold: the owner events it consumes and the host's own fold over them (§9). */
export interface PeerFoldProjectionDeclaration<
  State,
  Events extends readonly PeerEventSchema[] = readonly PeerEventSchema[],
> {
  readonly events: Events;
  readonly fold: FoldProjectionDefinition<State, PeerEvent<Events>>;
}

/** A peer map: the owner events it consumes and the host's own map over them (§9). */
export interface PeerMapProjectionDeclaration<
  MapRecord,
  Events extends readonly PeerEventSchema[] = readonly PeerEventSchema[],
> {
  readonly events: Events;
  readonly map: MapProjectionDefinition<MapRecord, PeerEvent<Events>>;
}

/** The host's fold as its global-registry lane: every event parsed by the owner's contract. */
export function peerFoldProjection<State, Events extends readonly PeerEventSchema[]>({
  lane,
  declaration: { events, fold },
}: {
  lane: string;
  declaration: PeerFoldProjectionDeclaration<State, Events>;
}): FoldProjectionDefinition<State, Event> {
  const peer = peerParser<Events>({ lane, events, eventTypes: fold.eventTypes });
  const key = fold.key?.bind(fold);
  return {
    name: lane,
    version: fold.version,
    eventTypes: fold.eventTypes,
    init: () => fold.init(),
    apply: (state, event) => fold.apply(state, peer.parse(event)),
    store: fold.store,
    LastEventOccurredAtKey: fold.LastEventOccurredAtKey,
    ...(key && { key: (event: Event) => peer.groupKey(event, key) }),
    ...(fold.options && { options: fold.options }),
  };
}

/** The host's map as its global-registry lane: every event parsed by the owner's contract. */
export function peerMapProjection<MapRecord, Events extends readonly PeerEventSchema[]>({
  lane,
  declaration: { events, map },
}: {
  lane: string;
  declaration: PeerMapProjectionDeclaration<MapRecord, Events>;
}): MapProjectionDefinition<MapRecord, Event> {
  const peer = peerParser<Events>({ lane, events, eventTypes: map.eventTypes });
  return {
    name: lane,
    eventTypes: map.eventTypes,
    map: (event) => map.map(peer.parse(event)),
    store: map.store,
    ...(map.targetTable !== undefined && { targetTable: map.targetTable }),
    ...(map.options && { options: peerMapOptions({ options: map.options, peer }) }),
  };
}

interface PeerParser<Events extends readonly PeerEventSchema[]> {
  /** The event with its data parsed by the declared schema; throws, to be retried, on refusal. */
  parse(event: Event): PeerEvent<Events>;
  /** The host's key over the parsed event; data the schema refuses keys on its own aggregate. */
  groupKey(event: Event, key: (event: PeerEvent<Events>) => string): string;
  /** The host's enqueue filter; data the schema refuses is staged so the projection reports it. */
  admits(event: Event, filter: (event: PeerEvent<Events>) => boolean): boolean;
}

function peerParser<Events extends readonly PeerEventSchema[]>({
  lane,
  events,
  eventTypes,
}: {
  lane: string;
  events: Events;
  eventTypes: readonly string[];
}): PeerParser<Events> {
  const schemas = new Map<string, z.ZodType>(events.map(({ type, data }) => [type, data]));
  const unnamed = eventTypes.filter((type) => !schemas.has(type));
  if (eventTypes.length === 0 || unnamed.length > 0) {
    throw new ConfigurationError(
      "PipelineBuilder",
      `Peer projection "${lane}" must consume only owner events it names with their contract schema; ` +
        `unnamed: [${unnamed.join(", ")}]${eventTypes.length === 0 ? " (it consumes none)" : ""}`,
      { projectionName: lane, unnamed },
    );
  }
  const tryParse = (event: Event): PeerEvent<Events> | undefined => {
    const parsed = schemas.get(event.type)?.safeParse(event.data);
    return parsed?.success ? ({ ...event, data: parsed.data } as PeerEvent<Events>) : undefined;
  };
  return {
    parse: (event) => {
      const schema = schemas.get(event.type);
      if (!schema) {
        throw new ConfigurationError("PeerProjection", `"${lane}" was handed "${event.type}"`, {
          projectionName: lane,
          eventType: event.type,
        });
      }
      return { ...event, data: schema.parse(event.data) } as PeerEvent<Events>;
    },
    groupKey: (event, key) => {
      const parsed = tryParse(event);
      return parsed ? key(parsed) : `${event.aggregateType}:${String(event.aggregateId)}`;
    },
    admits: (event, filter) => {
      const parsed = tryParse(event);
      return parsed ? filter(parsed) : true;
    },
  };
}

function peerMapOptions<Events extends readonly PeerEventSchema[]>({
  options: { groupKeyFn, enqueue, ...rest },
  peer,
}: {
  options: MapProjectionOptions<PeerEvent<Events>>;
  peer: PeerParser<Events>;
}): MapProjectionOptions<Event> {
  const filter = enqueue?.filter;
  return {
    ...rest,
    ...(groupKeyFn && { groupKeyFn: (event: Event) => peer.groupKey(event, groupKeyFn) }),
    ...(filter && { enqueue: { filter: (event: Event) => peer.admits(event, filter) } }),
  };
}
