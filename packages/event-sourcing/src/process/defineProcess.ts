import type { z } from "zod";
import type { Aggregate } from "../aggregate/aggregate.types";
import { ConfigurationError } from "../errors";
import type {
  EventUnionOf,
  EvolveDrivenProcess,
  EvolveFn,
  EvolveWakeFn,
  IntentCreators,
  IntentMap,
  IntentTypeString,
  ScheduledProcess,
  ScheduleWakeFn,
} from "./process.types";

/**
 * One declaration per process manager (ADR-098 decision 1, ADR-105
 * amendment).
 *
 * Curried for the same reason `defineAggregate` is (ADR-105 §7): `State` is
 * inferred from the state schema, `Intents` from the intents map, and the
 * step functions must be checked against both — in one object literal those
 * are mutually dependent, so every handler parameter resolves to `unknown`.
 * Each step here already knows everything the previous step established, so
 * `.evolve()` sees the state type, the aggregate's event union, and the
 * generated intent creators together.
 *
 * ```ts
 * defineProcess("triggerSettlement")
 *   .state(settlementState, () => ({ pendingMatches: {} }))
 *   .intents({
 *     notifyDigest: {
 *       payload: z.object({ triggerId: z.string(), traceIds: z.array(z.string()), boundary: z.number() }),
 *       messageKey: (p) => `digest:${p.boundary}:${[...p.traceIds].sort().join(",")}`,
 *     },
 *   })
 *   .on(trigger)
 *   .evolve((state, event, intents, ctx) => ({ state, intents: [], nextWakeAt: null }))
 *   .onWake((state, intents, ctx) => ({ state, intents: [], nextWakeAt: null }))
 *   .build();
 * ```
 *
 * A fixed-interval process skips `.on()`/`.evolve()` entirely and declares
 * `.schedule({ everyMs })` instead — see `ScheduledProcess`.
 */
export function defineProcess<const Name extends string>(
  name: Name,
): ProcessNamed<Name> {
  if (name.includes("/")) {
    // The separator is structural: an intent's type string is `name/key`,
    // mirroring an aggregate's event type string, so a name containing one
    // would produce a string that cannot be split back into its parts.
    throw new ConfigurationError(`process name must not contain "/"`, {
      name,
    });
  }
  return {
    state<State>(schema: z.ZodType<State>, init: () => State) {
      return makeStated<Name, State>(name, schema, init);
    },
  };
}

export interface ProcessNamed<Name extends string> {
  state<State>(
    schema: z.ZodType<State>,
    init: () => State,
  ): ProcessStated<Name, State>;
}

export interface ProcessStated<Name extends string, State> {
  intents<const Intents extends IntentMap>(
    intents: Intents,
  ): ProcessIntented<Name, State, Intents>;
}

export interface ProcessIntented<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  /**
   * Subscribes to one aggregate's whole event union, typed against exactly
   * what `defineAggregate(...).build()` returned — see `EventUnionOf`. There
   * is no per-event `.ignores()`: `evolve` receives the full union and a
   * no-op branch inside it is the same "nothing to do here" decision, without
   * a second declarative surface to keep in sync with the aggregate.
   */
  on<A extends Aggregate<string, any, any, any>>(
    aggregate: A,
  ): ProcessOnEvents<Name, State, Intents, EventUnionOf<A>>;
  /** No event subscription at all — driven purely by a fixed interval. */
  schedule(options: {
    readonly everyMs: number;
  }): ProcessScheduled<Name, State, Intents>;
}

export interface ProcessOnEvents<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events,
> {
  evolve(
    fn: EvolveFn<State, Events, Name, Intents>,
  ): ProcessEvolved<Name, State, Intents, Events>;
}

export interface ProcessEvolved<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events,
> {
  onWake(
    fn: EvolveWakeFn<State, Name, Intents>,
  ): ProcessEvolvedWaked<Name, State, Intents, Events>;
  build(): EvolveDrivenProcess<Name, State, Intents, Events>;
}

export interface ProcessEvolvedWaked<
  Name extends string,
  State,
  Intents extends IntentMap,
  Events,
> {
  build(): EvolveDrivenProcess<Name, State, Intents, Events>;
}

export interface ProcessScheduled<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  /**
   * Required, not optional: an undeclared wake handler would leave a
   * scheduled process permanently dormant, so the curried type refuses to
   * offer `.build()` before this step rather than throwing at runtime for a
   * mistake the type system can rule out entirely.
   */
  onWake(
    fn: ScheduleWakeFn<State, Name, Intents>,
  ): ProcessScheduledWaked<Name, State, Intents>;
}

export interface ProcessScheduledWaked<
  Name extends string,
  State,
  Intents extends IntentMap,
> {
  build(): ScheduledProcess<Name, State, Intents>;
}

function makeStated<Name extends string, State>(
  name: Name,
  schema: z.ZodType<State>,
  init: () => State,
): ProcessStated<Name, State> {
  return {
    intents<const Intents extends IntentMap>(intents: Intents) {
      const keys = Object.keys(intents) as (keyof Intents & string)[];
      if (keys.length === 0) {
        throw new ConfigurationError(`process "${name}" declares no intents`, {
          process: name,
        });
      }
      for (const key of keys) {
        if (key.includes("/")) {
          throw new ConfigurationError(`intent key must not contain "/"`, {
            process: name,
            key,
          });
        }
      }

      const typeOf = (key: keyof Intents & string) =>
        `${name}/${key}` as IntentTypeString<Name, keyof Intents & string>;
      const intentTypes = keys.map(typeOf);

      const creators = Object.fromEntries(
        keys.map((key) => [
          key,
          (payload: unknown) => ({
            intentType: typeOf(key),
            messageKey: intents[key]!.messageKey(payload),
            payload,
          }),
        ]),
      ) as IntentCreators<Name, Intents>;

      const base = {
        name,
        intentTypes,
        intents: creators,
        stateSchema: schema,
        init,
      };

      return {
        on<A extends Aggregate<string, any, any, any>>(aggregate: A) {
          const eventTypes = [...aggregate.eventTypes] as readonly string[];
          return {
            evolve(evolveFn: EvolveFn<State, EventUnionOf<A>, Name, Intents>) {
              const buildEvolve = (
                onWakeFn?: EvolveWakeFn<State, Name, Intents>,
              ): EvolveDrivenProcess<
                Name,
                State,
                Intents,
                EventUnionOf<A>
              > => ({
                ...base,
                kind: "evolve",
                eventTypes,
                evolve: evolveFn,
                onWake: onWakeFn,
              });
              return {
                onWake: (wakeFn: EvolveWakeFn<State, Name, Intents>) => ({
                  build: () => buildEvolve(wakeFn),
                }),
                build: () => buildEvolve(),
              };
            },
          };
        },
        schedule(options: { everyMs: number }) {
          if (!Number.isFinite(options.everyMs) || options.everyMs <= 0) {
            throw new ConfigurationError(
              `process "${name}" schedule everyMs must be a positive finite number`,
              { process: name, everyMs: options.everyMs },
            );
          }
          return {
            onWake: (wakeFn: ScheduleWakeFn<State, Name, Intents>) => ({
              build: (): ScheduledProcess<Name, State, Intents> => ({
                ...base,
                kind: "schedule",
                everyMs: options.everyMs,
                onWake: wakeFn,
              }),
            }),
          };
        },
      };
    },
  };
}
