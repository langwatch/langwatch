import type { Event } from "../domain/types.ts";
import type { FoldProjectionDefinition } from "./foldProjection.types.ts";
import type { MapProjectionDefinition } from "./mapProjection.types.ts";
import type { StateProjectionDefinition } from "./stateProjection.types.ts";

/** Opens a fold whose state type was sealed in a closure at registration (ARCHITECTURE §9). */
export type OpenFoldProjection<E extends Event = Event> = <R>(
  use: <State>(fold: FoldProjectionDefinition<State, E>) => R,
) => R;

/** Opens a map projection whose record type was sealed in a closure at registration. */
export type OpenMapProjection<E extends Event = Event> = <R>(
  use: <MapRecord>(map: MapProjectionDefinition<MapRecord, E>) => R,
) => R;

/** Opens a state projection whose state type was sealed in a closure at registration. */
export type OpenStateProjection<E extends Event = Event> = <R>(
  use: <State>(projection: StateProjectionDefinition<State, E>) => R,
) => R;

/** A registered fold: what reads without its state type, and the closure that opens it typed. */
export type FoldProjectionView<E extends Event = Event> = Omit<
  FoldProjectionDefinition<unknown, E>,
  "apply" | "store"
>;
export type MapProjectionView<E extends Event = Event> = Omit<
  MapProjectionDefinition<unknown, E>,
  "store"
>;
export type StateProjectionView<E extends Event = Event> = Omit<
  StateProjectionDefinition<unknown, E>,
  "apply" | "store"
>;

export interface SealedFoldProjection<E extends Event = Event> {
  readonly definition: FoldProjectionView<E>;
  readonly open: OpenFoldProjection<E>;
}

/** A registered map projection: its record-free view, and the closure that opens it typed. */
export interface SealedMapProjection<E extends Event = Event> {
  readonly definition: MapProjectionView<E>;
  readonly open: OpenMapProjection<E>;
}

/** A registered state projection: its state-free view, and the closure that opens it typed. */
export interface SealedStateProjection<E extends Event = Event> {
  readonly definition: StateProjectionView<E>;
  readonly open: OpenStateProjection<E>;
}

export function sealFoldProjection<State, E extends Event>(
  fold: FoldProjectionDefinition<State, E>,
): SealedFoldProjection<E> {
  return { definition: fold, open: (use) => use(fold) };
}

export function sealMapProjection<MapRecord, E extends Event>(
  map: MapProjectionDefinition<MapRecord, E>,
): SealedMapProjection<E> {
  return { definition: map, open: (use) => use(map) };
}

export function sealStateProjection<State, E extends Event>(
  projection: StateProjectionDefinition<State, E>,
): SealedStateProjection<E> {
  return { definition: projection, open: (use) => use(projection) };
}
