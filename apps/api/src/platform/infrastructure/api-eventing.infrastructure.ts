import {
  createEventingGroupQueueFactory,
  EventSourcing,
  EventStoreProducerOnly,
} from "@langwatch/eventing";
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import type { ResourceScope } from "@langwatch/runtime-composition";

/** Reports the composition decision an absent queue would otherwise hide. */
export abstract class ApiEventingAbsenceReportPort {
  abstract absent(): void;
}

/**
 * The one thing this needs of the process's queue.
 *
 * Declared structurally rather than as `ApiQueueInfrastructure`, because what
 * it uses is the Group Queue dependency object and nothing else — not the
 * Redis connection, not the readiness gate. Naming the class would have made
 * this composable only where a real Redis exists.
 */
export type ApiEventingQueue = Readonly<{
  dependencies: GroupQueueDependencies<Record<string, unknown>>;
}>;

export type ApiEventingInfrastructureOptions = {
  resources: ResourceScope;
  /** The process's one Group Queue: the same Redis every other dispatch uses. */
  queue: ApiEventingQueue;
  /** Names this process in a producer-only store's refusals. */
  processName: string;
};

/**
 * API-owned Eventing construction: a PRODUCER, and only ever a producer.
 *
 * The API process sends commands; the worker process claims
 * `event-sourcing/jobs` and runs the handlers, appends their events and folds
 * their projections. That split is location-independent by construction —
 * routing metadata is stamped from the pipeline and command NAMES at send
 * time, so a command this process enqueues is routed by the consumer's own
 * registry rather than by which process produced it.
 *
 * Three decisions make the producer-only property structural rather than
 * something a composition root has to keep true:
 *
 *  - `consumersEnabled: false`, so the Group Queue factory builds a producer
 *    and starts no consumer loop. Two processes claiming one shared queue is
 *    the failure the worker cutover exists to prevent: a claimant that has not
 *    registered every pipeline rejects and redelivers the rest forever.
 *  - {@link EventStoreProducerOnly}, so there is no event log in this process
 *    to read or append. A memory store in that seat would accept an append and
 *    lose it; omitting the store entirely is worse still, because the runtime
 *    answers a store-less registration with a pipeline that drops commands
 *    silently.
 *  - No `ProcessStore`. A process manager's inbox, outbox and wakes are the
 *    consumer's work, and a pipeline that declared one would refuse to
 *    register here rather than half-run.
 *
 * It exists only where the queue does. Redis is what a command is enqueued
 * into, so a process without one cannot produce, and pretending otherwise
 * would move the failure from boot to the first grant a customer changes.
 */
export class ApiEventingInfrastructure {
  /**
   * Composes the producer only when this process has a Group Queue.
   *
   * An absent queue is an absent Redis, which the queue infrastructure has
   * already announced; this reports the consequence rather than the cause, so
   * a deployment reads "no dispatch" from its logs instead of inferring it.
   */
  static tryCreate(
    options: Omit<ApiEventingInfrastructureOptions, "queue"> & {
      queue: ApiEventingQueue | undefined;
      report?: ApiEventingAbsenceReportPort;
    },
  ): ApiEventingInfrastructure | undefined {
    if (!options.queue) {
      options.report?.absent();
      return undefined;
    }
    return ApiEventingInfrastructure.create({ ...options, queue: options.queue });
  }

  static create(options: ApiEventingInfrastructureOptions): ApiEventingInfrastructure {
    const eventSourcing = new EventSourcing({
      enabled: true,
      eventStore: EventStoreProducerOnly.create({ processName: options.processName }),
      queueFactory: createEventingGroupQueueFactory({
        dependencies: options.queue.dependencies,
        consumersEnabled: false,
      }),
      consumersEnabled: false,
      executionTarget: "api",
      warnWhenProjectionsRunInline: false,
    });

    const infrastructure = new ApiEventingInfrastructure(eventSourcing);
    // Registered after the queue owns its Redis, so the reverse close order
    // drains this producer before the connection under it goes away.
    options.resources.own("API eventing infrastructure", () => infrastructure.close());
    return infrastructure;
  }

  private closing: Promise<void> | undefined;

  private constructor(readonly eventSourcing: EventSourcing) {}

  close(): Promise<void> {
    this.closing ??= this.eventSourcing.close();
    return this.closing;
  }
}
