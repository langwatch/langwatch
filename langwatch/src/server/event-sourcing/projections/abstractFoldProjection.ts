import { z } from "zod";
import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./foldProjection.types";
import {
  type EventTypeOf,
  type StripPrefix,
  type DotSnakeToPascal,
  type UnionToIntersection,
  eventTypeToHandlerName,
} from "./eventTypeTransforms";

// ---------------------------------------------------------------------------
// Schema → event type extraction
// ---------------------------------------------------------------------------

/** Zod schema for an event with a literal `type` field. */
export type AnyEventSchema = z.ZodObject<
  { type: z.ZodLiteral<string> } & z.ZodRawShape
>;

// ---------------------------------------------------------------------------
// Schema tuple → handler interface
// ---------------------------------------------------------------------------

/** All possible timestamp keys. Forbidden in `initState()` return type. */
type AllTimestampKeys = "CreatedAt" | "UpdatedAt" | "createdAt" | "updatedAt";

/** Full derivation: `"lw.suite_run.started"` → `"handleSuiteRunStarted"` */
type HandlerName<EventTypeStr extends string> =
  `handle${DotSnakeToPascal<StripPrefix<EventTypeStr>>}`;

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
 * - `init()` adds timestamps automatically (PascalCase by default)
 * - `apply()` auto-sets monotonic updatedAt: `Math.max(Date.now(), prev + 1)`
 * - For camelCase: override `timestampStyle` to `"camel"`
 */
export abstract class AbstractFoldProjection<
  State,
  Schemas extends readonly AnyEventSchema[],
> {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly store: FoldProjectionStore<State>;

  /**
   * Timestamp field naming convention. Override to `"camel"` for
   * states with `createdAt`/`updatedAt` instead of `CreatedAt`/`UpdatedAt`.
   * @default `"pascal"`
   */
  protected readonly timestampStyle: "pascal" | "camel" = "pascal";

  private get ck(): string {
    return this.timestampStyle === "camel" ? "createdAt" : "CreatedAt";
  }

  private get uk(): string {
    return this.timestampStyle === "camel" ? "updatedAt" : "UpdatedAt";
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
    const now = Date.now();
    return {
      ...this.initState(),
      [this.ck]: now,
      [this.uk]: now,
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
    const prevUpdatedAt = (state as Record<string, number>)[this.uk] ?? 0;
    const nextUpdatedAt = Math.max(Date.now(), prevUpdatedAt + 1);
    return { ...newState, [this.uk]: nextUpdatedAt } as State;
  }
}
