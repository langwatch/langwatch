import IORedis, { Cluster } from "ioredis";
import {
  resolveRedisConfig,
  type RedisConfigResolution,
  type RedisEnvironment,
} from "./config";
import type { RedisConnection, RedisLogger } from "./types";

export interface CreateRedisConnectionOptions {
  /** The environment to resolve configuration from. */
  env: RedisEnvironment;
  /** Receives connection lifecycle events and configuration warnings. */
  logger?: RedisLogger | undefined;
}

/**
 * ioredis options shared by both modes.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ-style blocking commands
 * and by the GroupQueue dispatcher: a blocking read must not be failed by a
 * retry budget. `offlineQueue: false` makes a command against a down Redis fail
 * now rather than buffering unboundedly and replaying a backlog on reconnect.
 */
const SHARED_OPTIONS = {
  maxRetriesPerRequest: null,
  offlineQueue: false,
} as const;

function attachLifecycleLogging(
  connection: RedisConnection,
  logger: RedisLogger,
  context: object,
): void {
  connection.on("connect", () => logger.info(context, "connected"));
  connection.on("ready", () => logger.info(context, "ready to accept commands"));
  connection.on("error", (error: Error) =>
    logger.error({ ...context, error }, "error"),
  );
  connection.on("close", () => logger.info(context, "connection closed"));
  connection.on("reconnecting", () => logger.info(context, "reconnecting..."));
}

/**
 * Builds a connection from an already-resolved configuration.
 *
 * Separate from {@link createRedisConnection} so a caller that has resolved
 * config for its own reasons — to log the mode, or to decide a code path — does
 * not resolve it twice.
 */
export function connectRedis(
  config: RedisConfigResolution,
  logger?: RedisLogger,
): RedisConnection | null {
  for (const warning of config.warnings) logger?.warn({}, warning);

  if (!config.configured) return null;

  if (config.mode === "cluster") {
    const connection = new Cluster(config.endpoints, {
      redisOptions: { ...SHARED_OPTIONS },
      dnsLookup: (address, callback) => callback(null, address),
      scaleReads: "all",
    });
    if (logger) {
      attachLifecycleLogging(connection, logger, {
        mode: "cluster",
        endpoints: config.endpoints.length,
      });
    }
    return connection;
  }

  const connection = new IORedis(config.url, {
    ...SHARED_OPTIONS,
    db: config.db,
    tls: config.tls,
  });
  if (logger) {
    attachLifecycleLogging(connection, logger, {
      mode: "standalone",
      db: config.db,
    });
  }
  return connection;
}

/**
 * Creates the connection this environment asks for, or `null` when it asks for
 * none. Calling this is the only way a connection comes into existence —
 * importing this module creates nothing.
 *
 * `null` is a supported, first-class outcome: deployments and test runs without
 * Redis are normal, and consumers branch on it to take a documented fallback.
 */
export function createRedisConnection({
  env,
  logger,
}: CreateRedisConnectionOptions): RedisConnection | null {
  return connectRedis(resolveRedisConfig(env), logger);
}
