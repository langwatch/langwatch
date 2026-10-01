import type { ZodTypeAny, z } from "zod";

import type { PipelineEventSchema } from "../domain/eventSchemas.ts";
import type { Event } from "../domain/types.ts";
import type { ProcessEventEnvelope } from "../process-manager/processManager.types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import {
  defineProcessManager,
  type EventHandler,
  type IntentSpec,
  type ProcessManagerConfig,
  type ProcessHandlerContext,
  type ProcessManagerDefinition,
  type SchemaOf,
  type SignalHandler,
  type SignalSpec,
  type WakeHandler,
} from "./processManagerDefinition.ts";

type OutboxOptions = NonNullable<
  ProcessManagerConfig<unknown, Record<string, IntentSpec>>["outbox"]
>;

type ErasedIntents = Record<string, IntentSpec>;
type ErasedEventHandler = EventHandler<unknown, unknown, ErasedIntents>;

/** A pipeline event schema whose `data` a process handler reads (ARCHITECTURE §9). */
export type HandledEventSchema = PipelineEventSchema & {
  readonly shape: { readonly data: ZodTypeAny };
};

/** The event type a handled schema's `type` literal names. */
function handledTypeOf(schema: HandledEventSchema): string {
  return String([...schema.shape.type.values][0]);
}

function parseWith<Schema extends ZodTypeAny>(schema: Schema, value: unknown): z.output<Schema> {
  return schema.parse(value);
}

/** Wraps a typed handler as the erased one the runtime calls: state and data parse first. */
function erasedHandler<State, Data, Intents>({
  stateSchema,
  readData,
  handle,
}: {
  stateSchema: z.ZodType<State>;
  readData: (data: unknown) => Data;
  handle: EventHandler<State, Data, Intents>;
}): ErasedEventHandler {
  return (state, data, context) =>
    handle(stateSchema.parse(state), readData(data), presentContext(context));
}

/** The runtime's context for a typed handler: its accessor keeps each intent's payload type. */
function presentContext<Intents>(
  context: ProcessHandlerContext<ErasedIntents>,
): ProcessHandlerContext<Intents> {
  return {
    at: context.at,
    now: context.now,
    key: context.key,
    projectId: context.projectId,
    intent: (name, key, payload) => context.intent(name, key, payload),
  };
}

/** What every stage past `.state()` shares: the erased accumulator and the state schema. */
interface StageParts<E extends Event, State> {
  readonly builder: ProcessManagerBuilder<E>;
  readonly stateSchema: z.ZodType<State>;
}

function addIntent<E extends Event, State, Schema extends ZodTypeAny>(
  parts: StageParts<E, State>,
  { name, schema, run }: { name: string; schema: Schema; run: IntentSpec<Schema>["run"] },
): void {
  parts.builder.intent(name, schema, (payload, context) =>
    run(parseWith(schema, payload), context),
  );
}

function addSignal<E extends Event, State, Schema extends ZodTypeAny, Intents>(
  parts: StageParts<E, State>,
  {
    name,
    schema,
    handle,
  }: { name: string; schema: Schema; handle: SignalHandler<State, z.output<Schema>, Intents> },
): void {
  parts.builder.onSignal(
    name,
    schema,
    erasedHandler({
      stateSchema: parts.stateSchema,
      readData: (data) => parseWith(schema, data),
      handle,
    }),
  );
}

function addWake<E extends Event, State, Intents>(
  parts: StageParts<E, State>,
  handle: WakeHandler<State, Intents>,
): void {
  parts.builder.onWake((state, context) =>
    handle(parts.stateSchema.parse(state), presentContext(context)),
  );
}

export class ProcessManagerInitialStage<E extends Event> {
  constructor(private readonly builder: ProcessManagerBuilder<E>) {}

  state<Schema extends ZodTypeAny>(
    schema: Schema & z.ZodType<z.output<Schema>>,
    initial: z.output<Schema>,
  ): ProcessManagerStateStage<E, z.output<Schema>> {
    this.builder.setState(schema, initial);
    return new ProcessManagerStateStage<E, z.output<Schema>>({
      builder: this.builder,
      stateSchema: schema,
    });
  }
}

