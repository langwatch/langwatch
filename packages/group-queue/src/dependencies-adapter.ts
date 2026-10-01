import type { Cluster, Redis as IORedis } from "ioredis";

import type {
  GroupQueueActivity,
  GroupQueueContext,
  GroupQueueDependencies,
  GroupQueueFailureClassifier,
  GroupQueuePolicy,
} from "./contracts.ts";
import type { ObjectStore, ProjectStorageDestination } from "./storage.ts";

export type GroupQueueRedis = IORedis | Cluster;

/**
 * Storage capabilities borrowed by a process-owned queue graph. A port, not
 * a resource owner: the caller that constructs a storage client stays
 * responsible for closing it, so a shared connection isn't dropped mid-drain.
 */
export interface GroupQueueStorage {
  objectStoreFor(projectId: string): ObjectStore;
  resolveDestination(projectId: string): Promise<ProjectStorageDestination>;
}

export type GroupQueueDependenciesAdapterOptions = {
  redis: GroupQueueRedis;
  policy?: GroupQueuePolicy;
  storage?: GroupQueueStorage;
  context?: GroupQueueContext;
  activity?: GroupQueueActivity<Record<string, unknown>>;
  failures?: GroupQueueFailureClassifier;
};

/**
 * Projects process-composed ports into the queue package's dependency shape.
 * It does not construct or close Redis, storage, queue processors, or AWS
 * clients; those lifetimes belong to the process composition root.
 */
export class GroupQueueDependenciesAdapter {
  static create(options: GroupQueueDependenciesAdapterOptions): GroupQueueDependenciesAdapter {
    return new GroupQueueDependenciesAdapter(options);
  }

  private constructor(private readonly options: GroupQueueDependenciesAdapterOptions) {}

  dependencies(): GroupQueueDependencies<Record<string, unknown>> {
    const { redis, policy, context, activity, failures, storage } = this.options;
    return {
      redis,
      ...(policy ? { policy } : {}),
      ...(context ? { context } : {}),
      ...(activity ? { activity } : {}),
      ...(failures ? { failures } : {}),
      ...(storage
        ? {
            objectStoreFor: (projectId: string) => storage.objectStoreFor(projectId),
            resolveStorageDestination: (projectId: string) => storage.resolveDestination(projectId),
          }
        : {}),
    };
  }
}
