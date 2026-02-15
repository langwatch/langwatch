/**
 * Helper types for better TypeScript inference and type safety.
 */

import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStore } from "../stores/projectionStore.types";
import type { Event, Projection } from "./types";
import { EventSchema, ProjectionSchema } from "./types";

/**
 * Extracts the payload type from an Event type.
 */
export type ExtractEventPayload<TEvent extends Event> =
  TEvent extends Event<infer P> ? P : never;

/**
 * Extracts the data type from a Projection type.
 */
export type ExtractProjectionData<TProjection extends Projection> =
  TProjection extends Projection<infer D> ? D : never;

/**
 * Helper type to infer Event and State types from a FoldProjectionDefinition.
 */
export type InferFoldProjectionEvent<
  TFold extends FoldProjectionDefinition<any, any>,
> = TFold extends FoldProjectionDefinition<any, infer E> ? E : never;

export type InferFoldProjectionState<
  TFold extends FoldProjectionDefinition<any, any>,
> = TFold extends FoldProjectionDefinition<infer S, any> ? S : never;

/**
 * @deprecated Use InferFoldProjectionEvent instead.
 */
export type InferProjectionHandlerEvent<T> = T extends FoldProjectionDefinition<any, infer E> ? E : never;

/**
 * @deprecated Use InferFoldProjectionState instead.
 */
export type InferProjectionHandlerProjection<T> = T extends FoldProjectionDefinition<infer S, any> ? S : never;

/**
 * Helper type to infer the Event type from an EventStore.
 */
export type InferEventStoreEvent<TStore extends EventStore<any>> =
  TStore extends EventStore<infer E> ? E : never;

/**
 * Helper type to infer the Projection type from a ProjectionStore.
 */
export type InferProjectionStoreProjection<
  TStore extends ProjectionStore<any>,
> = TStore extends ProjectionStore<infer P> ? P : never;

/**
 * Type guard to check if a value is a valid Event.
 * Useful for runtime validation with type narrowing.
 */
export function isEvent(value: unknown): value is Event {
  if (typeof value !== "object" || value === null) return false;
  const result = EventSchema.safeParse(value);
  if (!result.success) return false;
  // Explicitly check that data is not undefined
  return "data" in value && (value as any).data !== undefined;
}

/**
 * Type guard to check if a value is a valid Projection.
 * Useful for runtime validation with type narrowing.
 */
export function isProjection(value: unknown): value is Projection {
  if (typeof value !== "object" || value === null) return false;
  const result = ProjectionSchema.safeParse(value);
  if (!result.success) return false;
  // Explicitly check that data is not undefined
  return "data" in value && (value as any).data !== undefined;
}
