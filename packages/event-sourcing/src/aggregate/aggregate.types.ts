import type { z } from "zod";

/**
 * The type machinery behind one aggregate declaration (ADR-105).
 *
 * An event is declared once — a payload schema and the function that applies it
 * — and everything nameable is derived from that: the event type string, the
 * payload type, the event union, the list the router dispatches on, and the
 * typed creators. Today the same event is declared in four places that can
 * disagree, and roughly 3,838 lines across 11 schema directories are mostly
 * that ceremony.
 *
 * Three constructs carry the derivation, and the constraint on all of them is
 * that they stay shallow. A full typecheck of the application is already
 * expensive enough that engineers avoid running it, so every type below is
 * linear in the number of events. Nothing here recurses over string literals.
 */

/**
 * The persisted discriminator, derived from the aggregate name and the map key.
 *
 * This is a template literal type rather than a runtime string alone, so
 * `event.type` narrows and completes at a call site. It is also the value that
 * outlives every deploy: it is written into the event log, so the ratchet in
 * `ratchet.ts` guards renames — additions are free, disappearances are not.
 */
export type EventTypeString<
  Name extends string,
  Key extends string,
> = `${Name}/${Key}`;

/**
 * One event: the shape of its payload, and how it moves the state.
 *
 * `apply` is declared next to the schema it consumes, which is why a fold never
 * needs a discriminated switch and never needs narrowing. That, rather than the
 * syntax, is what makes this shape readable.
 *
 * It returns new state. There is no Immer and no proxy: fold states here are
 * large and sit on a hot path, so mutative-looking syntax would be bought at a
 * cost paid per event.
 */
export interface EventDef<State, Data extends z.ZodTypeAny> {
  readonly data: Data;
  readonly apply: (state: State, data: z.infer<Data>) => State;
}

/** The declared events of one aggregate, keyed by their unqualified name. */
export type EventMap<State> = Record<string, EventDef<State, z.ZodTypeAny>>;

/** The payload type of one declared event. */
export type EventData<
  State,
  Events extends EventMap<State>,
  Key extends keyof Events,
> = z.infer<Events[Key]["data"]>;

/** A single event instance, as it travels and as it is stored. */
export interface AggregateEvent<
  Type extends string = string,
  Data = unknown,
> {
  readonly type: Type;
  readonly data: Data;
}

/**
 * The discriminated union of every event an aggregate can produce.
 *
 * Built by constructing an object type keyed the same way as the event map and
 * then indexing it by its own `keyof`. Indexing is what turns a map of members
 * into a union of them rather than an intersection — without it the result is a
 * type no event can satisfy.
 */
export type EventUnion<
  Name extends string,
  State,
  Events extends EventMap<State>,
> = {
  [Key in keyof Events & string]: AggregateEvent<
    EventTypeString<Name, Key>,
    EventData<State, Events, Key>
  >;
}[keyof Events & string];

/**
 * Typed constructors, one per declared event.
 *
 * A creator exists so no call site writes the type string by hand. A hand-typed
 * string is a string that can be misspelled into an event nothing routes and
 * nothing rejects.
 */
export type EventCreators<
  Name extends string,
  State,
  Events extends EventMap<State>,
> = {
  readonly [Key in keyof Events & string]: (
    data: EventData<State, Events, Key>,
  ) => AggregateEvent<
    EventTypeString<Name, Key>,
    EventData<State, Events, Key>
  >;
};

/**
 * One command: the shape of its input, and the events it decides to emit.
 *
 * The handler receives the creators, so it names events by key rather than by
 * string, and it receives the current state so it can refuse. Its only output
 * is events — a command never writes.
 */
export interface CommandDef<
  Name extends string,
  State,
  Events extends EventMap<State>,
  Input extends z.ZodTypeAny,
> {
  readonly input: Input;
  readonly handle: (
    state: State,
    input: z.infer<Input>,
    events: EventCreators<Name, State, Events>,
  ) => readonly EventUnion<Name, State, Events>[];
}

export type CommandMap<
  Name extends string,
  State,
  Events extends EventMap<State>,
> = Record<string, CommandDef<Name, State, Events, z.ZodTypeAny>>;

/**
 * A built aggregate: everything the runtime needs, all of it derived.
 *
 * `apply` dispatches on the event's type. It is total over the declared events
 * and deliberately tolerant of anything else — an unknown type is returned
 * unchanged rather than throwing, because an aggregate that gains an event in a
 * later deploy must not break the older workers still draining the queue.
 */
export interface Aggregate<
  Name extends string,
  State,
  Events extends EventMap<State> = EventMap<State>,
  Commands extends CommandMap<Name, State, Events> = CommandMap<
    Name,
    State,
    Events
  >,
> {
  readonly name: Name;
  /** Every declared type string, for the router to dispatch on. */
  readonly eventTypes: readonly EventTypeString<Name, keyof Events & string>[];
  /** The shape identity of `State`, derived unless explicitly pinned. */
  readonly stateVersion: string;
  /** The computed shape hash, reported even when the version is pinned. */
  readonly schemaHash: string;
  readonly events: EventCreators<Name, State, Events>;
  readonly commands: Commands;
  init(): State;
  apply(state: State, event: AggregateEvent): State;
}
