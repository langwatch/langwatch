import type { ZodTypeAny, z } from "zod";

import type { Event } from "../domain/types.ts";
import type {
  ProcessEventEnvelope,
  ProcessIntent,
} from "../process-manager/processManager.types.ts";
import type { DeduplicationConfig } from "../queues/queue.types.ts";
import type { ExecutionTarget } from "../runtime.types.ts";

/** Shared delivery descriptor for lightweight subscribers. */
export type TriggerSpec =
  | { events: readonly string[]; fold?: never; map?: never }
  | { fold: string; events?: readonly string[]; map?: never }
  | { map: string; events?: readonly string[]; fold?: never };

export interface TriggerOptions<E extends Event = Event> {
  delay?: number;
  ttl?: number;
  /**
   * Full dedup strategy. Fold/map-bound subscribers receive the committed
   * projection state as `makeId`'s second argument (raw subscribers get
   * `undefined`), for keys derived from folded values rather than the event.
   */
  dedup?:
    | "aggregate"
    | (Omit<DeduplicationConfig<E>, "makeId"> & {
        makeId: (event: E, state?: unknown) => string;
      });
  dedupId?: (event: E) => string;
  /**
   * Pure, synchronous relevance guard, evaluated before enqueue and again in
   * the handler. Fold/map-bound subscribers see committed state in
   * `context.state`; a throwing guard fails open (treated as relevant).
   */
  when?: (event: E, context: TriggerContext<any>) => boolean;
  /** Process roles where this subscriber runs. Omit to run everywhere. */
  runIn?: ExecutionTarget[];
  /** Statically disable the subscriber (e.g. a transport dependency is absent). */
  disabled?: boolean;
  /** Domain key for the subscriber's GroupQueue group; key by tenant for expensive handlers. */
  groupKeyFn?: (event: E, state?: unknown) => string;
}

export interface TriggerContext<State = unknown> {
  tenantId: string;
  aggregateId: string;
  state: State;
}

export type SubscriberSpec<E extends Event = Event> = TriggerSpec &
  TriggerOptions<E> & {
    handler: (event: E, context: TriggerContext<any>) => Promise<void>;
  };

export type IntentFactories<Intents extends Record<string, IntentSpec<any>>> = {
  [K in keyof Intents & string]: (
    key: string,
    payload: z.input<Intents[K]["schema"]>,
  ) => ProcessIntent;
};

export interface IntentContext {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  messageKey: string;
  attempt: number;
  /** When the delivery's outbox lease lapses; absent where no dispatcher leased it. */
  leaseExpiresAt?: number;
}

export type IntentExecutor<Payload> = (payload: Payload, context: IntentContext) => Promise<void>;

export interface IntentSpec<Schema extends ZodTypeAny = ZodTypeAny> {
  schema: Schema;
  run: IntentExecutor<z.output<Schema>>;
}

export interface ProcessEvolution<State> {
  state: State;
  nextWakeAt?: number | null;
  intents?: ProcessIntent[];
}

export interface ProcessHandlerContext<Intents extends Record<string, IntentSpec<any>>> {
  /**
   * The instant the input refers to: the event's `occurredAt`, or the slot a
   * wake was scheduled for. May be arbitrarily far in the past when the
   * subscriber backed up or the fleet was down.
   */
  at: number;
  /**
   * Wall-clock at which this input is actually being handled. Schedule from
   * `Math.max(at, now)`, never from `at` alone, or a lagged input writes a
   * `nextWakeAt` that is already behind the present.
   */
  now: number;
  key: string;
  projectId: string;
  intents: IntentFactories<Intents>;
}

export type EventHandler<State, Data, Intents extends Record<string, IntentSpec<any>>> = (
  state: State,
  data: Data,
  context: ProcessHandlerContext<Intents>,
) => ProcessEvolution<State>;

export type WakeHandler<State, Intents extends Record<string, IntentSpec<any>>> = (
  state: State,
  context: ProcessHandlerContext<Intents>,
) => ProcessEvolution<State>;

export type SignalHandler<State, Data, Intents extends Record<string, IntentSpec<any>>> = (
  state: State,
  data: Data,
  context: ProcessHandlerContext<Intents>,
) => ProcessEvolution<State>;

