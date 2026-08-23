import type { ZodTypeAny, z } from "zod";

import type { Event } from "../domain/types";
import type { ProcessEventEnvelope } from "../process-manager/processManager.types";
import { ConfigurationError } from "../services/errorHandling";
import {
  defineProcessManager,
  type EventHandler,
  type IntentSpec,
  type ProcessManagerConfig,
  type ProcessManagerDefinition,
  type SignalHandler,
  type SignalSpec,
  type WakeHandler,
} from "./processManagerDefinition";

type EventTypeOf<E extends Event> = E["type"] & string;
type EventData<E extends Event, Type extends string> =
  Extract<E, { type: Type }> extends Event<infer Data> ? Data : never;

type OutboxOptions = NonNullable<
  ProcessManagerConfig<any, Record<string, IntentSpec<any>>>["outbox"]
>;

export interface ProcessManagerInitialStage<E extends Event> {
  state<State>(initial: State): ProcessManagerStateStage<E, State>;
}

export interface ProcessManagerStateStage<E extends Event, State> {
  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerIntentStage<E, State, Record<Name, IntentSpec<Schema>>>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerScheduledStage<E, State>;
  /** Enter the handler stage without declaring an outbox intent. */
  keyBy(
    resolve: (event: E) => string,
  ): ProcessManagerIntentStage<E, State, Record<never, never>>;
}

export interface ProcessManagerScheduledStage<E extends Event, State>
  extends ProcessManagerStateStage<E, State> {
  onWake<FutureIntents extends Record<string, IntentSpec<any>>>(
    handle: WakeHandler<State, FutureIntents>,
  ): ProcessManagerScheduledHandledStage<E, State, FutureIntents>;
}

export interface ProcessManagerScheduledHandledStage<
  E extends Event,
  State,
  FutureIntents extends Record<string, IntentSpec<any>>,
> {
  intent<Name extends keyof FutureIntents & string>(
    name: Name,
    schema: FutureIntents[Name]["schema"],
    run: FutureIntents[Name]["run"],
  ): ProcessManagerHandledStage<E, State, FutureIntents>;
}

export interface ProcessManagerIntentStage<
  E extends Event,
  State,
  Intents extends Record<string, IntentSpec<any>>,
