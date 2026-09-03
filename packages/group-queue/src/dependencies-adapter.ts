import type { Cluster, Redis as IORedis } from "ioredis";
import type {
  GroupQueueActivityPort,
  GroupQueueContextPort,
  GroupQueueDependencies,
  GroupQueueFailureClassifier,
  GroupQueuePolicy,
} from "./contracts";
import type { ObjectStore, ProjectStorageDestination } from "./storage";

export type GroupQueueRedis = IORedis | Cluster;

/**
 * Storage capabilities borrowed by a process-owned queue graph.
 *
 * This is intentionally a port rather than a resource owner: the caller that
 * constructs a storage client remains responsible for closing it. That keeps
 * a shared Redis connection from being disconnected while Eventing or another
 * feature is still draining work.
 */
export interface GroupQueueStoragePort {
  objectStoreFor(projectId: string): ObjectStore;
  resolveDestination(projectId: string): Promise<ProjectStorageDestination>;
}

export type GroupQueueDependenciesAdapterOptions = {
  redis: GroupQueueRedis;
  policy?: GroupQueuePolicy;
  storage?: GroupQueueStoragePort;
  context?: GroupQueueContextPort;
  activity?: GroupQueueActivityPort<Record<string, unknown>>;
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