export interface SignalSpec<
  Schema extends ZodTypeAny = ZodTypeAny,
  State = unknown,
  Intents extends Record<string, IntentSpec<any>> = Record<string, IntentSpec<any>>,
> {
  schema: Schema;
  handle: SignalHandler<State, z.output<Schema>, Intents>;
}

export interface ProcessManagerConfig<
  State,
  Intents extends Record<string, IntentSpec<any>>,
  E extends Event = Event,
> {
  name: string;
  state: State;
  handlers: Record<string, EventHandler<State, unknown, Intents>>;
  eventTypes: readonly string[];
  /**
   * Derives the durable process identity from a committed event (default: the
   * aggregate ID). Deriving it from the event alone lets the generated
   * subscriber reuse it as `groupKeyFn`, draining one instance in one FIFO lane.
   */
  keyBy?: (event: E) => string;
  /** Named, schema-validated synchronous signals accepted by this process. */
  signals?: Record<string, SignalSpec<ZodTypeAny, State, Intents>>;
  onWake?: WakeHandler<State, Intents>;
  /** Narrows event to payload the process sees; required for events carrying customer content. */
  toPayload?: (event: E) => ProcessEventEnvelope["payload"];
  intents: Intents;
  /** Opt in to transient path: events with no state/wake skip durable storage. */
  transient?: boolean;
  outbox?: {
    maxAttempts?: number;
    leaseDurationMs?: number;
    retryDelayMs?: (params: { attempt: number }) => number;
    /** In-flight dispatches per loop. Default 1 (sequential). */
    concurrency?: number;
    /**
     * Messages leased per drain. Bound it to roughly `concurrency` when
     * dispatches are slow (minutes, not seconds), or leased-but-waiting
     * messages sit invisible behind the in-flight ones for the whole lease.
     */
    batchSize?: number;
  };
  schedule?: { everyMs: number };
  readonly _eventType?: E;
}

export interface ProcessManagerDefinition<
  State = unknown,
  Intents extends Record<string, IntentSpec<any>> = Record<string, IntentSpec<any>>,
  E extends Event = Event,
> {
  readonly config: ProcessManagerConfig<State, Intents, E>;
}

export function defineProcessManager<
  State,
  const Intents extends Record<string, IntentSpec<any>>,
  E extends Event = Event,
>(config: ProcessManagerConfig<State, Intents, E>): ProcessManagerDefinition<State, Intents, E> {
  if (
    config.schedule &&
    (!Number.isFinite(config.schedule.everyMs) || config.schedule.everyMs <= 0)
  ) {
    throw new Error(
      `Process manager "${config.name}" schedule everyMs must be a positive finite number`,
    );
  }
  if (config.schedule && !config.onWake) {
    throw new Error(`Process manager "${config.name}" declares a schedule but no onWake handler`);
  }
  if (config.schedule && config.keyBy) {
    throw new Error(
      `Process manager "${config.name}" cannot be keyed and scheduled: a schedule is armed on the singleton instance, which keyBy would move`,
    );
  }
  if (
    config.eventTypes.length === 0 &&
    !config.schedule &&
    Object.keys(config.signals ?? {}).length === 0
  ) {
    throw new Error(
      `Process manager "${config.name}" declares neither an event handler, a signal handler, nor a schedule`,
    );
  }
  return { config };
}

export function buildIntentFactories<Intents extends Record<string, IntentSpec<any>>>(
  intents: Intents,
  options?: { processKey?: string },
): IntentFactories<Intents> {
  const factories: Record<string, unknown> = {};
  for (const [intentType, spec] of Object.entries(intents)) {
    factories[intentType] = (key: string, payload: unknown) => ({
      // ProcessManagerOutbox message keys are unique within
      // (processName, projectId). Builder-authored keys are local to one
      // process instance, so qualify them without burdening every domain.
      messageKey: options?.processKey
        ? `process:${encodeURIComponent(options.processKey)}:${key}`
        : key,
      intentType,
      payload: spec.schema.parse(payload),
    });
  }
  return factories as IntentFactories<Intents>;
}
