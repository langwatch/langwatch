/**
 * Helper types for better TypeScript inference and type safety.
 */

import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStore } from "../stores/projectionStore.types";
import type { ProjectionHandler } from "./handlers/projectionHandler";
import type { Event, Projection } from "./types";
import { EventSchema, ProjectionSchema } from "./types";

/**
 * Extracts the payload type from an Event type.
 *
 * @example
 * ```typescript
 * type MyEvent = Event<string, MyPayload>;
 * type Payload = ExtractEventPayload<MyEvent>; // MyPayload
 * ```
 */
export type ExtractEventPayload<TEvent extends Event> =
  TEvent extends Event<infer P> ? P : never;

/**
 * Extracts the data type from a Projection type.
 *
 * @example
 * ```typescript
 * type MyProjection = Projection<string, MyData>;
 * type Data = ExtractProjectionData<MyProjection>; // MyData
 * ```
 */
export type ExtractProjectionData<TProjection extends Projection> =
  TProjection extends Projection<infer D> ? D : never;

/**
 * Helper type to infer Event and Projection types from a ProjectionHandler.
 *
 * @example
 * ```typescript
 * type Handler = ProjectionHandler<MyEvent, MyProjection>;
 * type InferredEvent = InferProjectionHandlerEvent<Handler>; // MyEvent
 * type InferredProjection = InferProjectionHandlerProjection<Handler>; // MyProjection
 * ```
 */
export type InferProjectionHandlerEvent<
  THandler extends ProjectionHandler<any, any>,
> = THandler extends ProjectionHandler<infer E, any> ? E : never;

export type InferProjectionHandlerProjection<
  THandler extends ProjectionHandler<any, any>,
> = THandler extends ProjectionHandler<any, infer P> ? P : never;

/**
 * Helper type to infer the Event type from an EventStore.
 *
 * @example
 * ```typescript
 * type MyStore = EventStore<MyEvent>;
 * type InferredEvent = InferEventStoreEvent<MyStore>; // MyEvent
 * ```
 */
export type InferEventStoreEvent<TStore extends EventStore<any>> =
  TStore extends EventStore<infer E> ? E : never;

/**
 * Helper type to infer the Projection type from a ProjectionStore.
 *
 * @example
 * ```typescript
 * type MyStore = ProjectionStore<MyProjection>;
 * type InferredProjection = InferProjectionStoreProjection<MyStore>; // MyProjection
 * ```
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
