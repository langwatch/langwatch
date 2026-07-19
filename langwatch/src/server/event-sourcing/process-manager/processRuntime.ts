import { createLogger, type Logger } from "@langwatch/observability";

import type { Event } from "../domain/types";
import {
  buildIntentFactories,
  type ProcessManagerDefinition,
} from "../pipeline/processManagerDefinition";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import {
  OutboxDispatcherService,
  type IntentHandler,
} from "./outbox/outboxDispatcherService";
import { ProcessOutboxWorker } from "./outbox/processOutboxWorker";
import type { ProcessEventEnvelope } from "./processManager.types";
import { ProcessManagerService } from "./processManagerService";
import type { ProcessStore } from "./stores/processStore.types";
import {
  ProcessWakeWorker,
  type WakeHandlerPort,
} from "./wake/processWakeWorker";

const defaultLogger = createLogger("langwatch:event-sourcing:process-runtime");

export const SCHEDULED_SINGLETON_PROJECT_ID = "__global__" as const;
const SCHEDULE_ARM_EVENT_TYPE = "__schedule_arm" as const;

interface RegisteredProcessManager {
  definition: ProcessManagerDefinition;
  manager: ProcessManagerService<unknown>;
  outboxWorker: ProcessOutboxWorker;
}

export interface GeneratedProcessArtifacts<E extends Event> {
  subscribers: EventSubscriberDefinition<E>[];
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

  constructor(options: {
    store: ProcessStore;
    consumersEnabled: boolean;
    logger?: Logger;
  }) {
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
            processKey: context.aggregateId,
            payload: event.data as ProcessEventEnvelope["payload"],
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

  async stop(): Promise<void> {
    await Promise.all([
      this.wakeWorker?.stop(),
      ...Array.from(this.managers.values(), (manager) =>
        manager.outboxWorker.stop(),
      ),
    ]);
  }

  private registerProcessManager(
    definition: ProcessManagerDefinition,
  ): RegisteredProcessManager {
    const config = definition.config;
    if (this.managers.has(config.name)) {
      throw new Error(
        `Process manager "${config.name}" is mounted by more than one pipeline`,
      );
    }

    const manager = new ProcessManagerService<unknown>({
      definition: {
        name: config.name,
        initialState: config.state,
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
                ? Math.max(input.scheduledFor, input.now) +
                  config.schedule.everyMs
                : (evolution.nextWakeAt ?? null),
              intents: evolution.intents ?? [],
            };
          }

          const envelope = input.event;
          if (envelope.eventType === SCHEDULE_ARM_EVENT_TYPE) {
            return {
              state: previousState,
              nextWakeAt:
                envelope.occurredAt + (config.schedule?.everyMs ?? 0),
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
      },
      store: this.store,
    });

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
    const dispatcher = new OutboxDispatcherService({
      store: this.store,
      handlers,
      maxAttempts: config.outbox?.maxAttempts,
      leaseDurationMs: config.outbox?.leaseDurationMs,
      retryDelayMs: config.outbox?.retryDelayMs,
      processNames: [config.name],
    });
    const outboxWorker = new ProcessOutboxWorker({
      dispatcher,
      logger: this.logger,
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

  private armSchedule({
    registered,
  }: {
    registered: RegisteredProcessManager;
  }): void {
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
