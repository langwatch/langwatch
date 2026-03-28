import type { z } from "zod";
import type { AnyEventSchema } from "./abstractFoldProjection";
import type { AppendStore, MapProjectionOptions } from "./mapProjection.types";
import {
  type StripPrefix,
  type DotSnakeToPascal,
  type UnionToIntersection,
  eventTypeToMapHandlerName,
} from "./eventTypeTransforms";

// ---------------------------------------------------------------------------
// Schema → event type extraction (shared with fold)
// ---------------------------------------------------------------------------

/** Extract the literal event type string from a Zod schema's output type. */
type EventTypeOf<S> = S extends z.ZodType<
  { type: infer T extends string },
  any,
  any
>
  ? T
  : never;

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
 * directly to `.withMapProjection()` without any adapter.
 *
 * **Usage:**
 * ```typescript
 * const logEvents = [logRecordReceivedEventSchema] as const;
 *
 * class LogRecordStorageMapProjection
 *   extends AbstractMapProjection<NormalizedLogRecord, typeof logEvents>
 *   implements MapEventHandlers<typeof logEvents, NormalizedLogRecord>
 * {
 *   readonly name = "logRecordStorage";
 *   readonly store: AppendStore<NormalizedLogRecord>;
 *   protected readonly events = logEvents;
 *
 *   constructor(deps: { store: AppendStore<NormalizedLogRecord> }) {
 *     super();
 *     this.store = deps.store;
 *   }
 *
 *   mapObsTraceLogRecordReceived(event: LogRecordReceivedEvent): NormalizedLogRecord {
 *     return { ... };
 *   }
 * }
 * ```
 */
export abstract class AbstractMapProjection<
  Record,
  Schemas extends readonly AnyEventSchema[],
> {
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

    const handler = this[handlerName as keyof this] as (
      e: { type: string },
    ) => Record | null;
    return handler.call(this, event);
  }
}
