import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./foldProjection.types";

/**
 * Minimal event shape needed for dispatch — just the type discriminant.
 */
export type DispatchableEvent = { type: string };

/**
 * All possible timestamp keys (both PascalCase and camelCase).
 * Used by `initState()` to forbid timestamp fields in the return type.
 */
type AllTimestampKeys = "CreatedAt" | "UpdatedAt" | "createdAt" | "updatedAt";

/**
 * Mapped type that derives required handler methods from an event map.
 *
 * Given `{ SuiteRunStarted: SuiteRunStartedEvent }`, produces:
 * `{ handleSuiteRunStarted(event: SuiteRunStartedEvent, state: State): State }`
 *
 * Used with `implements` on concrete classes to get compile-time enforcement
 * that every registered event has a corresponding handler method.
 */
export type FoldEventHandlers<
  EventMap extends Record<string, DispatchableEvent>,
  State,
> = {
  [K in keyof EventMap as `handle${K & string}`]: (
    event: EventMap[K],
    state: State,
  ) => State;
};

/**
 * Abstract base class for type-safe fold projections.
 *
 * Structurally satisfies `FoldProjectionDefinition` so instances can be passed
 * directly to `.withFoldProjection()` without any adapter.
 *
 * **Type parameters:**
 * - `State` — The fold state type. Must have timestamp fields matching CK/UK.
 * - `EventMap` — Maps handler name suffixes to event types.
 * - `CK` — The createdAt field name (default: `'CreatedAt'`).
 * - `UK` — The updatedAt field name (default: `'UpdatedAt'`).
 *
 * **Timestamp management:**
 * - `initState()` returns state WITHOUT timestamp fields (type-enforced via Omit)
 * - `init()` adds timestamps automatically
 * - `apply()` auto-sets monotonic updatedAt after every handler:
 *   `Math.max(Date.now(), previous + 1)` to avoid non-deterministic
 *   ReplacingMergeTree deduplication in ClickHouse.
 *
 * For camelCase timestamps, pass `'createdAt'` and `'updatedAt'` as CK/UK.
 *
 * @example
 * ```typescript
 * // PascalCase (default):
 * class MyProjection extends AbstractFoldProjection<MyState, MyEventMap> { ... }
 *
 * // camelCase:
 * class MyProjection extends AbstractFoldProjection<MyState, MyEventMap, 'createdAt', 'updatedAt'> {
 *   constructor(deps) { super({ createdAtKey: 'createdAt', updatedAtKey: 'updatedAt' }); }
 * }
 * ```
 */
export abstract class AbstractFoldProjection<
  State extends Record<CK | UK, number>,
  EventMap extends Record<string, DispatchableEvent>,
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
   * Maps runtime `event.type` strings to handler method names on this class.
   *
   * Values must be both:
   * 1. A valid handler name from EventMap (`handle${keyof EventMap}`)
   * 2. An actual key on the concrete class (`keyof this`)
   *
   * This means a typo or missing handler method fails at compile time.
   */
  protected abstract readonly eventTypeMap: Record<
    string,
    `handle${Extract<keyof EventMap, string>}` & keyof this
  >;

  /**
   * Return the initial state WITHOUT timestamp fields.
   * Timestamps are auto-managed — the return type forbids them.
   */
  protected abstract initState(): Omit<State, AllTimestampKeys>;

  /** Optional custom key extractor for cross-cutting projections. */
  key?: (event: EventMap[keyof EventMap]) => string;

  /** Optional processing behavior configuration. */
  options?: FoldProjectionOptions;

  /**
   * Event types this projection reacts to — derived from eventTypeMap keys.
   * Always in sync with the handler map.
   */
  get eventTypes(): readonly string[] {
    return Object.keys(this.eventTypeMap);
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
  apply(state: State, event: EventMap[keyof EventMap]): State {
    const handlerName = this.eventTypeMap[event.type];
    if (!handlerName) return state;

    // handlerName is keyof this (enforced by the eventTypeMap type),
    // so the method is guaranteed to exist at compile time.
    const handler = this[handlerName] as (
      e: EventMap[keyof EventMap],
      s: State,
    ) => State;
    const newState = handler.call(this, event, state);
    const nextUpdatedAt = Math.max(Date.now(), state[this.updatedAtKey] + 1);
    return { ...newState, [this.updatedAtKey]: nextUpdatedAt } as State;
  }
}
