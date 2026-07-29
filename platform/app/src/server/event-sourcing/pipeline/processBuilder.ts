import type { ZodTypeAny } from "zod";

import type { Event } from "../domain/types";
import type { ProcessEventEnvelope } from "../process-manager/processManager.types";
import { ConfigurationError } from "../services/errorHandling";
import {
  defineProcessManager,
  type EventHandler,
  type IntentSpec,
  type ProcessManagerConfig,
  type ProcessManagerDefinition,
  type ProcessManagerEnqueueOptions,
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

interface ProcessManagerStateStage<E extends Event, State> {
  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerIntentStage<E, State, Record<Name, IntentSpec<Schema>>>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerScheduledStage<E, State>;
}

interface ProcessManagerScheduledStage<E extends Event, State>
  extends ProcessManagerStateStage<E, State> {
  onWake<FutureIntents extends Record<string, IntentSpec<any>>>(
    handle: WakeHandler<State, FutureIntents>,
  ): ProcessManagerScheduledHandledStage<E, State, FutureIntents>;
}

interface ProcessManagerScheduledHandledStage<
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

interface ProcessManagerIntentStage<
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
  /** @see ProcessManagerHandledStage.ignores */
  ignores<Type extends EventTypeOf<E>>(
    ...eventTypes: Type[]
  ): ProcessManagerHandledStage<E, State, Intents>;
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerIntentStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerIntentStage<E, State, Intents>;
  toPayload(
    map: (event: E) => ProcessEventEnvelope["payload"],
  ): ProcessManagerIntentStage<E, State, Intents>;
  /** @see ProcessManagerEnqueueOptions */
  enqueue(
    options: ProcessManagerEnqueueOptions<E>,
  ): ProcessManagerIntentStage<E, State, Intents>;
}

interface ProcessManagerHandledStage<
  E extends Event,
  State,
  Intents extends Record<string, IntentSpec<any>>,
