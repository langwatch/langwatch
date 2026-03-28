import { z } from "zod";
import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./foldProjection.types";

// ---------------------------------------------------------------------------
// Type-level string transforms
// ---------------------------------------------------------------------------

/** Strip `lw.obs.` or `lw.` prefix from an event type string. */
type StripPrefix<S extends string> = S extends `lw.obs.${infer R}`
  ? R
  : S extends `lw.${infer R}`
    ? R
    : S;

/** `"foo_bar"` → `"FooBar"` */
type SnakeToPascal<S extends string> = S extends `${infer H}_${infer T}`
  ? `${Capitalize<H>}${SnakeToPascal<T>}`
  : Capitalize<S>;

/** `"suite_run.item_started"` → `"SuiteRunItemStarted"` */
type DotSnakeToPascal<S extends string> = S extends `${infer H}.${infer T}`
  ? `${SnakeToPascal<H>}${DotSnakeToPascal<T>}`
  : SnakeToPascal<S>;

/** Full derivation: `"lw.suite_run.started"` → `"handleSuiteRunStarted"` */
type HandlerName<EventTypeStr extends string> =
  `handle${DotSnakeToPascal<StripPrefix<EventTypeStr>>}`;

// ---------------------------------------------------------------------------
// Schema → event type extraction
// ---------------------------------------------------------------------------

/** Zod schema for an event with a literal `type` field. */
export type AnyEventSchema = z.ZodObject<
  { type: z.ZodLiteral<string> } & z.ZodRawShape
>;

/** Extract the literal event type string from a Zod schema's output type. */
type EventTypeOf<S> = S extends z.ZodType<
  { type: infer T extends string },
  any,
  any
>
  ? T
  : never;

// ---------------------------------------------------------------------------
// Schema tuple → handler interface
// ---------------------------------------------------------------------------

/** All possible timestamp keys. Forbidden in `initState()` return type. */
type AllTimestampKeys = "CreatedAt" | "UpdatedAt" | "createdAt" | "updatedAt";

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Derives required handler methods from an array of Zod event schemas.
 *
 * Given schemas for events with types `"lw.suite_run.started"` and
 * `"lw.suite_run.item_completed"`, produces:
 * ```
 * {
 *   handleSuiteRunStarted(event: SuiteRunStartedEvent, state: State): State;
 *   handleSuiteRunItemCompleted(event: SuiteRunItemCompletedEvent, state: State): State;
 * }
 * ```
 */
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
// Runtime string transform (mirrors the type-level transform)
// ---------------------------------------------------------------------------

function eventTypeToHandlerName(eventType: string): string {
  const stripped = eventType.startsWith("lw.obs.")
    ? eventType.slice(7)
    : eventType.startsWith("lw.")
      ? eventType.slice(3)
      : eventType;

  const pascal = stripped
    .split(".")
    .map((segment) =>
      segment
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(""),
    )
    .join("");

  return `handle${pascal}`;
}

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for type-safe fold projections.
 *
 * Structurally satisfies `FoldProjectionDefinition` so instances can be passed
 * directly to `.withFoldProjection()` without any adapter.
 *
 * **Usage:**
 * ```typescript
 * const myEvents = [FooEventSchema, BarEventSchema] as const;
 *
 * class MyProjection
 *   extends AbstractFoldProjection<MyState, typeof myEvents>
 *   implements FoldEventHandlers<typeof myEvents, MyState>
 * {
 *   protected readonly events = myEvents;
 *   protected initState() { return { ... }; }
 *
 *   // Handler names derived from event type strings — miss one → compile error
 *   handleFoo(event: FooEvent, state: MyState): MyState { ... }
 *   handleBar(event: BarEvent, state: MyState): MyState { ... }
 * }
 * ```
 *
 * **Timestamp management:**
 * - `initState()` returns state WITHOUT timestamp fields (type-enforced)
 * - `init()` adds timestamps automatically
 * - `apply()` auto-sets monotonic updatedAt: `Math.max(Date.now(), prev + 1)`
 *
 * For camelCase timestamps, pass `'createdAt'` and `'updatedAt'` as CK/UK.
 */
export abstract class AbstractFoldProjection<
  State extends Record<CK | UK, number>,
  Schemas extends readonly AnyEventSchema[],
  CK extends string = "CreatedAt",
  UK extends string = "UpdatedAt",
> {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly store: FoldProjectionStore<State>;

  protected readonly createdAtKey: CK;
  protected readonly updatedAtKey: UK;

  constructor({
    createdAtKey,
    updatedAtKey,
  }: { createdAtKey?: CK; updatedAtKey?: UK } = {}) {
    this.createdAtKey = createdAtKey ?? ("CreatedAt" as CK);
    this.updatedAtKey = updatedAtKey ?? ("UpdatedAt" as UK);
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

  /** Lazily-built dispatch map: event type string → handler method name. */
  private _dispatchMap?: Record<string, string>;

  private get dispatchMap(): Record<string, string> {
    if (!this._dispatchMap) {
      this._dispatchMap = {};
      for (const schema of this.events) {
        const eventType = schema.shape.type.value;
        this._dispatchMap[eventType] = eventTypeToHandlerName(eventType);
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
    const now = Date.now();
    return {
      ...this.initState(),
      [this.createdAtKey]: now,
      [this.updatedAtKey]: now,
    } as State;
  }

  /**
   * Dispatches the event to the appropriate typed handler method and
   * auto-sets a monotonic updatedAt on the resulting state.
   *
   * Monotonic: `Math.max(Date.now(), previous + 1)` ensures strictly
   * increasing values even when events process within the same millisecond.
   */
  apply(state: State, event: { type: string }): State {
    const handlerName = this.dispatchMap[event.type];
    if (!handlerName) return state;

    const handler = this[handlerName as keyof this] as (
      e: { type: string },
      s: State,
    ) => State;
    const newState = handler.call(this, event, state);
    const prevUpdatedAt: number = state[this.updatedAtKey];
    const nextUpdatedAt = Math.max(Date.now(), prevUpdatedAt + 1);
    return { ...newState, [this.updatedAtKey]: nextUpdatedAt } as State;
  }
}
