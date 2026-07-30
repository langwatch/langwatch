import type { z } from "zod";
import type { Aggregate, EventUnion } from "../aggregate/aggregate.types";

/**
 * The type machinery behind one process-manager declaration (ADR-098
 * decision 1, ADR-105 amendment: "a process manager is one declaration
 * too").
 *
 * A process manager is durable, at-least-once, and its one pure step is
 * `evolve(previousState, input) -> { state, nextWakeAt, intents }`
 * (ADR-098). Everything nameable about it is derived the same way an
 * aggregate's is: the intent type string, the intent payload type, the
 * intent union, the list the outbox ratchet snapshots, and the typed intent
 * creators. A prior implementation hand-maintained an intent-type map next
 * to its intents map —
 *
 * ```ts
 * export const TRIGGER_SETTLEMENT_INTENT_TYPES = {
 *   NOTIFY_DIGEST: "notifyDigest", PERSIST_MATCH: "persistMatch", ...
 * } as const satisfies { readonly [K in keyof Intents]: K };
 * ```
 *
 * — which is exactly the "declared string, and a second structure asserting
 * it agrees" shape ADR-105 exists to remove. There is only one map here;
 * its keys are the types.
 */

/**
 * The persisted discriminator for one intent, derived from the process name
 * and the map key — the same `${Name}/${Key}` shape `EventTypeString`
 * uses, for the same reason. An intent type is written into
 * `ProcessManagerOutbox` and read back until the message dispatches, so —
 * like an event type, and unlike a Redux action name — renaming the map key
 * orphans a row a dispatcher can no longer route to a handler.
 *
 * Qualifying it by process name also closes a real collision: the outbox
 * table is shared across every process manager (a dispatcher scopes its
 * lease to a set of `processNames` for exactly this reason), so two
 * processes each naming an intent, say, `"notify"`, would otherwise mint the
 * identical bare `intentType` string into a table one dispatcher's handler
 * map indexes by type alone.
 */
export type IntentTypeString<
  Name extends string,
  Key extends string,
> = `${Name}/${Key}`;

/**
 * One intent: the shape of its payload, and the natural key its dispatch
 * dedupes on.
 *
 * `messageKey` receives ONLY the payload — deliberately. The runtime this
 * replaces hand-typed a key string at every call site, and two shapes of bug
 * came out of that: a key minted from `ctx.now`/`ctx.at` (the wall clock),
 * which changes on every retry of the *same* intent and so never collapses a
 * redelivery; and a key minted from a value the process computed in its own
 * state but never placed in the payload — the evidence this replaces keyed
 * `persistMatch` as `` `persist:${traceId}:${match.settleWindowBucket}` ``
 * while `persistMatchIntentSchema` declared only `{ triggerId, traceId }`,
 * so two evolutions that were the same logical intent computed different
 * keys and both dispatched. Typing `messageKey` as a pure function of
 * `z.infer<Payload>` makes both mistakes fail to typecheck: the only data
 * the function can reach is the data that will be compared for equality on
 * the next delivery of the same logical intent, so "derived from something
 * outside the payload" stops being an expressible shape at all.
 */
export interface IntentDef<Payload extends z.ZodTypeAny> {
  readonly payload: Payload;
  readonly messageKey: (payload: z.infer<Payload>) => string;
}

/** The declared intents of one process, keyed by their unqualified name. */
export type IntentMap = Record<string, IntentDef<z.ZodTypeAny>>;

/** The payload type of one declared intent. */
export type IntentData<
  Intents extends IntentMap,
  Key extends keyof Intents,
> = z.infer<Intents[Key]["payload"]>;

/** One intent instance, as it is handed to the outbox. */
export interface ProcessIntent<
  Type extends string = string,
  Payload = unknown,
> {
  readonly intentType: Type;
  readonly messageKey: string;
  readonly payload: Payload;
}

/**
 * The discriminated union of every intent a process can produce. Built the
 * same way `EventUnion` is — an object type keyed like the intent map, then
 * indexed by its own `keyof` — for the same reason: indexing is what turns a
 * map of members into a union of them rather than an intersection.
 */
export type IntentUnion<Name extends string, Intents extends IntentMap> = {
  [Key in keyof Intents & string]: ProcessIntent<
    IntentTypeString<Name, Key>,
    IntentData<Intents, Key>
  >;
}[keyof Intents & string];

/**
 * Typed constructors, one per declared intent. A creator computes
 * `messageKey` from the declared function, so no call site derives a key by
 * hand — the shape of bug `IntentDef`'s docblock describes cannot be
 * reintroduced at a call site once the creator is the only way to build one.
 */
export type IntentCreators<Name extends string, Intents extends IntentMap> = {
  readonly [Key in keyof Intents & string]: (
    payload: IntentData<Intents, Key>,
  ) => ProcessIntent<IntentTypeString<Name, Key>, IntentData<Intents, Key>>;
};

/**
 * Extracts the event union an aggregate declaration produces, so `.on()` can
 * type a process's incoming events against it without a second, hand-written
 * union. `A` is expected to be exactly what `defineAggregate(...).build()`
 * returns; the conditional recovers the type parameters `Aggregate` keeps
 * behind `EventTypeString`/`EventCreators` at its own call sites.
 */
export type EventUnionOf<A> =
  A extends Aggregate<
    infer Name,
    infer State,
    infer Events,
    // The built aggregate's `Commands` carries no information this needs, and
    // pinning it here would force every caller to restate it.
    any
  >
    ? EventUnion<Name, State, Events>
    : never;

