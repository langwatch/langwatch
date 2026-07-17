import type { z, ZodTypeAny } from "zod";

import type { Event } from "../domain/types";
import type {
  Evolution,
  ProcessIntent,
} from "../process-manager/processManager.types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/**
 * ADR-052 — the process manager as one declarative config object.
 *
 * Two primitives cover every reaction in the system:
 *
 *   withSubscriber(name, { events | fold | map, handler, … })   best-effort
 *   withProcessManager(defineProcessManager({ … }))             promised
 *
 * The trigger descriptor is shared by both and tells you two things at
 * once: WHEN you fire (raw event delivery, or staged after the named
 * projection commits this event) and WHAT you may trust reading (a
 * `fold`/`map` trigger guarantees the projection's store is ≥ this event).
 *
 * A process manager's inputs ride the same Redis GroupQueue as everything
 * else; from `feed()`'s Postgres commit onward (inbox + state + outbox in
 * one transaction) delivery is Postgres-driven and survives Redis loss.
 *
 * Facts (feed results) are consumed synchronously and never persist, so
 * they are typed by TypeScript alone. Intent payloads DO persist (outbox
 * rows), so they carry zod schemas, parsed at emit and at dispatch.
 */

/** One fact a feed addresses to one process instance. */
export type Fact<Facts, K extends keyof Facts = keyof Facts> = {
  [F in K]: {
    /** The process instance this fact concerns (e.g. a triggerId). */
    key: string;
    fact: F;
    data: Facts[F];
    /** Defaults to the source event's occurredAt. */
    occurredAt?: number;
  };
}[K];

/**
 * Trigger descriptor. Two orthogonal dimensions:
 *
 * - SEQUENCING — `fold`/`map` stages the handler after that projection has
 *   committed this event (its store is then trustworthy ≥ this event);
 *   neither means raw event delivery.
 * - FILTER — `events` narrows which event types fire it at all. Omitted on
 *   a `fold`/`map` trigger = every event that touches the projection.
 */
export type TriggerSpec =
  | { events: readonly string[]; fold?: never; map?: never }
  | { fold: string; events?: readonly string[]; map?: never }
  | { map: string; events?: readonly string[]; fold?: never };

export interface TriggerOptions<E extends Event = Event> {
  /** Delay before the handler runs (ms). */
  delay?: number;
  /** Collapse window for `fold`/`map` triggers (per-aggregate latest-wins). */
  ttl?: number;
  /** Dedup/debounce config for `events` triggers. */
  dedup?: DeduplicationStrategy<E>;
  /** Pure pre-enqueue guard — rejects before the queue pays serialization. */
  when?: (event: E) => boolean;
}

/**
 * Handler/feed context. For `fold`/`map` triggers, `state` is the
 * projection's committed state for this aggregate — the executor already
 * holds it in memory and it is sequenced ≥ this event, so reading it here
 * beats a store round-trip. Raw `events` triggers carry no state.
 */
export interface TriggerContext<State = unknown> {
  tenantId: string;
  aggregateId: string;
  state: State;
}

export type FeedFn<E extends Event, Facts, ProjState = unknown> = (
  event: E,
  context: TriggerContext<ProjState>,
) => Promise<Array<Fact<Facts>>>;

export type ProcessManagerTrigger<E extends Event, Facts> = TriggerSpec &
  TriggerOptions<E> & { feed: FeedFn<E, Facts, any> };

/** Typed intent factories — the only way an `on` handler emits an intent. */
export type IntentFactories<
  Intents extends Record<string, IntentSpec<any>>,
> = {
  [K in keyof Intents & string]: (params: {
    /** Deterministic idempotency key within (processName, projectId). */
    key: string;
    payload: z.input<Intents[K]["schema"]>;
  }) => ProcessIntent;
};

export interface IntentContext {
  processName: string;
  projectId: string;
  processKey: string;
  tenantId: string;
  messageKey: string;
  attempt: number;
}

/** The executor the outbox worker calls when it leases an intent row. */
export type IntentExecutor<Payload> = (
  payload: Payload,
  context: IntentContext,
) => Promise<void>;

export interface IntentSpec<Schema extends ZodTypeAny = ZodTypeAny> {
  schema: Schema;
  run: IntentExecutor<z.output<Schema>>;
}

export type FactHandler<
  State,
  Data,
  Intents extends Record<string, IntentSpec<any>>,
> = (
  state: State,
  data: Data,
  context: {
    at: number;
    key: string;
    projectId: string;
    intents: IntentFactories<Intents>;
  },
) => Evolution<State>;

export type WakeHandler<
  State,
  Intents extends Record<string, IntentSpec<any>>,
> = (
  state: State,
  scheduledFor: number,
  context: { intents: IntentFactories<Intents> },
) => Evolution<State>;

export interface ProcessManagerConfig<
  State,
  Facts,
  Intents extends Record<string, IntentSpec<any>>,
  E extends Event = Event,
> {
  name: string;
  /** State an unseen process key starts from. */
  state: State;
  /** Where facts come from, on the declaring pipeline. */
  triggers: Array<ProcessManagerTrigger<E, Facts>>;
  /** Pure decisions: one handler per fact, plus optional `wake`. */
  on: { [K in keyof Facts]: FactHandler<State, Facts[K], Intents> } & {
    wake?: WakeHandler<State, Intents>;
  };
  intents: Intents;
  outbox?: {
    maxAttempts?: number;
    leaseDurationMs?: number;
    retryDelayMs?: (params: { attempt: number }) => number;
  };
  /**
   * Standing schedule for singleton sweeps: the runtime keeps a
   * `(projectId "__global__", key = name)` instance armed so `on.wake`
   * fires every `everyMs` — no events required. Requires `on.wake`.
   */
  schedule?: { everyMs: number };
}

/** The built artifact `withProcessManager` mounts. Opaque to callers. */
export interface ProcessManagerDefinition<
  State = unknown,
  Facts = any,
  Intents extends Record<string, IntentSpec<any>> = Record<
    string,
    IntentSpec<any>
  >,
  E extends Event = Event,
> {
  readonly config: ProcessManagerConfig<State, Facts, Intents, E>;
}

export function defineProcessManager<
  State,
  Facts,
  const Intents extends Record<string, IntentSpec<any>>,
  E extends Event = Event,
>(
  config: ProcessManagerConfig<State, Facts, Intents, E>,
): ProcessManagerDefinition<State, Facts, Intents, E> {
  if (config.schedule && !config.on.wake) {
    throw new Error(
      `Process manager "${config.name}" declares a schedule but no on.wake handler`,
    );
  }
  return { config };
}

export function buildIntentFactories<
  Intents extends Record<string, IntentSpec<any>>,
>(intents: Intents): IntentFactories<Intents> {
  const factories = {} as Record<string, unknown>;
  for (const [intentType, spec] of Object.entries(intents)) {
    factories[intentType] = (params: { key: string; payload: unknown }) => ({
      messageKey: params.key,
      intentType,
      // Parse at emit so a malformed payload fails the evolution (queue
      // redelivers) instead of poisoning a persisted outbox row.
      payload: spec.schema.parse(params.payload),
    });
  }
  return factories as IntentFactories<Intents>;
}

/** Subscriber declaration — the best-effort primitive. */
export type SubscriberSpec<E extends Event = Event> = TriggerSpec &
  TriggerOptions<E> & {
    handler: (event: E, context: TriggerContext<any>) => Promise<void>;
  };
