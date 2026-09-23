import type { z } from "zod";

import type { AnyEventSchema } from "./abstractFoldProjection.ts";
import {
  type DotSnakeToPascal,
  type EventTypeOf,
  eventTypeToMapHandlerName,
  type StripPrefix,
  type UnionToIntersection,
} from "./eventTypeTransforms.ts";
import type { AppendStore, MapProjectionOptions } from "./mapProjection.types.ts";

// ---------------------------------------------------------------------------
// Map handler name derivation
// ---------------------------------------------------------------------------

/** `"lw.obs.trace.span_received"` → `"mapObsTraceSpanReceived"` */
type MapHandlerName<EventTypeStr extends string> =
  `map${DotSnakeToPascal<StripPrefix<EventTypeStr>>}`;

/**
 * Derives required map handler methods from an array of Zod event schemas,
 * e.g. `"lw.obs.trace.log_record_received"` produces
 * `mapObsTraceLogRecordReceived(event): Record | null`.
 */
export type MapEventHandlers<
  Schemas extends readonly AnyEventSchema[],
  Record,
> = UnionToIntersection<
  {
    [I in keyof Schemas]: Schemas[I] extends AnyEventSchema
      ? {
          [K in MapHandlerName<EventTypeOf<Schemas[I]>>]: (
            event: z.infer<Schemas[I]>,
          ) => Record | null;
        }
      : never;
  }[number]
>;

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

// Type-safe map projection base; structurally satisfies MapProjectionDefinition
// so instances pass directly to `.withClickHouseMapProjection()` without adapter.
export abstract class AbstractMapProjection<Record, Schemas extends readonly AnyEventSchema[]> {
  abstract readonly name: string;
  abstract readonly store: AppendStore<Record>;
  protected abstract readonly events: Schemas;

  /** Optional processing behavior configuration. */
  options?: MapProjectionOptions;

  /** Lazily-built dispatch map: event type string → handler method name. */
  private _dispatchMap?: globalThis.Record<string, string>;

  private get dispatchMap(): globalThis.Record<string, string> {
    if (!this._dispatchMap) {
      this._dispatchMap = {};
      for (const schema of this.events) {
        const eventType = schema.shape.type.value as string;
        this._dispatchMap[eventType] = eventTypeToMapHandlerName(eventType);
      }
    }
    return this._dispatchMap;
  }

  /**
   * Event types this projection reacts to — derived from schemas.
   */
  get eventTypes(): readonly string[] {
    return this.events.map((s) => s.shape.type.value as string);
  }

  /**
   * Dispatches the event to the appropriate typed mapXxx handler.
   * Returns null for unrecognized event types.
   */
  map(event: { type: string }): Record | null {
    const handlerName = this.dispatchMap[event.type];
    if (!handlerName) return null;

    const handler = this[handlerName as keyof this] as (e: { type: string }) => Record | null;
    return handler.call(this, event);
  }
}