/**
 * What every process handler receives besides its own state and intents.
 *
 * `at`/`now` mirror ADR-098's own vocabulary: `at` is the instant the input
 * refers to (an event's `occurredAt`, or the wake's scheduled instant), and
 * `now` is wall-clock at the moment this input is actually being handled.
 * They diverge whenever the fleet was down or a subscriber backed up, and
 * every real deadline in the evidence this shape replaces — a trigger's
 * settlement window, an experiment run's progress deadline — schedules from
 * `Math.max(ctx.at, ctx.now)`, never from `at` alone, or a lagged input
 * writes a wake that is already in the past. Handing both in as data keeps
 * `evolve` pure while still letting it clamp.
 */
export interface ProcessContext {
  readonly at: number;
  readonly now: number;
  readonly tenantId: string;
  readonly processKey: string;
}

/**
 * The result of one evolve-driven step (an event, or a due wake).
 * `nextWakeAt` is REQUIRED: this process kind computes its own deadline on
 * every step, so `null` (clear whatever was armed) and a number (replace it)
 * are the only two legal answers, and "leave it as it was" is spelled by
 * returning the same number back — never by omitting the field.
 */
export interface EvolveStep<
  State,
  Name extends string,
  Intents extends IntentMap,
> {
  readonly state: State;
  readonly intents: readonly IntentUnion<Name, Intents>[];
  readonly nextWakeAt: number | null;
}

/**
 * The result of one fixed-interval wake. There is no `nextWakeAt` field at
 * all — not an optional one defaulting to "keep the schedule" — because this
 * process kind has no other cadence to fall back on or replace: the runtime
 * re-arms the wake from `everyMs` after every firing, and a step of this kind
 * cannot express "wake sooner" or "never again" without becoming the other
 * kind. This is the discriminated variant ADR-105's amendment replaces a
 * `nextWakeAt` declared twice with — one required, one optional and
 * differently documented — on the same interface.
 */
export interface ScheduleStep<
  State,
  Name extends string,
  Intents extends IntentMap,
> {
  readonly state: State;
  readonly intents: readonly IntentUnion<Name, Intents>[];
}

export type EvolveFn<
  State,
  Events,
  Name extends string,
  Intents extends IntentMap,
> = (
  state: State,
  event: Events,
  intents: IntentCreators<Name, Intents>,
  ctx: ProcessContext,
) => EvolveStep<State, Name, Intents>;

export type EvolveWakeFn<
  State,
  Name extends string,
  Intents extends IntentMap,
> = (
  state: State,
  intents: IntentCreators<Name, Intents>,
  ctx: ProcessContext,
) => EvolveStep<State, Name, Intents>;

export type ScheduleWakeFn<
  State,
  Name extends string,
  Intents extends IntentMap,
> = (
  state: State,
  intents: IntentCreators<Name, Intents>,
  ctx: ProcessContext,
) => ScheduleStep<State, Name, Intents>;

/** What every built process exposes, regardless of its wake kind. */
export interface ProcessBase<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  readonly name: Name;
  /**
   * Every declared intent type string, for the ratchet snapshot.
   * `../aggregate/ratchet` (`checkTypeStringRatchet`, `mergeSnapshot`) is
   * reused as-is rather than duplicated: an intent type is persisted onto
   * `ProcessManagerOutbox` rows exactly the way an event type is persisted
   * onto `event_log`, so the same shrink-only comparison — keyed by this
   * process's `name` instead of an aggregate's — applies unchanged.
   */
  readonly intentTypes: readonly IntentTypeString<
    Name,
    keyof Intents & string
  >[];
  readonly intents: IntentCreators<Name, Intents>;
  /**
   * The declared state schema, kept rather than discarded after it fixes
   * `State`. A process's persisted row needs the same decode-or-reject
   * discipline ADR-098 decision 6 gives a fold — a store built against this
   * process can validate a read-back row without a second, hand-maintained
   * copy of the shape.
   */
  readonly stateSchema: z.ZodType<State>;
  init(): State;
}

/**
 * A process driven by its aggregate's events, computing its own wake on
 * every step (see `EvolveStep`).
 */
export interface EvolveDrivenProcess<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events,
> extends ProcessBase<Name, State, Intents> {
  readonly kind: "evolve";
  /** The subscribed event types, derived from the aggregate passed to `.on()`. */
  readonly eventTypes: readonly string[];
  readonly evolve: EvolveFn<State, Events, Name, Intents>;
  readonly onWake?: EvolveWakeFn<State, Name, Intents>;
}

/**
 * A process driven purely by a fixed-interval wake — no event subscription
 * at all. The evidence this replaces has exactly this shape twice over
 * (a periodic alert sweep, a periodic delivery-log prune): both declare a
 * state, an interval, and a wake handler, and neither declares `.on()`.
 */
export interface ScheduledProcess<
  Name extends string,
  State,
  Intents extends IntentMap,
> extends ProcessBase<Name, State, Intents> {
  readonly kind: "schedule";
  readonly everyMs: number;
  readonly onWake: ScheduleWakeFn<State, Name, Intents>;
}

/**
 * A built process manager: exactly one of the two kinds ADR-098 decision 1
 * and this amendment describe. `kind` is the discriminant a runtime executor
 * switches on; there is deliberately no third, "has both" shape — a process
 * that needs both an event-driven deadline and a fixed sweep is two
 * declarations, not one, the same way the evidence this replaces keeps a
 * settlement process and a prune process separate rather than merging them.
 */
export type Process<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events,
> =
  | EvolveDrivenProcess<Name, State, Intents, Events>
  | ScheduledProcess<Name, State, Intents>;