> {
  on<Type extends EventTypeOf<E>>(
    eventType: Type,
    handle: EventHandler<State, EventData<E, Type>, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  /**
   * Subscribe to these events and decide nothing.
   *
   * Declared rather than omitted: the runtime derives its subscription from
   * the declared handlers AND throws on an undeclared event, so leaving one
   * out both stops delivery and turns any other delivery path into a hard
   * failure. This is the `default:` arm of a hand-rolled evolve, made explicit
   * — and it keeps a long list of "nothing to do here" events from burying the
   * decisions that matter in the pipeline's own topology.
   */
  ignores<Type extends EventTypeOf<E>>(
    ...eventTypes: Type[]
  ): ProcessManagerHandledStage<E, State, Intents>;
  onWake(
    handle: WakeHandler<State, Intents>,
  ): ProcessManagerHandledStage<E, State, Intents>;
  schedule(options: {
    everyMs: number;
  }): ProcessManagerHandledStage<E, State, Intents>;
  outbox(options: OutboxOptions): ProcessManagerHandledStage<E, State, Intents>;
  toPayload(
    map: (event: E) => ProcessEventEnvelope["payload"],
  ): ProcessManagerHandledStage<E, State, Intents>;
  /** @see ProcessManagerEnqueueOptions */
  enqueue(
    options: ProcessManagerEnqueueOptions<E>,
  ): ProcessManagerHandledStage<E, State, Intents>;
}

type ProcessManagerBuildableStage =
  | ProcessManagerHandledStage<any, any, any>
  | ProcessManagerScheduledHandledStage<any, any, any>;

class ProcessManagerBuilder<E extends Event> {
  private stateValue: unknown;
  private hasState = false;
  private readonly intents: Record<string, IntentSpec<any>> = {};
  private readonly handlers: Record<string, EventHandler<any, any, any>> = {};
  private wakeHandler: WakeHandler<any, any> | undefined;
  private readonly ignoredEventTypes: string[] = [];
  private outboxOptions: OutboxOptions | undefined;
  private scheduleOptions: { everyMs: number } | undefined;
  private payloadMapper:
    | ((event: E) => ProcessEventEnvelope["payload"])
    | undefined;
  private enqueueOptions: ProcessManagerEnqueueOptions<E> | undefined;

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

  /**
   * Route these event types into the process's inbox and decide nothing from
   * them — the instance still records that it saw them, which is what keeps a
   * later replay deterministic.
   *
   * **This CLEARS any armed deadline.** `nextWakeAt` is authoritative and the
   * runtime resolves an omitted one to `null`, so "no decision" and "cancel the
   * wake" are the same value. That is safe only for a process that never arms
   * one. Using this on a process with a deadline silently disarms it on the
   * next ignored event, and nothing fails — so the builder refuses that
   * combination rather than trusting the caller to notice. The same applies to
   * a deadline armed by `.schedule()`, which is refused for the same reason.
   */
  ignores(...eventTypes: string[]): this {
    if (this.scheduleOptions) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot use both .schedule() and .ignores(): ` +
          `an ignored event clears the wake the schedule armed. Handle those ` +
          `event types explicitly and return the wake you want to keep.`,
        { name: this.name, eventTypes },
      );
    }
    if (this.wakeHandler) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot use .ignores() after .onWake(): ` +
          `an ignored event clears the armed deadline. Handle those event ` +
          `types explicitly and return the wake you want to keep.`,
        { name: this.name, eventTypes },
      );
    }
    this.ignoredEventTypes.push(...eventTypes);
    for (const eventType of eventTypes) {
      this.on(eventType, (state) => ({ state, nextWakeAt: null }));
    }
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
    // `.ignores()` clears the deadline, because an omitted `nextWakeAt`
    // resolves to null and null is authoritative. A process that both ignores
    // events and arms a wake would disarm itself on the next ignored event,
    // with nothing failing and no test catching it. Refuse the combination
    // instead of documenting it.
    if (this.ignoredEventTypes.length > 0) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot use both .ignores() and .onWake(): ` +
          `an ignored event clears the armed deadline. Handle those event ` +
          `types explicitly and return the wake you want to keep.`,
        { name: this.name, ignoredEventTypes: this.ignoredEventTypes },
      );
    }
    this.wakeHandler = handle;
    return this;
  }

  outbox(options: OutboxOptions): this {
    this.outboxOptions = options;
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

  /**
   * The enqueue-time gate on this process's own delivery (ADR-069 invariant 4).
   *
   * Declared here rather than at the mount, for the same reason `toPayload` is:
   * what a process may decline before a job exists is a property of the
   * process, not of the pipeline that hosts it. Everything passed must be
   * TOTAL — see {@link ProcessManagerEnqueueOptions}.
   */
  enqueue(options: ProcessManagerEnqueueOptions<E>): this {
    if (this.enqueueOptions) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" already declares enqueue options`,
        { name: this.name },
      );
    }
    this.enqueueOptions = options;
    return this;
  }

  /**
   * Arm a recurring wake. The runtime re-arms it from the present on every
   * wake, so a schedule is a standing deadline rather than a one-shot.
   *
   * Refused alongside `.ignores()` for the reason that method documents: an
   * ignored event resolves `nextWakeAt` to null, and null is authoritative, so
   * the first ignored event would disarm the schedule with nothing failing.
   */
  schedule(options: { everyMs: number }): this {
    if (this.ignoredEventTypes.length > 0) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" cannot use both .ignores() and .schedule(): ` +
          `an ignored event clears the wake the schedule armed. Handle those ` +
          `event types explicitly and return the wake you want to keep.`,
        { name: this.name, ignoredEventTypes: this.ignoredEventTypes },
      );
    }
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
      toPayload: this.payloadMapper as
        | ((event: Event) => ProcessEventEnvelope["payload"])
        | undefined,
      enqueue: this.enqueueOptions as
        | ProcessManagerEnqueueOptions<Event>
        | undefined,
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
