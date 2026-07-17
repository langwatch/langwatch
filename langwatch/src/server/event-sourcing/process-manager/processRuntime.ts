import { createLogger, type Logger } from "@langwatch/observability";

import type { Event } from "../domain/types";
import {
  buildIntentFactories,
  type Fact,
  type ProcessManagerDefinition,
} from "../pipeline/processManagerDefinition";
import type { ReactorDefinition } from "../reactors/reactor.types";
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

/** Sentinel scope for `schedule:`d singletons — the ProcessManager* tables
 *  key by (processName, projectId, processKey) and carry no Project FK. */
export const SCHEDULED_SINGLETON_PROJECT_ID = "__global__" as const;

/** Internal fact type that arms a scheduled singleton's first wake. */
const SCHEDULE_ARM_FACT = "__schedule_arm" as const;

interface RegisteredProcessManager {
  definition: ProcessManagerDefinition;
  manager: ProcessManagerService<unknown>;
  outboxWorker: ProcessOutboxWorker;
}

/** Trigger adapters generated for one pipeline, merged into its service options. */
export interface GeneratedTriggerArtifacts<E extends Event> {
  subscribers: EventSubscriberDefinition<E>[];
  foldReactors: Array<{ foldName: string; definition: ReactorDefinition<E> }>;
  mapReactors: Array<{ mapName: string; definition: ReactorDefinition<E> }>;
}

/**
 * ADR-052 runtime: owns every `withProcessManager`-mounted definition for
 * one EventSourcing instance — the pure evolve dispatch generated from
 * `on:`, the per-PM outbox dispatcher/worker, ONE shared wake worker,
 * schedule arming, worker-role gating, and shutdown. Pipelines declare;
 * the runtime composes. Facts are consumed synchronously (they never
 * persist); intent payloads are schema-parsed at emit and at dispatch.
 */
export class ProcessRuntime {
  private readonly store: ProcessStore;
  private readonly logger: Logger;
  private readonly consumersEnabled: boolean;
  private readonly managers = new Map<string, RegisteredProcessManager>();
  /** Shared across all waking process managers; mutated as they register. */
  private readonly wakeManagers: Record<string, WakeHandlerPort> = {};
  private wakeWorker: ProcessWakeWorker | null = null;

