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
import { TaskHost, TaskInfrastructureUnavailableError } from "@langwatch/task";

import type { TasksConfig } from "./config/tasks.config.ts";
import {
  createTasksObjectStorage,
  type TasksObjectStorage,
} from "./infrastructure/tasks-stored-object-storage.adapter.ts";

const logger = createLogger("langwatch:tasks:host");

function loggedAbsence(handle: string): undefined {
  logger.info({ handle }, "tasks host composed without this handle");
  return undefined;
}

/**
 * The real `TaskHost`: whatever infrastructure the environment configured,
 * each handle composed once and closed once. An absent leaf is logged by
 * name at boot, not stubbed - the vocabulary `TaskHost.require*` also uses.
 */
export class TasksHost extends TaskHost<
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
   * Always composed - building the runtime opens no connection, it only
   * decides where a project's bytes belong. A BYOC lookup still refuses by
   * name the moment one is attempted without `DATABASE_URL`.
   */
  readonly objectStorage: TasksObjectStorage;

  private readonly prismaConnection: PrismaConnection | undefined;

  private constructor(
    readonly config: TasksConfig,
    /**
     * The environment as `SecretEnvironmentService` resolved it at boot, held
     * as a value. The three tasks that parse a whole record for themselves --
     * ClickHouse migration routing, LangWatchQL provisioning and the Prisma
     * migrate child process -- read it from here, so this process names
     * `process.env` once, in its entrypoint, rather than at each call site.
     */
    readonly environment: Readonly<Record<string, string | undefined>>,
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

  static create(config: TasksConfig, environment: Readonly<Record<string, unknown>>): TasksHost {
    // Narrowed once, here, so every task downstream takes the environment in
    // the shape a parser and a child process both already want. The resolved
    // record is string-valued in practice; anything else is not a variable.
    const environmentValues: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(environment)) {
      if (typeof value === "string") environmentValues[key] = value;
    }

    const databaseUrl = config.databaseUrl?.trim();
    const prismaConnection = databaseUrl
      ? PrismaConnectionService.create({
          guard: PrismaTenancyGuardService.create(),
          logger,
        }).connect(
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
      source: environmentValues,
      getPrisma: () => {
        if (!prismaConnection) {
          throw new TaskInfrastructureUnavailableError({ handle: "a database connection" });
        }
        return prismaConnection.client;
      },
    });

    return new TasksHost(config, environmentValues, {
      prismaConnection,
      redis,
      clickhouse,
      objectStorage,
    });
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
