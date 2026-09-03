import process from "node:process";
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
import { TaskHostPort, TaskInfrastructureUnavailableError } from "@langwatch/task";
import type { TasksConfig } from "./config/tasks.config";
import {
  createTasksObjectStorage,
  type TasksObjectStorage,
} from "./infrastructure/tasks-stored-object-storage.adapter";

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
  TasksObjectStorage
> {
  readonly prisma: PrismaClient | undefined;
  readonly clickhouse: ClickHouseClient | undefined;
  readonly redis: RedisConnection | undefined;
  /**
   * Always composed — building the runtime opens no connection, it only
   * decides where a project's bytes belong. A BYOC or bucket lookup still
   * refuses by name (`requirePrisma()`'s own error) the moment one is
   * actually attempted without `DATABASE_URL`.
   */
  readonly objectStorage: TasksObjectStorage;

  private readonly prismaConnection: PrismaConnection | undefined;

  private constructor(
    readonly config: TasksConfig,
    options: {
      prismaConnection?: PrismaConnection;
      redis?: RedisConnection;
      clickhouse?: ClickHouseClient;
      objectStorage: TasksObjectStorage;
    },
  ) {
    super();
    this.prismaConnection = options.prismaConnection;
    this.prisma = options.prismaConnection?.client;
    this.redis = options.redis;
    this.clickhouse = options.clickhouse;
    this.objectStorage = options.objectStorage;
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

    const objectStorage = createTasksObjectStorage({
      config,
      source: process.env,
      getPrisma: () => {
        if (!prismaConnection) {
          throw new TaskInfrastructureUnavailableError({ handle: "a database connection" });
        }
        return prismaConnection.client;
      },
    });

    return new TasksHost(config, { prismaConnection, redis, clickhouse, objectStorage });
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
