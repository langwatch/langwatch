import type { ZodTypeAny, z } from "zod";

import type { Event } from "../domain/types";
import type {
  ProcessEventEnvelope,
  ProcessIntent,
} from "../process-manager/processManager.types";
import type { DeduplicationStrategy } from "../queues/queue.types";

type IntentFactories<Intents extends Record<string, IntentSpec<any>>> = {
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
}

export type IntentExecutor<Payload> = (
  payload: Payload,
  context: IntentContext,
) => Promise<void>;

export interface IntentSpec<Schema extends ZodTypeAny = ZodTypeAny> {
  schema: Schema;
  run: IntentExecutor<z.output<Schema>>;
}

export interface ProcessEvolution<State> {
  state: State;
  nextWakeAt?: number | null;
  intents?: ProcessIntent[];
}

export interface ProcessHandlerContext<
  Intents extends Record<string, IntentSpec<any>>,
> {
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

export type EventHandler<
  State,
  Data,
  Intents extends Record<string, IntentSpec<any>>,
> = (
  state: State,
  data: Data,
  context: ProcessHandlerContext<Intents>,
) => ProcessEvolution<State>;

export type WakeHandler<
  State,
  Intents extends Record<string, IntentSpec<any>>,
> = (
  state: State,
  context: ProcessHandlerContext<Intents>,
) => ProcessEvolution<State>;

/**
 * What a process manager may declare about the *staging* of its own delivery,
 * evaluated at fan-out before a job exists (ADR-069 invariant 4).
 *
 * The runtime generates one event subscriber per process manager, and without
 * this the generated subscriber carried no options at all: every declared event
 * type minted a GroupQueue job and a `ProcessManagerInbox` row, and the
 * process's own narrowing ran only after dequeue. On a trace-keyed process that
 * is one durable transition per span. The reactors these processes replaced
 * gated before enqueue; this is where that gate goes now.
 *
 * **Everything declared here MUST be total.** `filter` and `deduplication.makeId`
 * both run on the shared routing-dispatch path, which has no retry: a throw is
 * reported (logged, and surfaced as an `AggregateError` from `dispatch`) but
 * still loses this process's job for that event permanently. A reactor's
 * `shouldReact` was caught and read as `true` — fail-open, never dropped; this
 * seam fails LOST. So only pure field-picks belong here, and every guard that
 * decodes, reads a flag or touches a store stays in the handler, where a throw
 * re-delivers that one job (ADR-075, "The one migration hazard").
 *
 * Three subscriber options are deliberately NOT exposed:
 *
 * - `stage` (the claim-check swap) — it changes the staged event's TYPE, and a
 *   worker on the previous build silently *completes* a job whose type it does
 *   not recognise. That is a deploy-order contract (consumer half one release
 *   ahead), not a line in a process definition.
 * - `groupKeyFn` — the generated subscriber's group is the aggregate, which is
 *   what serializes one process instance's inbox writes. Re-keying it would let
 *   two events for the same process key be handled concurrently.
 * - `disabled` / `killSwitch` — a killed subscriber drops events, and a process
 *   manager's events are durable work with a deadline behind them.
 */
export interface ProcessManagerEnqueueOptions<E extends Event = Event> {
  /**
   * Decides whether this event stages a job at all. `false` → no job, no inbox
   * row, no transition. Total predicates only — see the interface docblock.
   *
   * A handler must stay correct for events its filter would have declined: jobs
   * staged by a build without the filter can still be draining.
   */
  filter?: (event: E) => boolean;
  /**
   * Collapses a burst into one delivery per window. `makeId` is total for the
   * same reason `filter` is.
   *
   * A process SEES FEWER EVENTS under a dedup window, so the key must separate
   * events that would drive different transitions — collapse only what is
   * decision-equivalent. Keying on the process's own narrowed view is the
   * straightforward way to get that: two events that narrow to the same view
   * are interchangeable to the process by construction.
   */
  deduplication?: DeduplicationStrategy<E>;
  /** Holds the staged job for a window, so the dedup above has one to collapse into. */
  delay?: number;
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
  onWake?: WakeHandler<State, Intents>;
  /**
   * Narrows a committed event to the payload the process is allowed to see.
   * Defaults to the raw `event.data`.
   *
   * Any domain whose events carry customer content MUST supply this. The
   * payload is persisted verbatim into process state and outbox rows, so the
   * default is only safe for events that are already identities-and-flags.
   * Building the narrowed view here is the boundary — the process never sees
   * prompts, parts, tool output, titles, or tokens at all.
   */
  toPayload?: (event: E) => ProcessEventEnvelope["payload"];
  /** @see ProcessManagerEnqueueOptions */
  enqueue?: ProcessManagerEnqueueOptions<E>;
  intents: Intents;
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
  Intents extends Record<string, IntentSpec<any>> = Record<
    string,
    IntentSpec<any>
  >,
  E extends Event = Event,
> {
  readonly config: ProcessManagerConfig<State, Intents, E>;
}

export function defineProcessManager<
  State,
  const Intents extends Record<string, IntentSpec<any>>,
  E extends Event = Event,
>(
  config: ProcessManagerConfig<State, Intents, E>,
): ProcessManagerDefinition<State, Intents, E> {
  if (
    config.schedule &&
    (!Number.isFinite(config.schedule.everyMs) || config.schedule.everyMs <= 0)
  ) {
    throw new Error(
      `Process manager "${config.name}" schedule everyMs must be a positive finite number`,
    );
  }
  if (config.schedule && !config.onWake) {
    throw new Error(
      `Process manager "${config.name}" declares a schedule but no onWake handler`,
    );
  }
  if (config.eventTypes.length === 0 && !config.schedule) {
    throw new Error(
      `Process manager "${config.name}" declares neither an event handler nor a schedule`,
    );
  }
  return { config };
}

export function buildIntentFactories<
  Intents extends Record<string, IntentSpec<any>>,
>(
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