export class ProcessManagerStateStage<E extends Event, State> {
  constructor(protected readonly parts: StageParts<E, State>) {}

  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerStage<E, State, Record<Name, IntentSpec<Schema>>> {
    addIntent(this.parts, { name, schema, run });
    return new ProcessManagerStage(this.parts);
  }

  schedule(options: { everyMs: number }): ProcessManagerScheduledStage<E, State> {
    this.parts.builder.schedule(options);
    return new ProcessManagerScheduledStage(this.parts);
  }

  /** Enter the handler stage without declaring an outbox intent. */
  keyBy(resolve: (event: E) => string): ProcessManagerStage<E, State, Record<never, never>> {
    this.parts.builder.keyBy(resolve);
    return new ProcessManagerStage(this.parts);
  }
}

export class ProcessManagerScheduledStage<E extends Event, State> extends ProcessManagerStateStage<
  E,
  State
> {
  onWake<FutureIntents = ErasedIntents>(
    handle: WakeHandler<State, FutureIntents>,
  ): ProcessManagerScheduledHandledStage<E, State, FutureIntents> {
    addWake(this.parts, handle);
    return new ProcessManagerScheduledHandledStage(this.parts);
  }
}

export class ProcessManagerScheduledHandledStage<E extends Event, State, FutureIntents> {
  constructor(private readonly parts: StageParts<E, State>) {}

  intent<Name extends keyof FutureIntents & string>(
    name: Name,
    schema: SchemaOf<FutureIntents[Name]>,
    run: IntentSpec<SchemaOf<FutureIntents[Name]>>["run"],
  ): ProcessManagerStage<E, State, FutureIntents> {
    addIntent(this.parts, { name, schema, run });
    return new ProcessManagerStage(this.parts);
  }
}

/** A process manager whose handlers read each event's own `data`. */
export class ProcessManagerStage<E extends Event, State, Intents> {
  readonly buildable = true;

  constructor(private readonly parts: StageParts<E, State>) {}

  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerStage<E, State, Intents & Record<Name, IntentSpec<Schema>>> {
    addIntent(this.parts, { name, schema, run });
    return new ProcessManagerStage(this.parts);
  }

  on<S extends HandledEventSchema & z.ZodType<E>>(
    schema: S,
    handle: EventHandler<State, z.output<S["shape"]["data"]>, Intents>,
  ): this {
    this.parts.builder.on(
      handledTypeOf(schema),
      erasedHandler({
        stateSchema: this.parts.stateSchema,
        readData: (data) => {
          const dataSchema: S["shape"]["data"] = schema.shape.data;
          return parseWith(dataSchema, data);
        },
        handle,
      }),
    );
    return this;
  }

  onSignal<Schema extends ZodTypeAny>(
    name: string,
    schema: Schema,
    handle: SignalHandler<State, z.output<Schema>, Intents>,
  ): this {
    addSignal(this.parts, { name, schema, handle });
    return this;
  }

  onWake(handle: WakeHandler<State, Intents>): this {
    addWake(this.parts, handle);
    return this;
  }

  keyBy(resolve: (event: E) => string): this {
    this.parts.builder.keyBy(resolve);
    return this;
  }

  schedule(options: { everyMs: number }): this {
    this.parts.builder.schedule(options);
    return this;
  }

  outbox(options: OutboxOptions): this {
    this.parts.builder.outbox(options);
    return this;
  }

  transient(): this {
    this.parts.builder.transient();
    return this;
  }

  /**
   * The content boundary (ADR-052): narrows a committed event to the payload the process may see,
   * persisted verbatim; handlers then read that payload through `schema`, not the event's data.
   */
  toPayload<Payload extends ZodTypeAny>(
    schema: Payload,
    map: (event: E) => ProcessEventEnvelope["payload"],
  ): ProcessManagerPayloadStage<E, State, Intents, Payload> {
    this.parts.builder.toPayload(map);
    return new ProcessManagerPayloadStage(this.parts, schema);
  }
}

