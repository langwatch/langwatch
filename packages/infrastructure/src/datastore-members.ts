/**
 * Postgres, Redis and the event-sourcing runtime, each built from the config
 * slice that names it and closed by the handle it hands back. A slice this
 * process was not given is a refusal by name, never a quieter member: an API
 * answering from an empty memory store looks healthy and is the worst failure
 * this design can have.
 */
import { EventSourcing } from "@langwatch/eventing";
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
import type { DatabaseConfig, EventingConfig, RedisConfig } from "./config.ts";

/** One member, with the close its construction earned. */
export interface BuiltMember<Value> {
  readonly value: Value;
  /** Absent where nothing was opened, so the disposer has nothing to record. */
  readonly close?: () => Promise<void>;
}

/**
 * One guarded Prisma client. There is no unguarded path: the connection service
 * wraps {@link PrismaTenancyGuardService} around every operation, and the only
 * argument this function takes is a connection string, so a caller cannot ask
 * for a client that skips the multitenancy, organization and mass-delete
 * guards.
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

/**
 * The event-sourcing runtime this role holds. The store and the queue factory
 * are the process's, because which log a role appends to and whether it claims
 * the queue are role decisions; everything else about the runtime is the same
 * everywhere and is settled here.
 */
export function buildEventing(config: EventingConfig): BuiltMember<EventSourcing> {
  const eventing = new EventSourcing({
    enabled: true,
    eventStore: config.eventStore,
    consumersEnabled: config.consumersEnabled,
    executionTarget: config.executionTarget,
    processManagerMode: config.processManagerMode ?? "run",
    warnWhenProjectionsRunInline: false,
    ...(config.queueFactory === undefined ? {} : { queueFactory: config.queueFactory }),
    ...(config.processStore === undefined ? {} : { processStore: config.processStore }),
    ...(config.killSwitch === undefined ? {} : { killSwitch: config.killSwitch }),
  });

  return { value: eventing, close: () => eventing.close() };
}
