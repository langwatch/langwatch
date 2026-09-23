import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type { Event } from "../domain/types.ts";
import {
  type DotSnakeToPascal,
  type EventTypeOf,
  eventTypeToHandlerName,
  type StripPrefix,
  type UnionToIntersection,
} from "./eventTypeTransforms.ts";
import type { FoldProjectionOptions, FoldProjectionStore } from "./foldProjection.types.ts";

// ---------------------------------------------------------------------------
// Schema → event type extraction
// ---------------------------------------------------------------------------

/** Zod schema for an event with a literal `type` field. */
export type AnyEventSchema = z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>;

// ---------------------------------------------------------------------------
// Schema tuple → handler interface
// ---------------------------------------------------------------------------

/** All possible timestamp keys. Forbidden in `initState()` return type. */
type AllTimestampKeys =
  | "CreatedAt"
  | "UpdatedAt"
  | "createdAt"
  | "updatedAt"
  | "LastEventOccurredAt";

/** Full derivation: `"lw.suite_run.started"` → `"handleSuiteRunStarted"` */
type HandlerName<EventTypeStr extends string> =
  `handle${DotSnakeToPascal<StripPrefix<EventTypeStr>>}`;

// Derives required handler methods from Zod event schemas; keys are `handle`
// plus PascalCased event name minus the `"lw."` prefix.
export type FoldEventHandlers<
  Schemas extends readonly AnyEventSchema[],
  State,
> = UnionToIntersection<
  {
    [I in keyof Schemas]: Schemas[I] extends AnyEventSchema
      ? Record<
          HandlerName<EventTypeOf<Schemas[I]>>,
          (event: z.infer<Schemas[I]>, state: State) => State
        >
      : never;
  }[number]
>;

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

// Type-safe fold projection base; structurally satisfies FoldProjectionDefinition
// so instances pass directly to `.withClickHouseFoldProjection()` without adapter.
export abstract class AbstractFoldProjection<
  State extends Record<CK | UK | LEOAK, number>,
  Schemas extends readonly AnyEventSchema[],
  CK extends string = "CreatedAt",
  UK extends string = "UpdatedAt",
  LEOAK extends string = "LastEventOccurredAt",
  Store = FoldProjectionStore<State>,
> {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly store: Store;

  readonly createdAtKey: CK;
  readonly updatedAtKey: UK;
  readonly LastEventOccurredAtKey: LEOAK;

  constructor({
    createdAtKey,
    updatedAtKey,
    LastEventOccurredAtKey,
  }: {
    createdAtKey?: CK;
    updatedAtKey?: UK;
    LastEventOccurredAtKey?: LEOAK;
  } = {}) {
    this.createdAtKey = createdAtKey ?? ("CreatedAt" as CK);
    this.updatedAtKey = updatedAtKey ?? ("UpdatedAt" as UK);
    this.LastEventOccurredAtKey = LastEventOccurredAtKey ?? ("LastEventOccurredAt" as LEOAK);
  }

  /**
   * Array of Zod event schemas this projection handles.
   * Handler names and event type strings are derived automatically.
   */
  protected abstract readonly events: Schemas;

  /**
   * Return the initial state WITHOUT timestamp fields.
   * Timestamps are auto-managed — the return type forbids them.
   */
  protected abstract initState(): Omit<State, AllTimestampKeys>;

  /** Optional custom key extractor for cross-cutting projections. */
  key?: (event: { type: string }) => string;

  /** Optional processing behavior configuration. */
  options?: FoldProjectionOptions;

  /**
   * Loads all events for an aggregate, sorted by occurredAt ASC.
   * When provided, the executor re-folds from scratch if an out-of-order event is detected.
   */
  eventLoader?: (context: {
    tenantId: string;
    aggregateId: string;
    /** occurredAt (ms) of the event that triggered the re-fold, used to
     * lower-bound the event_log rehydration scan for time-local aggregates. */
    occurredAtMs?: number;
  }) => Promise<Event[]>;

  /**
   * Loads the aggregate's events up to AND INCLUDING `upToEvent` in log
   * order, sorted by occurredAt ASC. Used by the executor for
   * `options.refoldOnStoreMiss`. Auto-wired by EventSourcingService.
   */
  eventLoaderUpTo?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => Promise<Event[]>;

  /** Lazily-built dispatch map: event type string → handler method name. */
  private _dispatchMap?: Record<string, string>;

  private get dispatchMap(): Record<string, string> {
    if (!this._dispatchMap) {
      this._dispatchMap = {};
      for (const schema of this.events) {
        const eventType = schema.shape.type.value;
        const handlerName = eventTypeToHandlerName(eventType);

        if (typeof this[handlerName as keyof this] !== "function") {
          throw new Error(
            `${this.name}: event "${eventType}" requires method ${handlerName}() but it does not exist`,
          );
        }

        this._dispatchMap[eventType] = handlerName;
      }
    }
    return this._dispatchMap;
  }

  /**
   * Event types this projection reacts to — derived from schemas.
   */
  get eventTypes(): readonly string[] {
    return this.events.map((s) => s.shape.type.value);
  }

  /**
   * Returns initial state with auto-managed timestamps.
   * Do NOT override — implement `initState()` instead.
   */
  init(): State {
    const now = nowInstant().epochMilliseconds;
    return {
      ...this.initState(),
      [this.createdAtKey]: now,
      [this.updatedAtKey]: now,
      [this.LastEventOccurredAtKey]: 0,
    } as State;
  }

  /**
   * Dispatches the event to the appropriate typed handler method and
   * auto-sets a monotonic updatedAt (`Math.max(Date.now(), previous + 1)`),
   * strictly increasing even within the same millisecond.
   */
  apply(state: State, event: { type: string }): State {
    const handlerName = this.dispatchMap[event.type];
    if (!handlerName) return state;

    const handler = this[handlerName as keyof this] as (e: { type: string }, s: State) => State;
    const newState = handler.call(this, event, state);
    const prevUpdatedAt: number = state[this.updatedAtKey];
    const nextUpdatedAt = Math.max(nowInstant().epochMilliseconds, prevUpdatedAt + 1);
    const eventOccurredAt = (event as Record<string, unknown>).occurredAt;
    const prevLastOccurred: number = state[this.LastEventOccurredAtKey];
    const nextLastOccurred =
      typeof eventOccurredAt === "number"
        ? Math.max(prevLastOccurred, eventOccurredAt)
        : prevLastOccurred;
    return {
      ...newState,
      [this.updatedAtKey]: nextUpdatedAt,
      [this.LastEventOccurredAtKey]: nextLastOccurred,
    } as State;
  }
}
