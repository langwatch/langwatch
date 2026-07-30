import type { z } from "zod";

/**
 * One declaration per process manager, curried like `defineAggregate`
 * (ADR-105) — and for the identical reason: `State` has to be fixed before
 * `Intents`' payload types can be checked, and `Intents` has to be fixed
 * before an `.events()`/`.onWake()` body can see `ctx.intents` typed. One
 * object literal cannot infer itself; each step here already knows
 * everything the previous step established.
 *
 * `@langwatch/event-sourcing` does not export a process-manager runtime yet
 * (ADR-102 decision 1 names one as belonging in the package; nothing under
 * `packages/event-sourcing/src/process-manager/` exists to import). This
 * builder is the local stand-in for the DECLARATION half of that gap — the
 * same role `defineAggregate` plays for aggregates — not for the executor
 * half (scheduling, leasing, retrying). A definition built here is a plain,
 * pure, fully-testable object; nothing about running it at-least-once lives
 * in this file, because that is the executor's job and this pipeline does
 * not have one to build against yet.
 *
 * TODO: move to `@langwatch/event-sourcing` as `defineProcess` once that
 * lands (a package-level `defineProcess` is being built in parallel, shaped
 * like `defineAggregate` — this file's `defineProcessManager`, `Intent`,
 * `IntentMap`, `IntentCreators`, `StepContext`, `StepResult`,
 * `ProcessManagerDefinition` are the same declaration this pipeline should
 * import instead once it ships). Every other file in `process-managers/`
 * imports its framework types from HERE and only here — no process below
 * re-declares `StepResult`, a wake contract, or an intent envelope of its
 * own, so migrating onto the package version is a change to this file's
 * imports, not to every process manager individually.
 *
 * Everything nameable is derived from ONE map per axis, exactly as
 * `defineAggregate` derives an aggregate's event union from one `events`
 * map: `.intents({ notifyDigest: schema, ... })` is both the runtime
 * payload validator AND the source of the typed intent constructors —
 * there is no second, hand-maintained list of intent-type strings to keep
 * in sync with it.
 */

export interface Intent<Payload = unknown> {
  readonly messageKey: string;
  readonly intentType: string;
  readonly payload: Payload;
}

export type IntentMap = Record<string, z.ZodTypeAny>;

/** Typed intent constructors, one per declared intent — derived from
 *  `IntentMap`, never authored separately. */
export type IntentCreators<Intents extends IntentMap> = {
  readonly [Key in keyof Intents & string]: (
    messageKey: string,
    payload: z.infer<Intents[Key]>,
  ) => Intent<z.infer<Intents[Key]>>;
};

/** The discriminated union of every intent a process can emit — built the
 *  same way `EventUnion` is (ADR-105): index an object type keyed like the
 *  map by its own `keyof` to get a union instead of an intersection. */
export type IntentUnion<Intents extends IntentMap> = {
  [Key in keyof Intents & string]: Intent<z.infer<Intents[Key]>>;
}[keyof Intents & string];

/** What a caller supplies per step; `intents` is attached by the built
 *  definition itself (see `evolve`/`onWake` below), so neither a handler
 *  body nor a test constructs intent factories by hand. */
export interface CallContext {
  readonly key: string;
  readonly tenantId: string;
  /** The triggering event's own `occurredAt` for `evolve`; the scheduled
   *  wake instant for `onWake`. Never wall-clock — see `now`. */
  readonly at: number;
  /**
   * Wall-clock at the moment this step actually runs. A durable process may
   * run a step long after `at`, on a backlog; scheduling the next boundary
   * from `max(at, now)` rather than `at` alone is what stops a delivery
   * that arrives late from computing a boundary already in the past
   * (ADR-098 decision 4: ordering, and therefore timing, is best effort).
   */
  readonly now: number;
}

export interface StepContext<Intents extends IntentMap> extends CallContext {
  readonly intents: IntentCreators<Intents>;
}

export interface StepResult<State, Intents extends IntentMap> {
  readonly state: State;
  readonly intents?: readonly IntentUnion<Intents>[];
  /**
   * The next wall-clock instant this process must run even with no new
   * event, or `null` if nothing is pending. Durable by construction: the
   * wake is derived from committed state on the next read, never scheduled
   * as a side effect a crash between commits could lose.
   *
   * Omitted entirely for a schedule-only process — its next wake is the
   * fixed `Schedule` interval, not a value a step computes.
   */
  readonly nextWakeAt?: number | null;
}

export type EventStep<State, Data, Intents extends IntentMap> = (
  state: State,
  data: Data,
  ctx: StepContext<Intents>,
) => StepResult<State, Intents>;

export type WakeStep<State, Intents extends IntentMap> = (
  state: State,
  ctx: StepContext<Intents>,
) => StepResult<State, Intents>;

export interface Schedule {
  readonly everyMs: number;
}

/** A built process manager: everything the (future) executor needs, all of
 *  it derived. `evolve` dispatches on the event's own type key and is
 *  `undefined` for a type this process does not declare, mirroring
 *  `Aggregate.apply`'s tolerance of an unrecognised event — a process must
 *  not fail just because a pipeline sharing its event log gained a new
 *  event type. */