/** A process manager whose handlers read the payload its `toPayload` persisted. */
export class ProcessManagerPayloadStage<
  E extends Event,
  State,
  Intents,
  Payload extends ZodTypeAny,
> {
  readonly buildable = true;

  constructor(
    private readonly parts: StageParts<E, State>,
    private readonly payloadSchema: Payload,
  ) {}

  intent<Name extends string, Schema extends ZodTypeAny>(
    name: Name,
    schema: Schema,
    run: IntentSpec<Schema>["run"],
  ): ProcessManagerPayloadStage<E, State, Intents & Record<Name, IntentSpec<Schema>>, Payload> {
    addIntent(this.parts, { name, schema, run });
    return new ProcessManagerPayloadStage(this.parts, this.payloadSchema);
  }

  on<S extends HandledEventSchema & z.ZodType<E>>(
    schema: S,
    handle: EventHandler<State, z.output<Payload>, Intents>,
  ): this {
    const payloadSchema = this.payloadSchema;
    this.parts.builder.on(
      handledTypeOf(schema),
      erasedHandler({
        stateSchema: this.parts.stateSchema,
        readData: (data) => parseWith(payloadSchema, data),
        handle,
      }),
    );
    return this;
  }

  onSignal<Schema extends ZodTypeAny>(
    name: string,
    schema: Schema,
    handle: SignalHandler<State, z.output<Schema>, Intents>,
  ): this {
    addSignal(this.parts, { name, schema, handle });
    return this;
  }

  onWake(handle: WakeHandler<State, Intents>): this {
    addWake(this.parts, handle);
    return this;
  }

  keyBy(resolve: (event: E) => string): this {
    this.parts.builder.keyBy(resolve);
    return this;
  }

  schedule(options: { everyMs: number }): this {
    this.parts.builder.schedule(options);
    return this;
  }

  outbox(options: OutboxOptions): this {
    this.parts.builder.outbox(options);
    return this;
  }

  transient(): this {
    this.parts.builder.transient();
    return this;
  }
}

/** A stage a process manager may be built from: one that handles something. */
export interface ProcessManagerBuildableStage {
  readonly buildable: true;
}

class ProcessManagerBuilder<E extends Event> {
  private stateValue: unknown;
  private stateSchema: ZodTypeAny | undefined;
  private readonly intents: Record<string, IntentSpec> = {};
  private readonly handlers: Record<string, ErasedEventHandler> = {};
  private readonly signals: Record<string, SignalSpec> = {};
  private wakeHandler: WakeHandler<unknown, Record<string, IntentSpec>> | undefined;
  private outboxOptions: OutboxOptions | undefined;
  private scheduleOptions: { everyMs: number } | undefined;
  private transientOption = false;
  private keyResolver: ((event: E) => string) | undefined;
  private payloadMapper: ((event: E) => ProcessEventEnvelope["payload"]) | undefined;

  constructor(private readonly name: string) {}

  setState(schema: ZodTypeAny, initial: unknown): void {
    this.stateValue = initial;
    this.stateSchema = schema;
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

  on(eventType: string, handle: ErasedEventHandler): this {
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

  onSignal(name: string, schema: ZodTypeAny, handle: SignalSpec["handle"]): this {
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

  onWake(handle: WakeHandler<unknown, Record<string, IntentSpec>>): this {
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
   * Declares evolutions may commit intents without full state/wake.
   * Requires: event-derived message keys and idempotent handler sinks (see ProcessManagerConfig).
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
   * the process may see, persisted verbatim into process state and outbox
   * rows — any domain whose events carry customer content MUST declare one.
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
    if (!this.stateSchema) {
      throw new ConfigurationError(
        "ProcessManagerBuilder",
        `Process manager "${this.name}" declares no state`,
        { name: this.name },
      );
    }
    return defineProcessManager({
      name: this.name,
      state: this.stateValue,
      stateSchema: this.stateSchema,
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
  applier(new ProcessManagerInitialStage(builder));
  return builder.build();
}