  constructor(options: {
    store: ProcessStore;
    /** Whether this process role runs the outbox/wake loops. */
    consumersEnabled: boolean;
    logger?: Logger;
  }) {
    this.store = options.store;
    this.consumersEnabled = options.consumersEnabled;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Registers one pipeline's mounted process managers and returns the
   * trigger adapters its service options must carry.
   */
  registerPipeline<E extends Event>(params: {
    pipelineName: string;
    processManagers: Map<string, ProcessManagerDefinition>;
  }): GeneratedTriggerArtifacts<E> {
    const artifacts: GeneratedTriggerArtifacts<E> = {
      subscribers: [],
      foldReactors: [],
      mapReactors: [],
    };
    for (const definition of params.processManagers.values()) {
      this.registerProcessManager(definition);
      this.appendTriggerAdapters(definition, artifacts);
    }
    return artifacts;
  }

  /**
   * Cross-pipeline fact port: a plain subscriber on another pipeline calls
   * this to feed a process manager mounted elsewhere. Resolution is lazy by
   * name — by the time events flow, boot registration is complete.
   */
  async publishFacts(params: {
    processName: string;
    sourceEventId: string;
    occurredAt: number;
    tenantId: string;
    facts: Array<Fact<any>>;
  }): Promise<void> {
    const registered = this.managers.get(params.processName);
    if (!registered) {
      throw new Error(
        `Process manager "${params.processName}" is not registered — no pipeline mounted it via withProcessManager`,
      );
    }
    await this.consumeFacts({ registered, ...params });
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.wakeWorker?.stop(),
      ...Array.from(this.managers.values(), (m) => m.outboxWorker.stop()),
    ]);
  }

  private registerProcessManager(definition: ProcessManagerDefinition): void {
    const config = definition.config;
    if (this.managers.has(config.name)) {
      throw new Error(
        `Process manager "${config.name}" is mounted by more than one pipeline — exactly one withProcessManager declaration owns it`,
      );
    }

    const factories = buildIntentFactories(config.intents);
    const manager = new ProcessManagerService<unknown>({
      definition: {
        name: config.name,
        initialState: config.state,
        evolve: ({ previousState, input }) => {
          if (input.kind === "wake") {
            const wake = config.on.wake;
            if (!wake) {
              // A wake with no handler must not re-fire forever.
              return { state: previousState, nextWakeAt: null, intents: [] };
            }
            const evolution = wake(previousState, input.scheduledFor, {
              intents: factories,
            });
            // Scheduled singletons re-arm unconditionally: the schedule is
            // the framework's promise, not the handler's bookkeeping.
            return config.schedule
              ? {
                  ...evolution,
                  nextWakeAt: input.scheduledFor + config.schedule.everyMs,
                }
              : evolution;
          }
          const envelope = input.event;
          if (envelope.eventType === SCHEDULE_ARM_FACT) {
            return {
              state: previousState,
              nextWakeAt:
                envelope.occurredAt + (config.schedule?.everyMs ?? 0),
              intents: [],
            };
          }
          const handler = (
            config.on as Record<
              string,
              (
                state: unknown,
                data: unknown,
                context: unknown,
              ) => { state: unknown; nextWakeAt: number | null; intents: [] }
            >
          )[envelope.eventType];
          if (!handler) {
            // Feeds are statically typed against `on`, so this is
            // unreachable in practice — fail loud, never fabricate state.
            throw new Error(
              `Process manager "${config.name}" received undeclared fact "${envelope.eventType}"`,
            );
          }
          return handler(previousState, envelope.payload, {
            at: envelope.occurredAt,
            key: envelope.processKey,
            projectId: envelope.projectId,
            intents: factories,
          });
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
      // The outbox table is shared across process managers; each PM's
      // worker leases only its own intents.
      processNames: [config.name],
    });
    const outboxWorker = new ProcessOutboxWorker({
      dispatcher,
      logger: this.logger,
    });
    const registered: RegisteredProcessManager = {
      definition,
      manager,
      outboxWorker,
    };
    this.managers.set(config.name, registered);

    if (config.on.wake) {
      this.wakeManagers[config.name] = manager;
      if (!this.wakeWorker) {
        this.wakeWorker = new ProcessWakeWorker({
          store: this.store,
          managers: this.wakeManagers,
          logger: this.logger,
          notifyOutbox: () => {
            for (const m of this.managers.values()) m.outboxWorker.notify();
          },
        });
        if (this.consumersEnabled) this.wakeWorker.start();
      }
    }

    if (this.consumersEnabled) {
      outboxWorker.start();
      if (config.schedule) {
        // Arm the scheduled singleton. Date-keyed sourceEventId: the inbox
        // consumes it once per day, so repeated boots no-op while a wiped
        // instance table self-heals within a day.
        const now = Date.now();
        const day = new Date(now).toISOString().slice(0, 10);
        void this.consumeFacts({
          registered,
          sourceEventId: `schedule-arm:${day}`,
          occurredAt: now,
          tenantId: SCHEDULED_SINGLETON_PROJECT_ID,
          facts: [
            { key: config.name, fact: SCHEDULE_ARM_FACT, data: {} } as Fact<any>,
          ],
        }).catch((error: unknown) => {
          this.logger.error(
            {
              processName: config.name,
              error: error instanceof Error ? error.message : String(error),
            },
            "Schedule arming failed; will retry on next worker boot",
          );
        });
      }
    }
  }

  private appendTriggerAdapters<E extends Event>(
    definition: ProcessManagerDefinition,
    artifacts: GeneratedTriggerArtifacts<E>,
  ): void {
    const config = definition.config;
    const registered = this.managers.get(config.name)!;

    config.triggers.forEach((trigger, index) => {
      const adapterName = `pm:${config.name}:trigger-${index}`;
      const eventFilter =
        trigger.events !== undefined ? new Set<string>(trigger.events) : null;
      const passes = (event: E): boolean => {
        if (eventFilter && !eventFilter.has(event.type)) return false;
        return (trigger.when as ((e: E) => boolean) | undefined)?.(event) ?? true;
      };
      const runFeed = async (
        event: E,
        context: { tenantId: string; aggregateId: string; state: unknown },
      ) => {
        const facts = await trigger.feed(event as never, {
          tenantId: context.tenantId,
          aggregateId: context.aggregateId,
          state: context.state,
        });
        if (facts.length === 0) return;
        await this.consumeFacts({
          registered,
          sourceEventId: event.id,
          occurredAt: event.occurredAt,
          tenantId: context.tenantId,
          facts,
        });
      };

      if (trigger.fold === undefined && trigger.map === undefined) {
        artifacts.subscribers.push({
          name: adapterName,
          eventTypes: trigger.events ?? [],
          options: { delay: trigger.delay, deduplication: trigger.dedup },
          handle: async (event, context) => {
            if (!passes(event)) return;
            await runFeed(event, {
              tenantId: context.tenantId,
              aggregateId: context.aggregateId,
              state: undefined,
            });
          },
        });
        return;
      }

      const reactor: ReactorDefinition<E> = {
        name: adapterName,
        options: {
          makeJobId: (payload: { event: Event; foldState: unknown }) =>
            `${adapterName}:${payload.event.tenantId}:${String(payload.event.aggregateId)}`,
          ttl: trigger.ttl ?? 30_000,
          delay: trigger.delay ?? 0,
        },
        shouldReact: passes,
        handle: async (event, context) => {
          if (!passes(event)) return;
          await runFeed(event, {
            tenantId: context.tenantId,
            aggregateId: context.aggregateId,
            state: context.foldState,
          });
        },
      };
      if (trigger.fold !== undefined) {
        artifacts.foldReactors.push({
          foldName: trigger.fold,
          definition: reactor,
        });
      } else {
        artifacts.mapReactors.push({
          mapName: trigger.map!,
          definition: reactor,
        });
      }
    });
  }

  /**
   * Maps facts to inbox envelopes and hands them to the manager. The
   * envelope id is `${sourceEventId}:${fact.key}` — the inbox consumes
   * each id once per (processName, projectId), and one event may concern
   * several process instances. At most one fact per (event, key).
   */
  private async consumeFacts(params: {
    registered: RegisteredProcessManager;
    sourceEventId: string;
    occurredAt: number;
    tenantId: string;
    facts: Array<Fact<any>>;
  }): Promise<void> {
    for (const fact of params.facts) {
      const envelope: ProcessEventEnvelope = {
        eventId: `${params.sourceEventId}:${fact.key}`,
        eventType: String(fact.fact),
        occurredAt: fact.occurredAt ?? params.occurredAt,
        tenantId: params.tenantId,
        projectId: params.tenantId,
        processKey: fact.key,
        payload: fact.data as ProcessEventEnvelope["payload"],
      };
      const result = await params.registered.manager.handleEvent({
        envelope,
        now: Date.now(),
      });
      if (result.outcome === "revisionConflict") {
        throw new Error(
          `Process manager "${params.registered.definition.config.name}" revision conflict on ${params.sourceEventId} (key ${fact.key}) — retry via queue redelivery`,
        );
      }
      if (result.outcome === "committed") {
        params.registered.outboxWorker.notify();
      }
    }
  }
}
