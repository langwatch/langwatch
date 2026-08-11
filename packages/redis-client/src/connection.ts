import IORedis, { Cluster, type Redis } from "ioredis";
import {
  resolveRedisConfig,
  type RedisConfigResolution,
  type RedisEnvironment,
  type RedisStandaloneConfig,
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
 * retry budget.
 *
 * There is deliberately no offline-queue option here. Both call sites this
 * package replaces passed `offlineQueue: false`, which ioredis never reads from
 * its constructor options — the option that disables buffering is
 * `enableOfflineQueue`, and `offlineQueue` is only a parameter of the internal
 * `flushQueue()`. So the offline queue has always been ioredis's default (on),
 * and carrying the dead key forward would state a guarantee the client does not
 * give. Turning it off for real is a behaviour change, not a rename: commands
 * issued during a disconnect would start rejecting instead of replaying, and
 * `rateLimit` does not yet catch a rejected `incr`. That belongs in its own
 * change, sequenced after the callers can survive it.
 */
const SHARED_OPTIONS = {
  maxRetriesPerRequest: null,
} as const;

function attachLifecycleLogging({
  connection,
  logger,
  context,
}: {
  connection: RedisConnection;
  logger: RedisLogger;
  context: object;
}): void {
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
export function connectRedis({
  config,
  logger,
}: {
  config: RedisConfigResolution;
  logger?: RedisLogger | undefined;
}): RedisConnection | null {
  for (const warning of config.warnings) logger?.warn({}, warning);

  if (!config.configured) return null;

  if (config.mode === "cluster") {
    const connection = new Cluster(config.endpoints, {
      redisOptions: { ...SHARED_OPTIONS },
      dnsLookup: (address, callback) => callback(null, address),
      scaleReads: "all",
    });
    if (logger) {
      attachLifecycleLogging({
        connection,
        logger,
        context: { mode: "cluster", endpoints: config.endpoints.length },
      });
    }
    return connection;
  }

  return connectStandalone({ config, logger });
}

/**
 * Builds a standalone connection, typed as one.
 *
 * Some callers need a standalone client specifically rather than "whatever this
 * environment configured" — replay and the Redis-cached fold store both run
 * multi-key operations that Redis Cluster rejects with CROSSSLOT. Taking a URL
 * rather than a full environment is what makes the return type `Redis`: there
 * is no cluster branch to widen it.
 */
export function connectStandalone({
  config,
  logger,
}: {
  config: RedisStandaloneConfig;
  logger?: RedisLogger | undefined;
}): Redis {
  const connection = new IORedis(config.url, {
    ...SHARED_OPTIONS,
    db: config.db,
    tls: config.tls,
  });
  if (logger) {
    attachLifecycleLogging({
      connection,
      logger,
      context: { mode: "standalone", db: config.db },
    });
  }
  return connection;
}

/**
 * Creates a standalone connection from a URL. `null` when no URL is supplied.
 *
 * The narrow counterpart to {@link createRedisConnection}, for the callers
 * documented on {@link connectStandalone}.
 */
export function createStandaloneRedisConnection({
  url,
  dbIndex,
  logger,
}: {
  url?: string | undefined;
  dbIndex?: string | number | undefined;
  logger?: RedisLogger | undefined;
}): Redis | null {
  if (!url) return null;
  const config = resolveRedisConfig({ url, dbIndex });
  // `resolveRedisConfig` with a url and no cluster endpoints always resolves
  // standalone; the guard is here so a future change to that function fails
  // loudly rather than silently handing back a cluster client.
  if (!config.configured || config.mode !== "standalone") {
    throw new Error(
      "Expected a standalone Redis configuration from a plain URL.",
    );
  }
  return connectStandalone({ config, logger });
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
  return connectRedis({ config: resolveRedisConfig(env), logger });
}
