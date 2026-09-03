import { createLogger, type Logger } from "@langwatch/observability";

import type { Event } from "../domain/types";
import {
  buildIntentFactories,
  type ProcessManagerDefinition,
} from "../pipeline/processManagerDefinition";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import {
  DEFAULT_LEASE_DURATION_MS,
  type IntentHandler,
  OutboxDispatcherService,
} from "./outbox/outboxDispatcherService";
import { ProcessOutboxWorker } from "./outbox/processOutboxWorker";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessSignalEnvelope,
} from "./processManager.types";
import { ProcessManagerService, type SignalHandleResult } from "./processManagerService";
import type { ProcessStore } from "./stores/processStore.types";
import { ProcessWakeWorker, type WakeHandlerPort } from "./wake/processWakeWorker";

const defaultLogger = createLogger("langwatch:event-sourcing:process-runtime");

const STUCK_DRAIN_LEASE_MULTIPLE = 5;
const STUCK_DRAIN_FLOOR_MS = 300_000;

/**
 * Far above any legitimate drain (a full batch of slow deliveries fits in one
 * lease), so only a never-settling delivery trips it.
 */
function stuckDrainTimeoutMs(leaseDurationMs: number | undefined): number {
  return Math.max(
    STUCK_DRAIN_LEASE_MULTIPLE * (leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS),
    STUCK_DRAIN_FLOOR_MS,
  );
}

export const SCHEDULED_SINGLETON_PROJECT_ID = "__global__" as const;
/** The synthetic event that arms a scheduled process's first wake. Exported
 *  so a test drives the same value the runtime does, rather than copying the
 *  literal and drifting from it. */
export const SCHEDULE_ARM_EVENT_TYPE = "__schedule_arm" as const;

interface RegisteredProcessManager {
  definition: ProcessManagerDefinition;
  manager: ProcessManagerService<unknown>;
  outboxWorker: ProcessOutboxWorker;
}

export interface GeneratedProcessArtifacts<E extends Event> {
  subscribers: EventSubscriberDefinition<E>[];
}

/**
 * The outbox intent handlers a builder config generates: schema-validate the
 * leased payload, then hand it to the declared executor with the dispatch
 * context. Exported for the same reason as {@link buildProcessDefinition}.
 */
export function buildIntentHandlers(
  config: ProcessManagerDefinition["config"],
): Record<string, IntentHandler> {
  const handlers: Record<string, IntentHandler> = {};
  for (const [intentType, spec] of Object.entries(config.intents)) {
    handlers[intentType] = async ({ message }) => {
      await spec.run(spec.schema.parse(message.payload), {
        processName: message.processName,
        projectId: message.projectId,
        processKey: message.processKey,
        tenantId: message.tenantId,
        messageKey: message.messageKey,
        attempt: message.attempt,
      });
    };
  }
  return handlers;
}

/**
 * The runtime-facing ProcessDefinition a builder config generates. Exported
 * so tests (and future domains' harnesses) can drive the EXACT evolve the
 * runtime runs — clamping, schedule arming, undeclared-event guard and all —
 * instead of re-implementing it around the raw handlers.
 */