export interface ProcessManagerDefinition<
  Name extends string,
  State,
  Intents extends IntentMap,
  EventTypes extends string,
> {
  readonly name: Name;
  readonly schedule?: Schedule;
  readonly eventTypes: readonly EventTypes[];
  readonly intentSchemas: Intents;
  readonly intents: IntentCreators<Intents>;
  initialState(): State;
  evolve(
    eventType: string,
    state: State,
    data: unknown,
    ctx: CallContext,
  ): StepResult<State, Intents> | undefined;
  onWake?(state: State, ctx: CallContext): StepResult<State, Intents>;
}

function buildIntentCreators<Intents extends IntentMap>(
  schemas: Intents,
): IntentCreators<Intents> {
  const entries = Object.keys(schemas).map((key) => [
    key,
    (messageKey: string, payload: unknown) => ({
      messageKey,
      intentType: key,
      payload,
    }),
  ]);
  return Object.fromEntries(entries) as IntentCreators<Intents>;
}

export function defineProcessManager<const Name extends string>(
  name: Name,
): ProcessManagerNamed<Name> {
  return {
    state<State>(schema: z.ZodType<State>, init: () => State) {
      return makeStated<Name, State>(name, init);
    },
  };
}

export interface ProcessManagerNamed<Name extends string> {
  state<State>(
    schema: z.ZodType<State>,
    init: () => State,
  ): ProcessManagerStated<Name, State>;
}

export interface ProcessManagerStated<Name extends string, State> {
  intents<const Intents extends IntentMap>(
    schemas: Intents,
  ): ProcessManagerIntented<Name, State, Intents>;
}

export interface ProcessManagerIntented<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  /** A per-aggregate process: declares the events it reacts to, each
   *  handler typed against the event's own data (inferred from the handler
   *  literal, the same trick `defineAggregate`'s `.commands()` uses). */
  events<const Events extends Record<string, EventStep<State, never, Intents>>>(
    events: Events,
  ): ProcessManagerEvented<Name, State, Intents, Events>;
  /** A schedule-only, singleton process: no events, just a fixed wake
   *  interval (`graphAlertSweep`, `webhookDeliveryPrune`). */
  schedule(schedule: Schedule): ProcessManagerScheduled<Name, State, Intents>;
}

export interface ProcessManagerEvented<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events extends Record<string, EventStep<State, never, Intents>>,
> {
  onWake(
    onWake: WakeStep<State, Intents>,
  ): ProcessManagerDefinition<Name, State, Intents, keyof Events & string>;
  /** Valid for a per-aggregate process with no wake of its own — every
   *  pending intent is emitted directly from `evolve`. */
  build(): ProcessManagerDefinition<Name, State, Intents, keyof Events & string>;
}

export interface ProcessManagerScheduled<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  onWake(
    onWake: WakeStep<State, Intents>,
  ): ProcessManagerDefinition<Name, State, Intents, never>;
}

function makeStated<Name extends string, State>(
  name: Name,
  init: () => State,
): ProcessManagerStated<Name, State> {
  return {
    intents<const Intents extends IntentMap>(schemas: Intents) {
      const intents = buildIntentCreators(schemas);

      const withIntents = (ctx: CallContext): StepContext<Intents> => ({
        ...ctx,
        intents,
      });

      return {
        events<const Events extends Record<string, EventStep<State, never, Intents>>>(
          events: Events,
        ) {
          const eventTypes = Object.keys(events) as (keyof Events & string)[];
          const build = (
            onWake?: WakeStep<State, Intents>,
          ): ProcessManagerDefinition<Name, State, Intents, keyof Events & string> => ({
            name,
            eventTypes,
            intentSchemas: schemas,
            intents,
            initialState: init,
            evolve: (eventType, state, data, ctx) => {
              const handler = events[eventType];
              return handler
                ? handler(state, data as never, withIntents(ctx))
                : undefined;
            },
            onWake: onWake
              ? (state, ctx) => onWake(state, withIntents(ctx))
              : undefined,
          });
          return {
            onWake: (onWake: WakeStep<State, Intents>) => build(onWake),
            build: () => build(undefined),
          };
        },
        schedule(schedule: Schedule) {
          return {
            onWake: (
              onWake: WakeStep<State, Intents>,
            ): ProcessManagerDefinition<Name, State, Intents, never> => ({
              name,
              schedule,
              eventTypes: [],
              intentSchemas: schemas,
              intents,
              initialState: init,
              evolve: () => undefined,
              onWake: (state, ctx) => onWake(state, withIntents(ctx)),
            }),
          };
        },
      };
    },
  };
}

/**
 * What an intent handler receives once the (not-yet-built) executor
 * dispatches it. `attempt` starts at 1; `messageKey` is the exact
 * deterministic key the intent was minted with, so a handler needing its
 * own idempotency defence beyond the outbox's own can use it directly
 * (ADR-098: dispatched work is keyed on its natural key).
 */
export interface IntentContext {
  readonly processName: string;
  readonly tenantId: string;
  readonly processKey: string;
  readonly messageKey: string;
  readonly attempt: number;
}

export type IntentHandler<Payload> = (
  payload: Payload,
  ctx: IntentContext,
) => Promise<void>;
