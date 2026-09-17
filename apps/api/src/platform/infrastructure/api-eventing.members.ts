import {
  createEventingGroupQueueFactory,
  EventSourcing,
  EventStoreProducerOnly,
  type KillSwitch,
} from "@langwatch/eventing";
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import type { ResourceScope } from "@langwatch/kernel";

/** Reports the composition decision an absent queue would otherwise hide. */
export abstract class ApiEventingAbsenceReport {
  abstract absent(): void;
}

/**
 * The one thing this needs of the process's queue. Structural rather than
 * `ApiQueueInfrastructure`: only the Group Queue dependency object is used,
 * not the Redis connection or gate — naming the class would need real Redis.
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
  /**
   * Per-tenant operator stop for the commands this producer sends. Absent
   * leaves every command running, which is what a process with no flag store
   * can honestly answer.
   */
  killSwitch?: KillSwitch;
};

// API eventing producer only. Configured with consumersEnabled: false,
// EventStoreProducerOnly, and processManagerMode: producer-only.
export class ApiEventingInfrastructure {
  /**
   * Composes the producer only when this process has a Group Queue. An
   * absent queue is an absent Redis, already announced elsewhere; this
   * reports the consequence, so logs read "no dispatch" instead of inferring it.
   */
  static tryCreate(
    options: Omit<ApiEventingInfrastructureOptions, "queue"> & {
      queue: ApiEventingQueue | undefined;
      report?: ApiEventingAbsenceReport;
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
      processManagerMode: "producer-only",
      queueFactory: createEventingGroupQueueFactory({
        dependencies: options.queue.dependencies,
        consumersEnabled: false,
      }),
      consumersEnabled: false,
      executionTarget: "api",
      ...(options.killSwitch ? { killSwitch: options.killSwitch } : {}),
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
