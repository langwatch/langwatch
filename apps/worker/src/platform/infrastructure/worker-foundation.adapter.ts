import { AwsClientProcessRuntime, type OutboundProxyResolverPort } from "@langwatch/aws-client";
import {
  GroupQueueDependenciesAdapter,
  type GroupQueueDependencies,
  type GroupQueuePolicy,
  type GroupQueueStoragePort,
} from "@langwatch/group-queue";
import {
  RedisConnectionService,
  RedisShutdownService,
  type RedisConfigResolution,
  type RedisLogger,
} from "@langwatch/redis-client";
import { StoredObjectStorageRuntime } from "@langwatch/stored-object-server/storage";
import { ResourceScope } from "@langwatch/runtime-composition";
import { WorkerStoredObjectStorageRuntimeFactory } from "./worker-stored-object-storage.adapter";

/** Named construction port for the storage implementation owned by a host. */
export type WorkerStorageLease = {
  storage: GroupQueueStoragePort;
  close(): Promise<void>;
};

export abstract class WorkerStorageFactoryPort {
  abstract create(options: { aws: AwsClientProcessRuntime }): WorkerStorageLease;
}

/** Adapts the canonical Stored Object project view to Group Queue's port. */
export class WorkerStoredObjectStorageFactory extends WorkerStorageFactoryPort {
  static create(options: {
    runtime: StoredObjectStorageRuntime;
  }): WorkerStoredObjectStorageFactory {
    return new WorkerStoredObjectStorageFactory(options.runtime);
  }

  private constructor(private readonly runtime: StoredObjectStorageRuntime) {
    super();
  }

  create(_options: { aws: AwsClientProcessRuntime }): WorkerStorageLease {
    return {
      storage: {
        objectStoreFor: (projectId) => this.runtime.forProject(projectId, _options.aws).objectStore,
        resolveDestination: (projectId) =>
          this.runtime.forProject(projectId, _options.aws).resolveDestination(),
      },
      close: async () => {},
    };
  }
}

export type WorkerInfrastructureAdapterOptions = {
  resources: ResourceScope;
  redis: RedisConfigResolution;
  redisLogger?: RedisLogger;
  queuePolicy?: GroupQueuePolicy;
  outboundProxy: OutboundProxyResolverPort;
  storage?: WorkerStorageFactoryPort;
  storageRuntime?: StoredObjectStorageRuntime;
  storedObjectStorage?: WorkerStoredObjectStorageRuntimeFactory;
};

/**
 * The Worker-owned transport foundation for Group Queue, object storage, and
 * AWS clients. Inputs are already-resolved semantic values; this adapter does
 * not read environment modules or enable Eventing consumers.
 */
export class WorkerInfrastructureAdapter {
  static create(options: WorkerInfrastructureAdapterOptions): WorkerInfrastructureAdapter {
    const redis = new RedisConnectionService({ logger: options.redisLogger }).connectResolved({
      config: options.redis,
    });
    if (!redis) {
      throw new Error("Worker Group Queue infrastructure requires configured Redis");
    }

    const aws = AwsClientProcessRuntime.create({ outboundProxy: options.outboundProxy });
    let storage: WorkerStorageLease | undefined;
    try {
      const storageFactory =
        options.storage ??
        (options.storageRuntime || options.storedObjectStorage
          ? WorkerStoredObjectStorageFactory.create({
              runtime: options.storageRuntime ?? options.storedObjectStorage!.createRuntime(),
            })
          : undefined);
      storage = storageFactory?.create({ aws });
      const queue = GroupQueueDependenciesAdapter.create({
        redis,
        policy: options.queuePolicy,
        storage: storage?.storage,
      });
      const adapter = new WorkerInfrastructureAdapter(redis, aws, storage, queue.dependencies());
      options.resources.own("worker infrastructure clients", () => adapter.close());
      return adapter;
    } catch (error) {
      return closeAfterCompositionFailure({ redis, aws, storage, error });
    }
  }

  private closePromise: Promise<void> | undefined;

  private constructor(
    readonly redis: NonNullable<ReturnType<RedisConnectionService["connectResolved"]>>,
    readonly aws: AwsClientProcessRuntime,
    private readonly storage: WorkerStorageLease | undefined,
    readonly queueDependencies: GroupQueueDependencies<Record<string, unknown>>,
  ) {}

  /** Closes only resources constructed by this adapter, retaining the first failure. */
  close(): Promise<void> {
    this.closePromise ??= this.closeOwnedResources();
    return this.closePromise;
  }

  private async closeOwnedResources(): Promise<void> {
    let firstError: unknown;

    try {
      await this.storage?.close();
    } catch (error) {
      firstError = error;
    }

    try {
      await this.aws.close();
    } catch (error) {
      firstError ??= error;
    }

    try {
      await RedisShutdownService.create().shutdown(this.redis);
    } catch (error) {
      firstError ??= error;
    }

    if (firstError) throw firstError;
  }
}

function closeAfterCompositionFailure({
  redis,
  aws,
  storage,
  error,
}: {
  redis: NonNullable<ReturnType<RedisConnectionService["connectResolved"]>>;
  aws: AwsClientProcessRuntime;
  storage: WorkerStorageLease | undefined;
  error: unknown;
}): never {
  // Storage factories return an explicit lease, so their owned resources are
  // released alongside the AWS and Redis resources constructed here. Cleanup
  // is deliberately fire-and-forget because this function cannot replace the
  // root composition error with a secondary close failure.
  void Promise.resolve()
    .then(() => storage?.close())
    .catch(() => void 0);
  void Promise.resolve()
    .then(() => aws.close())
    .catch(() => void 0);
  void Promise.resolve()
    .then(() => redis.disconnect())
    .catch(() => void 0);
  throw error;
}
