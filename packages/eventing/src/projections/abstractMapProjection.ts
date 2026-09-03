import type { z } from "zod";
import type { AnyEventSchema } from "./abstractFoldProjection";
import {
  type DotSnakeToPascal,
  type EventTypeOf,
  eventTypeToMapHandlerName,
  type StripPrefix,
  type UnionToIntersection,
} from "./eventTypeTransforms";
import type { AppendStore, MapProjectionOptions } from "./mapProjection.types";

// ---------------------------------------------------------------------------
// Map handler name derivation
// ---------------------------------------------------------------------------

/** `"lw.obs.trace.span_received"` → `"mapObsTraceSpanReceived"` */
type MapHandlerName<EventTypeStr extends string> =
  `map${DotSnakeToPascal<StripPrefix<EventTypeStr>>}`;

/**
 * Derives required map handler methods from an array of Zod event schemas.
 *
 * Given a schema for event type `"lw.obs.trace.log_record_received"`, produces:
 * ```
 * { mapObsTraceLogRecordReceived(event: LogRecordReceivedEvent): Record | null }
 * ```
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

/**
 * Abstract base class for type-safe map projections.
 *
 * Structurally satisfies `MapProjectionDefinition` so instances can be passed
 * directly to `.withClickHouseMapProjection()` without an adapter.
 *
 * **Usage:**
 * ```typescript
 * const events = [canonicalLogRecordReceivedEventSchema] as const;
 *
 * class CanonicalLogStorageMapProjection
 *   extends AbstractMapProjection<CanonicalLogRecord, typeof events>
 *   implements MapEventHandlers<typeof events, CanonicalLogRecord>
 * {
 *   readonly name = "canonicalLogStorage";
 *   readonly store: AppendStore<CanonicalLogRecord>;
 *   protected readonly events = events;
 *
 *   constructor(deps: { store: AppendStore<CanonicalLogRecord> }) {
 *     super();
 *     this.store = deps.store;
 *   }
 *
 *   mapLogRecordReceived(event: CanonicalLogRecordReceivedEvent): CanonicalLogRecord {
 *     return event.data;
 *   }
 * }
 * ```
 */
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
