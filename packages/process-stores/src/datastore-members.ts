/**
 * Postgres and Redis, each built from the config slice that names it. A slice
 * not given is a refusal by name, never a quieter member answering from an
 * empty store as if healthy. Event sourcing builds in `eventing-members.ts`.
 */
import type { Logger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaShutdownService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  RedisConfigService,
  RedisConnectionService,
  RedisShutdownService,
  type RedisConnection,
} from "@langwatch/redis-client";

import type { DatabaseConfig, RedisConfig } from "./config.ts";

/** One member, with the close its construction earned. */
export interface BuiltMember<Value> {
  readonly value: Value;
  /** Absent where nothing was opened, so the disposer has nothing to record. */
  readonly close?: () => Promise<void>;
}

/**
 * One guarded Prisma client. No unguarded path: the connection service wraps
 * {@link PrismaTenancyGuardService} around every operation, and the only
 * argument here is a connection string, so no caller can skip the guards.
 */
export function buildPrisma(options: {
  config: DatabaseConfig;
  logger: Logger;
}): BuiltMember<PrismaClient> {
  const databaseUrl = options.config.url.trim();
  const configuration = PrismaConfigService.create().resolve({
    databaseUrl,
    log: options.config.logWarnings ? ["error", "warn"] : ["error"],
  });
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: options.logger,
  }).connect(configuration);

  return {
    value: connection.client,
    close: () => PrismaShutdownService.create().shutdown(connection),
  };
}

/**
 * One Redis connection, resolved the way every LangWatch process resolves it:
 * cluster endpoints win over a plain URL, because a clustered deployment states
 * the endpoints and may still carry a leftover URL naming a different server.
 */
export function buildRedis(config: RedisConfig): BuiltMember<RedisConnection> {
  const resolution = new RedisConfigService().resolve({
    ...(config.url === undefined ? {} : { url: config.url }),
    ...(config.clusterEndpoints === undefined ? {} : { clusterEndpoints: config.clusterEndpoints }),
    ...(config.dbIndex === undefined ? {} : { dbIndex: config.dbIndex }),
  });
  if (!resolution.configured) {
    throw new Error(
      `Redis is ${resolution.reason}: set REDIS_URL or REDIS_CLUSTER_ENDPOINTS for this process.`,
    );
  }

  const connection = new RedisConnectionService({}).connectResolved({ config: resolution });
  if (!connection) {
    throw new Error("Redis resolved as configured but no connection was opened.");
  }

  return {
    value: connection,
    close: () => RedisShutdownService.create().shutdown(connection),
  };
}
