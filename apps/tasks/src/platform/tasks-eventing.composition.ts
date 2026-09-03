import {
  createEventingGroupQueueFactory,
  EventSourcing,
  EventStoreProducerOnly,
} from "@langwatch/eventing";
import { GroupQueueDependenciesAdapter } from "@langwatch/group-queue";
import type { RedisConnection } from "@langwatch/redis-client";

/** Names this process in a producer-only store's refusals and in queue spans. */
export const TASKS_PROCESS_NAME = "langwatch-tasks";

export type TasksEventingInfrastructureOptions = {
  /** The process's own Redis handle, or absent when `REDIS_URL` is unset. */
  redis: RedisConnection | undefined;
};

/**
 * A minimal PRODUCER-ONLY Eventing host for `apps/tasks`, built the same way
 * `ApiEventingInfrastructure` builds it (`api-eventing.infrastructure.ts`):
 * `consumersEnabled: false`, {@link EventStoreProducerOnly}, and
 * `processManagerMode: "producer-only"`, over this process's own Redis.
 * Rationale: `dev/docs/plans/tasks-launch-interface-and-saas.md`.
 */
export class TasksEventingInfrastructure {
  /** Composes the producer only when this process has Redis. */
  static tryCreate(
    options: TasksEventingInfrastructureOptions,
  ): TasksEventingInfrastructure | undefined {
    if (!options.redis) return undefined;
    return TasksEventingInfrastructure.create({ redis: options.redis });
  }

  static create(options: { redis: RedisConnection }): TasksEventingInfrastructure {
    const queue = GroupQueueDependenciesAdapter.create({ redis: options.redis });
    const eventSourcing = new EventSourcing({
      enabled: true,
      eventStore: EventStoreProducerOnly.create({ processName: TASKS_PROCESS_NAME }),
      processManagerMode: "producer-only",
      queueFactory: createEventingGroupQueueFactory({
        dependencies: queue.dependencies(),
        consumersEnabled: false,
      }),
      consumersEnabled: false,
      executionTarget: "task",
      warnWhenProjectionsRunInline: false,
    });
    return new TasksEventingInfrastructure(eventSourcing);
  }

  private closing: Promise<void> | undefined;

  private constructor(readonly eventSourcing: EventSourcing) {}

  close(): Promise<void> {
    this.closing ??= this.eventSourcing.close();
    return this.closing;
  }
}