export function buildProcessDefinition(
  config: ProcessManagerDefinition["config"],
): ProcessDefinition<unknown> {
  const signalSpecs = config.signals ?? {};
  return {
    name: config.name,
    initialState: config.state,
    ...(config.transient ? { transient: true } : {}),
    evolve: ({ previousState, input, ref }) => {
      const factories = buildIntentFactories(config.intents, {
        processKey: ref.processKey,
      });
      if (input.kind === "wake") {
        if (!config.onWake) {
          return { state: previousState, nextWakeAt: null, intents: [] };
        }
        const evolution = config.onWake(previousState, {
          at: input.scheduledFor,
          now: input.now,
          key: ref.processKey,
          projectId: ref.projectId,
          intents: factories,
        });
        return {
          state: evolution.state,
          // Rearm from the present, not from the slot we missed. A wake
          // that fires days late must schedule the NEXT slot from now, or
          // every skipped interval is replayed back-to-back on recovery.
          nextWakeAt: config.schedule
            ? Math.max(input.scheduledFor, input.now) + config.schedule.everyMs
            : (evolution.nextWakeAt ?? null),
          intents: evolution.intents ?? [],
        };
      }

      const envelope = input.event;
      if (envelope.eventType === SCHEDULE_ARM_EVENT_TYPE) {
        return {
          state: previousState,
          nextWakeAt: Math.max(envelope.occurredAt, input.now) + (config.schedule?.everyMs ?? 0),
          intents: [],
        };
      }

      const handler = config.handlers[envelope.eventType];
      if (!handler) {
        throw new Error(
          `Process manager "${config.name}" received undeclared event "${envelope.eventType}"`,
        );
      }
      const evolution = handler(previousState, envelope.payload, {
        at: envelope.occurredAt,
        now: input.now,
        key: envelope.processKey,
        projectId: envelope.projectId,
        intents: factories,
      });
      return {
        state: evolution.state,
        nextWakeAt: evolution.nextWakeAt ?? null,
        intents: evolution.intents ?? [],
      };
    },
    ...(Object.keys(signalSpecs).length > 0
      ? {
          evolveSignal: ({ previousState, signal, now, ref }) => {
            const spec = signalSpecs[signal.signalType];
            if (!spec) {
              throw new Error(
                `Process manager "${config.name}" received undeclared signal "${signal.signalType}"`,
              );
            }
            const factories = buildIntentFactories(config.intents, {
              processKey: ref.processKey,
            });
            const evolution = spec.handle(previousState, spec.schema.parse(signal.payload), {
              at: signal.occurredAt,
              now,
              key: signal.processKey,
              projectId: signal.projectId,
              intents: factories,
            });
            return {
              state: evolution.state,
              nextWakeAt: evolution.nextWakeAt ?? null,
              intents: evolution.intents ?? [],
            };
          },
        }
      : {}),
  };
}

/**
 * Owns process managers mounted on event-sourced pipelines. A generated live
 * subscriber hands committed events straight to the transactional inbox; no
 * feed, fact port, or second delivery mechanism exists between them.
 */
export class ProcessRuntime {
  private readonly store: ProcessStore;
  private readonly logger: Logger;
  private readonly consumersEnabled: boolean;
  private readonly managers = new Map<string, RegisteredProcessManager>();
  private readonly wakeManagers: Record<string, WakeHandlerPort> = {};
  private wakeWorker: ProcessWakeWorker | null = null;

  constructor(options: { store: ProcessStore; consumersEnabled: boolean; logger?: Logger }) {
    this.store = options.store;
    this.consumersEnabled = options.consumersEnabled;
    this.logger = options.logger ?? defaultLogger;
  }

  registerPipeline<E extends Event>(params: {
    pipelineName: string;
    processManagers: Map<string, ProcessManagerDefinition>;
  }): GeneratedProcessArtifacts<E> {
    const subscribers: EventSubscriberDefinition<E>[] = [];
    for (const definition of params.processManagers.values()) {
      const registered = this.registerProcessManager(definition);
      if (definition.config.eventTypes.length === 0) continue;
      subscribers.push({
        name: `pm:${definition.config.name}`,
        eventTypes: definition.config.eventTypes,
        handle: async (event, context) => {
          const processKey = definition.config.keyBy?.(event) ?? context.aggregateId;
          if (processKey.trim().length === 0) {
            throw new Error(
              `Process manager "${definition.config.name}" derived an empty process key for event ${event.id}`,
            );
          }
          const envelope: ProcessEventEnvelope = {
            // The event log can briefly expose two physical rows before its
            // ReplacingMergeTree merges a redelivered command. The inbox owns
            // logical consumption, so use the command's deterministic key
            // when present and fall back to the physical event id otherwise.
            eventId: event.idempotencyKey ?? event.id,
            eventType: event.type,
            occurredAt: event.occurredAt,
            tenantId: context.tenantId,
            projectId: context.tenantId,
            processKey,
            // `toPayload` is the content boundary. Without one the raw event
            // data is persisted into process state and outbox rows verbatim.
            payload: definition.config.toPayload
              ? definition.config.toPayload(event)
              : (event.data as ProcessEventEnvelope["payload"]),
          };
          const result = await registered.manager.handleEvent({
            envelope,
            now: Date.now(),
          });
          if (result.outcome === "revisionConflict") {
            throw new Error(
              `Process manager "${definition.config.name}" revision conflict on event ${event.id}`,
            );
          }
          if (result.outcome === "committed") {
            registered.outboxWorker.notify();
          }
        },
      });
    }
    return { subscribers };
  }

