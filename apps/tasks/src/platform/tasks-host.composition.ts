import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  RedisConnectionService,
  RedisShutdownService,
  type RedisConnection,
} from "@langwatch/redis-client";
import { TaskHostPort } from "@langwatch/task";
import type { TasksConfig } from "./config/tasks.config";

const logger = createLogger("langwatch:tasks:host");

function loggedAbsence(handle: string): undefined {
  logger.info({ handle }, "tasks host composed without this handle");
  return undefined;
}

/**
 * The real `TaskHostPort` this process builds: whatever infrastructure the
 * environment actually configured, each handle composed once and closed
 * once. An absent leaf is logged by name at boot rather than stubbed —
 * exactly the vocabulary `TaskHostPort.require*` refuses by name at the call
 * site when a task reaches for a handle this environment never built.
 */
export class TasksHost extends TaskHostPort<
  TasksConfig,
  PrismaClient,
  ClickHouseClient,
  RedisConnection,
  never
> {
  readonly prisma: PrismaClient | undefined;
  readonly clickhouse: ClickHouseClient | undefined;
  readonly redis: RedisConnection | undefined;
  // Object storage composition is not yet wired into apps/tasks — no moved
  // task needs it yet. Left named-absent rather than half-built.
  readonly objectStorage: undefined = undefined;

  private readonly prismaConnection: PrismaConnection | undefined;

  private constructor(
    readonly config: TasksConfig,
    options: {
      prismaConnection?: PrismaConnection;
      redis?: RedisConnection;
      clickhouse?: ClickHouseClient;
    },
  ) {
    super();
    this.prismaConnection = options.prismaConnection;
    this.prisma = options.prismaConnection?.client;
    this.redis = options.redis;
    this.clickhouse = options.clickhouse;
  }

  static create(config: TasksConfig): TasksHost {
    const databaseUrl = config.databaseUrl?.trim();
    const prismaConnection = databaseUrl
      ? PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(
          PrismaConfigService.create().resolve({
            databaseUrl,
            log: config.nodeEnvironment === "development" ? ["error", "warn"] : ["error"],
          }),
        )
      : loggedAbsence("prisma");

    const clickhouseUrl = config.clickhouseUrl?.trim();
    const clickhouse = clickhouseUrl
      ? createClient({ url: clickhouseUrl })
      : loggedAbsence("clickhouse");

    const redis =
      new RedisConnectionService().connect({ url: config.redisUrl }) ?? loggedAbsence("redis");

    return new TasksHost(config, { prismaConnection, redis, clickhouse });
  }

  async close(): Promise<void> {
    await Promise.all([
      this.prismaConnection
        ? PrismaShutdownService.create().shutdown(this.prismaConnection)
        : Promise.resolve(),
      this.clickhouse ? this.clickhouse.close() : Promise.resolve(),
      this.redis ? RedisShutdownService.create().shutdown(this.redis) : Promise.resolve(),
    ]);
  }
}
