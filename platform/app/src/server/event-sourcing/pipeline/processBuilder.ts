import type { ZodTypeAny } from "zod";

import type { Event } from "../domain/types";
import { ConfigurationError } from "../services/errorHandling";
import {
  defineProcessManager,
  type EventHandler,
  type IntentSpec,
  type ProcessManagerConfig,
  type ProcessManagerDefinition,
  type WakeHandler,
} from "./processManagerDefinition";

type EventTypeOf<E extends Event> = E["type"] & string;
type EventData<E extends Event, Type extends string> = Extract<
  E,
  { type: Type }
> extends Event<infer Data>
  ? Data
  : never;

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
  schedule(options: { everyMs: number }): ProcessManagerScheduledStage<E, State>;
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
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerIntentStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerIntentStage<E, State, Intents>;
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
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerHandledStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerHandledStage<E, State, Intents>;
}

export type ProcessManagerBuildableStage =
  | ProcessManagerHandledStage<any, any, any>
  | ProcessManagerScheduledHandledStage<any, any, any>;

class ProcessManagerBuilder<E extends Event> {
  private stateValue: unknown;
  private hasState = false;
  private readonly intents: Record<string, IntentSpec<any>> = {};
  private readonly handlers: Record<
    string,
    EventHandler<any, any, any>
  > = {};
  private wakeHandler: WakeHandler<any, any> | undefined;
  private outboxOptions: OutboxOptions | undefined;
  private scheduleOptions: { everyMs: number } | undefined;

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

  on(
    eventType: string,
    handle: EventHandler<any, any, any>,
  ): this {
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

  outbox(options: OutboxOptions): this {
    this.outboxOptions = options;
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
      onWake: this.wakeHandler,
      intents: this.intents,
      outbox: this.outboxOptions,
      schedule: this.scheduleOptions,
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