> {
  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerIntentStage<
    E,
    State,
    Intents & Record<Name, IntentSpec<Schema>>
  >;
  on<Type extends EventTypeOf<E>>(
    eventType: Type,
    handle: EventHandler<State, EventData<E, Type>, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  onSignal<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    handle: SignalHandler<State, z.output<Schema>, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  keyBy(resolve: (event: E) => string): ProcessManagerIntentStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerIntentStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerIntentStage<E, State, Intents>;
  transient(): ProcessManagerIntentStage<E, State, Intents>;
  toPayload(
    map: (event: E) => ProcessEventEnvelope["payload"],
  ): ProcessManagerIntentStage<E, State, Intents>;
}

export interface ProcessManagerHandledStage<
  E extends Event,
  State,
  Intents extends Record<string, IntentSpec<any>>,
> {
  on<Type extends EventTypeOf<E>>(
    eventType: Type,
    handle: EventHandler<State, EventData<E, Type>, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  onSignal<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    handle: SignalHandler<State, z.output<Schema>, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  keyBy(resolve: (event: E) => string): ProcessManagerHandledStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerHandledStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerHandledStage<E, State, Intents>;
  transient(): ProcessManagerHandledStage<E, State, Intents>;
  toPayload(
    map: (event: E) => ProcessEventEnvelope["payload"],
  ): ProcessManagerHandledStage<E, State, Intents>;
}

export type ProcessManagerBuildableStage =
  | ProcessManagerHandledStage<any, any, any>
  | ProcessManagerScheduledHandledStage<any, any, any>;

class ProcessManagerBuilder<E extends Event> {
  private stateValue: unknown;
  private hasState = false;
  private readonly intents: Record<string, IntentSpec<any>> = {};
  private readonly handlers: Record<string, EventHandler<any, any, any>> = {};
  private readonly signals: Record<string, SignalSpec<any, any, any>> = {};
  private wakeHandler: WakeHandler<any, any> | undefined;
  private outboxOptions: OutboxOptions | undefined;
  private scheduleOptions: { everyMs: number } | undefined;
  private transientOption = false;
  private keyResolver: ((event: E) => string) | undefined;
  private payloadMapper:
    | ((event: E) => ProcessEventEnvelope["payload"])
    | undefined;

  constructor(private readonly name: string) {}

  state<State>(initial: State): ProcessManagerStateStage<E, State> {
    this.stateValue = initial;
    this.hasState = true;
    return this as unknown as ProcessManagerStateStage<E, State>;
  }

  intent(name: string, schema: ZodTypeAny, run: IntentSpec["run"]): this {
    if (this.intents[name]) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already declares intent "${name}"`,
        { name: this.name, intent: name },
      );
    }
    this.intents[name] = { schema, run };
    return this;
  }

  on(eventType: string, handle: EventHandler<any, any, any>): this {
    if (this.handlers[eventType]) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already handles event "${eventType}"`,
        { name: this.name, eventType },
      );
    }
    this.handlers[eventType] = handle;
    return this;
  }

  onSignal(
    name: string,
    schema: ZodTypeAny,
    handle: SignalHandler<any, any, any>,
  ): this {
    if (this.signals[name]) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already handles signal "${name}"`,
        { name: this.name, signal: name },
      );
    }
    this.signals[name] = { schema, handle };
    return this;
  }

  onWake(handle: WakeHandler<any, any>): this {
    if (this.wakeHandler) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already has a wake handler`,
        { name: this.name },
      );
    }
    this.wakeHandler = handle;
    return this;
  }

  keyBy(resolve: (event: E) => string): this {
    if (this.keyResolver) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already declares keyBy`,
        { name: this.name },
      );
    }
    this.keyResolver = resolve;
    return this;
  }

  outbox(options: OutboxOptions): this {
    this.outboxOptions = options;
    return this;
  }

  /**
   * Declares that evolutions keeping the initial state and arming no wake
   * may commit their intents alone — see `ProcessManagerConfig.transient`.
   *
   * TWO PRECONDITIONS, neither of which the type system can check.
   *
   * 1. Every message key such an evolution mints must be derivable from the
   *    EVENT alone. A key built from a clock, a counter or a random value
   *    cannot be re-derived by a redelivery, so the outbox suppression misses
   *    and the side effect happens twice.
   *
   * 2. Every intent handler must be idempotent AT ITS OWN SINK. A transient
   *    commit writes no inbox marker, so the dispatched outbox row is the
   *    only suppression, and that row is pruned at
   *    `DISPATCHED_OUTBOX_RETENTION_MS` (24h) rather than the inbox's 7 days.
   *    Past that window a redelivery dispatches again, and only the sink can
   *    stop it becoming a second effect.
   *
   * Refuses a schedule: a scheduled process is armed by writing a wake onto
   * its instance row, so a transient one would have nowhere to be armed and
   * would silently never run.
   */
  transient(): this {
    if (this.scheduleOptions) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot be transient and scheduled: a schedule is armed on the instance row a transient evolution declines to write`,
        { name: this.name },
      );
    }
    this.transientOption = true;
    return this;
  }

  /**
   * The content boundary (ADR-052): narrows a committed event to the payload
   * the process may see. The payload is persisted verbatim into process
   * state and outbox rows, so any domain whose events carry customer
   * content MUST declare one.
   */
  toPayload(map: (event: E) => ProcessEventEnvelope["payload"]): this {
    if (this.payloadMapper) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already declares toPayload`,
        { name: this.name },
      );
    }
    this.payloadMapper = map;
    return this;
  }

  schedule(options: { everyMs: number }): this {
    if (!Number.isFinite(options.everyMs) || options.everyMs <= 0) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" schedule everyMs must be a positive finite number`,
        { name: this.name, everyMs: options.everyMs },
      );
    }
    if (this.transientOption) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot be transient and scheduled: a schedule is armed on the instance row a transient evolution declines to write`,
        { name: this.name },
      );
    }
    this.scheduleOptions = options;
    return this;
  }

  build(): ProcessManagerDefinition {
    if (!this.hasState) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" declares no state`,
        { name: this.name },
      );
    }
    return defineProcessManager({
      name: this.name,
      state: this.stateValue,
      handlers: this.handlers,
      eventTypes: Object.keys(this.handlers),
      keyBy: this.keyResolver as ((event: Event) => string) | undefined,
      signals: this.signals,
      onWake: this.wakeHandler,
      toPayload: this.payloadMapper as
        | ((event: Event) => ProcessEventEnvelope["payload"])
        | undefined,
      intents: this.intents,
      outbox: this.outboxOptions,
      schedule: this.scheduleOptions,
      transient: this.transientOption,
    });
  }
}

export type ProcessManagerApplier<E extends Event> = (
  pm: ProcessManagerInitialStage<E>,
) => ProcessManagerBuildableStage;

export function buildProcessManager<E extends Event>({
  name,
  applier,
}: {
  name: string;
  applier: ProcessManagerApplier<E>;
}): ProcessManagerDefinition {
  const builder = new ProcessManagerBuilder<E>(name);
  applier(builder);
  return builder.build();
}
