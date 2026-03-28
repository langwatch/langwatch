import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./foldProjection.types";

/**
 * Minimal event shape needed for dispatch — just the type discriminant.
 */
export type DispatchableEvent = { type: string };

/**
 * State that includes automatic timestamp management.
 * All fold projection states must extend this to get auto-managed UpdatedAt.
 */
export interface TimestampedState {
  CreatedAt: number;
  UpdatedAt: number;
}

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
 * Subclasses define an `EventMap` (handler name suffix → event type) and
 * use `implements FoldEventHandlers<EventMap, State>` to get compile-time
 * enforcement that every event has a typed handler method.
 *
 * Auto-manages `UpdatedAt` after every event application.
 *
 * @example
 * ```typescript
 * interface MyEventMap {
 *   OrderPlaced: OrderPlacedEvent;
 *   OrderShipped: OrderShippedEvent;
 * }
 *
 * class OrderFoldProjection
 *   extends AbstractFoldProjection<OrderState, MyEventMap>
 *   implements FoldEventHandlers<MyEventMap, OrderState>
 * {
 *   // TypeScript enforces these exist:
 *   handleOrderPlaced(event: OrderPlacedEvent, state: OrderState): OrderState { ... }
 *   handleOrderShipped(event: OrderShippedEvent, state: OrderState): OrderState { ... }
 * }
 * ```
 */
export abstract class AbstractFoldProjection<
  State extends TimestampedState,
  EventMap extends Record<string, DispatchableEvent>,
> {
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly store: FoldProjectionStore<State>;

  /**
   * Maps runtime `event.type` strings to handler method names on this class.
   *
   * Values are constrained to valid handler names derived from EventMap keys.
   *
   * @example
   * ```typescript
   * protected readonly eventTypeMap = {
   *   [EVENT_TYPES.STARTED]: "handleSuiteRunStarted",
   *   [EVENT_TYPES.ITEM_COMPLETED]: "handleSuiteRunItemCompleted",
   * } as const;
   * ```
   */
  protected abstract readonly eventTypeMap: Record<
    string,
    `handle${Extract<keyof EventMap, string>}`
  >;

  abstract init(): State;

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
   * Dispatches the event to the appropriate typed handler method and
   * auto-sets `UpdatedAt` on the resulting state.
   */
  apply(state: State, event: EventMap[keyof EventMap]): State {
    const handlerName = this.eventTypeMap[event.type];
    if (!handlerName) return state;

    const handler = (this as unknown as Record<string, Function>)[
      handlerName
    ] as (event: EventMap[keyof EventMap], state: State) => State;

    const newState = handler.call(this, event, state);
    return { ...newState, UpdatedAt: Date.now() };
  }
}
