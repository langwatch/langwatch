import type { z, ZodTypeAny } from "zod";

import type { Event } from "../domain/types";
import type { ProcessIntent } from "../process-manager/processManager.types";
import type { DeduplicationStrategy } from "../queues/queue.types";

/** Shared delivery descriptor for lightweight subscribers. */
export type TriggerSpec =
  | { events: readonly string[]; fold?: never; map?: never }
  | { fold: string; events?: readonly string[]; map?: never }
  | { map: string; events?: readonly string[]; fold?: never };

export interface TriggerOptions<E extends Event = Event> {
  delay?: number;
  ttl?: number;
  dedup?: DeduplicationStrategy<E>;
  dedupId?: (event: E) => string;
  when?: (event: E) => boolean;
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

export type IntentFactories<
  Intents extends Record<string, IntentSpec<any>>,
> = {
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
  at: number;
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
  intents: Intents;
  outbox?: {
    maxAttempts?: number;
    leaseDurationMs?: number;
    retryDelayMs?: (params: { attempt: number }) => number;
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
