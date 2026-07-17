import type { z, ZodTypeAny } from "zod";

import type { Event } from "../domain/types";
import { ConfigurationError } from "../services/errorHandling";
import {
  defineProcessManager,
  type FactHandler,
  type FeedFn,
  type IntentSpec,
  type ProcessManagerConfig,
  type ProcessManagerDefinition,
  type ProcessManagerTrigger,
  type TriggerOptions,
  type TriggerSpec,
  type WakeHandler,
} from "./processManagerDefinition";

/**
 * ADR-052 — the process-manager authoring surface: a staged callback
 * builder that compiles to the ProcessManagerConfig the runtime consumes.
 *
 *   .withProcessManager("triggerSettlement", (pm) => pm
 *     .state<SettlementState>(INITIAL_STATE)
 *     .intent("notify-digest", notifyDigestSchema, sendDigest(deps))
 *     .on("trigger-match", (state, data, { at, key, intents }) => …)
 *     .onWake((state, at, { intents }) => …)
 *     .trigger({ fold: "traceSummary", events: MESSAGE_EVENTS, feed })
 *     .outbox({ maxAttempts: 8 }))
 *
 * The stage order is compiler-enforced because each call narrows the
 * builder's generics forward:
 *
 *   state → intents → on/onWake → triggers/outbox/schedule
 *
 * intents come before `on` so the fact handlers receive fully-typed intent
 * factories; `on` comes before triggers so feeds type-check against the
 * declared facts.
 */

/** Facts a builder has accumulated: fact name → data type. */
type FactsOf<OnMap> = { [K in keyof OnMap]: OnMap[K] };

export class ProcessManagerBuilder<
  E extends Event,
  State = never,
  Intents extends Record<string, IntentSpec<any>> = {},
  Facts = {},
> {
  private stateValue: unknown;
  private hasState = false;
  private readonly intents: Record<string, IntentSpec<any>> = {};
  private readonly onHandlers: Record<
    string,
    FactHandler<any, any, any>
  > = {};
  private wakeHandler: WakeHandler<any, any> | null = null;
  private readonly triggers: Array<ProcessManagerTrigger<E, any>> = [];
  private outboxOptions: ProcessManagerConfig<any, any, any>["outbox"];
  private scheduleOptions: { everyMs: number } | undefined;

  constructor(private readonly name: string) {}

  /** State an unseen process key starts from. First call, required. */
  state<S>(initial: S): ProcessManagerBuilder<E, S, Intents, Facts> {
    this.stateValue = initial;
    this.hasState = true;
    return this as unknown as ProcessManagerBuilder<E, S, Intents, Facts>;
  }

  /**
   * Declare an intent: its name (the outbox row's intentType), its
   * persisted payload schema, and its executor. Fact handlers can only
   * emit intents declared here — via typed factories.
   */
  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerBuilder<E, State, Intents & Record<Name, IntentSpec<Schema>>, Facts> {
    if (this.intents[name]) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already declares intent "${name}"`,
        { name: this.name, intent: name },
      );
    }
    this.intents[name] = { schema, run };
    return this as unknown as ProcessManagerBuilder<
      E,
      State,
      Intents & Record<Name, IntentSpec<Schema>>,
      Facts
    >;
  }

  /** Pure decision for one fact type. Facts never persist — `Data` is
   *  typed by TypeScript alone; feeds type-check against it. */
  on<Name extends string, Data>(
    fact: Name,
    handle: FactHandler<State, Data, Intents>,
  ): ProcessManagerBuilder<E, State, Intents, Facts & Record<Name, Data>> {
    if (this.onHandlers[fact]) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already handles fact "${fact}"`,
        { name: this.name, fact },
      );
    }
    this.onHandlers[fact] = handle as FactHandler<any, any, any>;
    return this as unknown as ProcessManagerBuilder<
      E,
      State,
      Intents,
      Facts & Record<Name, Data>
    >;
  }

  /** Pure decision for a due wake. Declaring it is what enables timers. */
  onWake(handle: WakeHandler<State, Intents>): this {
    if (this.wakeHandler) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already has a wake handler`,
        { name: this.name },
      );
    }
    this.wakeHandler = handle as WakeHandler<any, any>;
    return this;
  }

  /**
   * Where facts come from. `fold`/`map` stages the feed after that
   * projection commits (state in hand, per-aggregate latest-wins collapse);
   * `events` fires on raw delivery and doubles as a filter when combined.
   */
  trigger(
    spec: TriggerSpec &
      TriggerOptions<E> & { feed: FeedFn<E, FactsOf<Facts>, any> },
  ): this {
    this.triggers.push(spec as ProcessManagerTrigger<E, any>);
    return this;
  }

  /** Outbox delivery tuning for this PM's intents. */
  outbox(options: NonNullable<ProcessManagerConfig<any, any, any>["outbox"]>): this {
    this.outboxOptions = options;
    return this;
  }

  /** Standing wake cadence for singleton sweeps (requires onWake). */
  schedule(options: { everyMs: number }): this {
    this.scheduleOptions = options;
    return this;
  }

  /** Framework-internal. */
  build(): ProcessManagerDefinition {
    if (!this.hasState) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" declares no state — call .state() first`,
        { name: this.name },
      );
    }
    return defineProcessManager({
      name: this.name,
      state: this.stateValue,
      triggers: this.triggers,
      on: { ...this.onHandlers, wake: this.wakeHandler ?? undefined } as never,
      intents: this.intents,
      outbox: this.outboxOptions,
      schedule: this.scheduleOptions,
    }) as ProcessManagerDefinition;
  }
}

/** The callback `withProcessManager(name, applier)` accepts. Domain modules
 *  export curried appliers: `(deps) => (pm) => pm.state(…)…`. */
export type ProcessManagerApplier<E extends Event> = (
  pm: ProcessManagerBuilder<E>,
) => ProcessManagerBuilder<E, any, any, any>;

export function buildProcessManager<E extends Event>(
  name: string,
  applier: ProcessManagerApplier<E>,
): ProcessManagerDefinition {
  return applier(new ProcessManagerBuilder<E>(name)).build();
}
