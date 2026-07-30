import type { z } from "zod";
import { ConfigurationError } from "../errors";
import type {
  Aggregate,
  AggregateEvent,
  CommandMap,
  EventCreators,
  EventMap,
  EventTypeString,
} from "./aggregate.types";
import { resolveStateVersion } from "./stateVersion";

/**
 * One declaration per aggregate (ADR-105).
 *
 * The builder is curried rather than a single object literal, and that is not a
 * style choice. `State` is inferred from the state schema, and the event
 * handlers must be checked against it — in one call those are mutually
 * dependent, so every handler parameter resolves to `unknown` and the fold
 * bodies lose their types entirely. Each step here is a separate call, so it
 * already knows everything the previous step established, and `.commands()`
 * sees both the state type and the generated event creators.
 *
 * ```ts
 * export const codingAgentSession = defineAggregate("coding_agent_session")
 *   .state(sessionStateSchema, () => ({ cost: 0, spans: 0 }))
 *   .events({
 *     spanRecorded: {
 *       data: z.object({ costCents: z.number() }),
 *       apply: (s, d) => ({ ...s, cost: s.cost + d.costCents, spans: s.spans + 1 }),
 *     },
 *   })
 *   .build();
 * ```
 */
export function defineAggregate<const Name extends string>(
  name: Name,
): AggregateNamed<Name> {
  if (name.includes("/")) {
    // The separator is structural: an event's type string is `name/key`, so a
    // name containing one would produce a string that cannot be split back into
    // its parts, and every stored event of that type would be unroutable.
    throw new ConfigurationError(
      `aggregate name must not contain "/"`,
      { name },
    );
  }
  return {
    state<State>(schema: z.ZodType<State>, init: () => State) {
      return makeStated<Name, State>(name, schema, init);
    },
  };
}

export interface AggregateNamed<Name extends string> {
  /**
   * Fixes the state type and its genesis value.
   *
   * `init` is a factory rather than a value so two aggregates can never share a
   * mutable initial state — one fold mutating it would silently change the
   * starting point of every other aggregate of the same type.
   */
  state<State>(
    schema: z.ZodType<State>,
    init: () => State,
  ): AggregateStated<Name, State>;
}

export interface AggregateStated<Name extends string, State> {
  events<const Events extends EventMap<State>>(
    events: Events,
  ): AggregateEvented<Name, State, Events>;
}

export interface AggregateEvented<
  Name extends string,
  State,
  Events extends EventMap<State>,
> {
  commands<const Commands extends CommandMap<Name, State, Events>>(
    commands: Commands,
  ): AggregateCommanded<Name, State, Events, Commands>;
  /** Builds with no commands — valid for an aggregate fed only by other pipelines. */
  build(options?: BuildOptions): Aggregate<Name, State, Events, never>;
}

export interface AggregateCommanded<
  Name extends string,
  State,
  Events extends EventMap<State>,
  Commands extends CommandMap<Name, State, Events>,
> {
  build(options?: BuildOptions): Aggregate<Name, State, Events, Commands>;
}

export interface BuildOptions {
  /**
   * Pins the state version instead of deriving it from the schema.
   *
   * A pin decouples the version number from the shape hash; it does not switch
   * off drift detection. The built aggregate still reports `schemaHash`, so a
   * shape that changes under an unchanged pin is detectable. Every fold that
   * existed before derived versions shipped must pin, because otherwise every
   * live row fails its version gate at once — no stored version matches a
   * freshly computed hash.
   */
  readonly stateVersion?: string;
}

function makeStated<Name extends string, State>(
  name: Name,
  schema: z.ZodType<State>,
  init: () => State,
): AggregateStated<Name, State> {
  return {
    events<const Events extends EventMap<State>>(events: Events) {
      const keys = Object.keys(events) as (keyof Events & string)[];
      if (keys.length === 0) {
        throw new ConfigurationError(
          `aggregate "${name}" declares no events`,
          { aggregate: name },
        );
      }
      for (const key of keys) {
        if (key.includes("/")) {
          throw new ConfigurationError(
            `event key must not contain "/"`,
            { aggregate: name, key },
          );
        }
      }

      const build = <Commands extends CommandMap<Name, State, Events>>(
        commands: Commands,
        options?: BuildOptions,
      ): Aggregate<Name, State, Events, Commands> => {
        const { version, schemaHash } = resolveStateVersion({
          schema,
          pinned: options?.stateVersion,
        });

        const typeOf = (key: keyof Events & string) =>
          `${name}/${key}` as EventTypeString<Name, keyof Events & string>;

        const creators = Object.fromEntries(
          keys.map((key) => [
            key,
            (data: unknown) => ({ type: typeOf(key), data }),
          ]),
        ) as EventCreators<Name, State, Events>;

        // One lookup table, built once, rather than a switch rebuilt per event.
        const applyByType = new Map<
          string,
          (state: State, data: unknown) => State
        >(
          keys.map((key) => [
            typeOf(key),
            events[key]!.apply as (state: State, data: unknown) => State,
          ]),
        );

        return {
          name,
          eventTypes: keys.map(typeOf),
          stateVersion: version,
          schemaHash,
          events: creators,
          commands,
          init,
          apply(state: State, event: AggregateEvent): State {
            const handler = applyByType.get(event.type);
            // An unrecognised type is returned unchanged rather than throwing.
            // A deploy that adds an event leaves older workers still draining
            // the queue, and those workers must not fail on a type they were
            // built before — they simply do not contribute to it.
            return handler ? handler(state, event.data) : state;
          },
        };
      };

      return {
        commands<const Commands extends CommandMap<Name, State, Events>>(
          commands: Commands,
        ) {
          for (const key of Object.keys(commands)) {
            if (key.includes("/")) {
              throw new ConfigurationError(
                `command key must not contain "/"`,
                { aggregate: name, key },
              );
            }
          }
          return {
            build: (options?: BuildOptions) => build(commands, options),
          };
        },
        build: (options?: BuildOptions) =>
          build({} as never, options) as Aggregate<Name, State, Events, never>,
      };
    },
  };
}