  /**
   * Routes a synchronous signal to a process manager already mounted on this
   * runtime. The returned state is committed (or the state observed for an
   * idempotent retry); callers never need direct access to the process store.
   */
  async signal<State = unknown>(params: {
    processName: string;
    signal: ProcessSignalEnvelope;
    now?: number;
    /** Establish revision 1 from the process's initial state when absent. */
    createIfMissing?: boolean;
  }): Promise<SignalHandleResult<State>> {
    const registered = this.managers.get(params.processName);
    if (!registered) {
      throw new Error(`Process manager "${params.processName}" is not registered`);
    }

    const result = await registered.manager.handleSignal({
      signal: params.signal,
      now: params.now ?? Date.now(),
      createIfMissing: params.createIfMissing,
    });
    if (result.outcome === "committed" || result.outcome === "duplicateSignal") {
      // The duplicate path may be recovery after the first response was lost;
      // nudging again is cheap and closes the analogous notification-loss
      // window. Periodic polling remains the crash-recovery guarantee.
      registered.outboxWorker.notify();
    }
    return result as SignalHandleResult<State>;
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.wakeWorker?.stop(),
      ...Array.from(this.managers.values(), (manager) => manager.outboxWorker.stop()),
    ]);
  }

  private registerProcessManager(definition: ProcessManagerDefinition): RegisteredProcessManager {
    const config = definition.config;
    if (this.managers.has(config.name)) {
      throw new Error(`Process manager "${config.name}" is mounted by more than one pipeline`);
    }

    const manager = new ProcessManagerService<unknown>({
      definition: buildProcessDefinition(config),
      store: this.store,
    });

    const dispatcher = new OutboxDispatcherService({
      store: this.store,
      handlers: buildIntentHandlers(config),
      maxAttempts: config.outbox?.maxAttempts,
      leaseDurationMs: config.outbox?.leaseDurationMs,
      retryDelayMs: config.outbox?.retryDelayMs,
      concurrency: config.outbox?.concurrency,
      processNames: [config.name],
    });
    const outboxWorker = new ProcessOutboxWorker({
      dispatcher,
      logger: this.logger,
      name: config.name,
      batchSize: config.outbox?.batchSize,
      stuckDrainTimeoutMs: stuckDrainTimeoutMs(config.outbox?.leaseDurationMs),
    });
    const registered = { definition, manager, outboxWorker };
    this.managers.set(config.name, registered);

    if (config.onWake) {
      this.wakeManagers[config.name] = manager;
      if (!this.wakeWorker) {
        this.wakeWorker = new ProcessWakeWorker({
          store: this.store,
          managers: this.wakeManagers,
          logger: this.logger,
          notifyOutbox: () => {
            for (const item of this.managers.values()) {
              item.outboxWorker.notify();
            }
          },
        });
        if (this.consumersEnabled) this.wakeWorker.start();
      }
    }

    if (this.consumersEnabled) {
      outboxWorker.start();
      if (config.schedule) this.armSchedule({ registered });
    }
    return registered;
  }

  private armSchedule({ registered }: { registered: RegisteredProcessManager }): void {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const processName = registered.definition.config.name;
    void registered.manager
      .handleEvent({
        envelope: {
          eventId: `schedule-arm:${day}`,
          eventType: SCHEDULE_ARM_EVENT_TYPE,
          occurredAt: now,
          tenantId: SCHEDULED_SINGLETON_PROJECT_ID,
          projectId: SCHEDULED_SINGLETON_PROJECT_ID,
          processKey: processName,
          payload: {},
        },
        now,
      })
      .catch((error: unknown) => {
        this.logger.error(
          {
            processName,
            error: error instanceof Error ? error.message : String(error),
          },
          "Schedule arming failed; the next worker boot will retry",
        );
      });
  }
}
