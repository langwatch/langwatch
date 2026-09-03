import {
  GroupQueueDependenciesAdapter,
  type GroupQueueDependencies,
  type GroupQueuePolicy,
  type GroupQueueStoragePort,
} from "@langwatch/group-queue";
import {
  RedisConnectionService,
  RedisReadinessService,
  RedisShutdownService,
  type RedisConnection,
  type RedisConfigResolution,
  type RedisLogger,
} from "@langwatch/redis-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { ApiReadinessPort } from "../../api-process.lifecycle";
import { ApiGroupQueueContextAdapter } from "./api-group-queue-context.adapter";

export type ApiQueueInfrastructureOptions = {
  resources: ResourceScope;
  redis: RedisConfigResolution;
  redisLogger?: RedisLogger;
  queuePolicy?: GroupQueuePolicy;
  storage?: GroupQueueStoragePort;
};

/** Reports the composition decision an unconfigured Redis silently used to hide. */
export abstract class ApiQueueAbsenceReportPort {
  abstract absent(reason: "disabled" | "unconfigured"): void;
}

/**
 * API-owned Redis and Group Queue construction. It receives resolved private
 * configuration and borrows storage so the physical API root owns exactly the
 * clients it creates while feature composition retains its own project storage.
 */
export class ApiQueueInfrastructure {
  /**
   * Composes the queue only when Redis is configured.
   *
   * The API process dispatches nothing yet, so an unconfigured Redis is a
   * smaller process rather than a dead one, and the caller is told which is
   * happening. A Redis that IS configured and unusable still fails at boot:
   * degrading that quietly would move the failure to the first request.
   */
  static tryCreate(
    options: ApiQueueInfrastructureOptions & { report?: ApiQueueAbsenceReportPort },
  ): ApiQueueInfrastructure | undefined {
    if (!options.redis.configured) {
      options.report?.absent(options.redis.reason);
      return undefined;
    }
    return ApiQueueInfrastructure.create(options);
  }

  static create(options: ApiQueueInfrastructureOptions): ApiQueueInfrastructure {
    const redis = new RedisConnectionService({ logger: options.redisLogger }).connectResolved({
      config: options.redis,
    });
    if (!redis) {
      throw new Error(
        "API Group Queue infrastructure requires configured Redis: set REDIS_URL or REDIS_CLUSTER_ENDPOINTS.",
      );
    }

    try {
      const queue = GroupQueueDependenciesAdapter.create({
        redis,
        policy: options.queuePolicy,
        storage: options.storage,
        context: ApiGroupQueueContextAdapter.create(),
      });
      const readiness = ApiRedisReadinessAdapter.create({
        connection: redis,
        resolution: options.redis,
        logger: options.redisLogger,
      });
      const infrastructure = new ApiQueueInfrastructure(redis, queue.dependencies(), readiness);
      options.resources.own("API queue infrastructure", () => infrastructure.close());
      return infrastructure;
    } catch (error) {
      void RedisShutdownService.create()
        .shutdown(redis)
        .catch(() => void 0);
      throw error;
    }
  }

  private closing: Promise<void> | undefined;

  private constructor(
    readonly redis: NonNullable<ReturnType<RedisConnectionService["connectResolved"]>>,
    readonly dependencies: GroupQueueDependencies<Record<string, unknown>>,
    readonly readiness: ApiReadinessPort,
  ) {}

  close(): Promise<void> {
    this.closing ??= RedisShutdownService.create().shutdown(this.redis);
    return this.closing;
  }
}

class ApiRedisReadinessAdapter extends ApiReadinessPort {
  static create(options: {
    connection: RedisConnection;
    resolution: RedisConfigResolution;
    logger?: RedisLogger;
  }): ApiRedisReadinessAdapter {
    return new ApiRedisReadinessAdapter(options.connection, options.resolution, options.logger);
  }

  private constructor(
    private readonly connection: RedisConnection,
    private readonly resolution: RedisConfigResolution,
    private readonly logger: RedisLogger | undefined,
  ) {
    super();
  }

  assertReady(): Promise<void> {
    return new RedisReadinessService({ logger: this.logger }).ping({
      connection: this.connection,
      target: readinessTarget(this.resolution),
    });
  }
}

function readinessTarget(resolution: RedisConfigResolution): string {
  if (!resolution.configured) return "(unset)";
  if (resolution.mode === "standalone") return resolution.url;
  return resolution.endpoints.map(({ host, port }) => `${host}:${port}`).join(",");
}
