/**
 * Building Redis connections — the only place in the platform that constructs
 * an ioredis client.
 *
 * `RedisConnectionService` composes a `RedisConfigService` and holds the logger
 * for the connections it builds, so a caller states both once at construction
 * and then just asks for clients. Importing this module creates nothing: a
 * connection exists only because a method was called (ADR-093).
 */
import IORedis, { Cluster, type Redis } from "ioredis";
import {
  RedisConfigService,
  type RedisConfigResolution,
  type RedisEnvironment,
  type RedisStandaloneConfig,
} from "./config";
import type { RedisConnection, RedisLogger } from "./types";

export interface RedisConnectionServiceOptions {
  /** Receives connection lifecycle events and configuration warnings. */
  logger?: RedisLogger | undefined;
  /** Injected so a caller can share one resolver; defaults to a fresh one. */
  config?: RedisConfigService | undefined;
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

export class RedisConnectionService {
  private readonly logger: RedisLogger | undefined;
  private readonly config: RedisConfigService;

  constructor(options: RedisConnectionServiceOptions = {}) {
    this.logger = options.logger;
    this.config = options.config ?? new RedisConfigService();
  }

  /**
   * Creates the connection this environment asks for, or `null` when it asks
   * for none.
   *
   * `null` is a supported, first-class outcome: deployments and test runs
   * without Redis are normal, and consumers branch on it to take a documented
   * fallback.
   */
  connect(env: RedisEnvironment): RedisConnection | null {
    return this.connectResolved({ config: this.config.resolve(env) });
  }

  /**
   * Builds a connection from an already-resolved configuration.
   *
   * Separate from {@link connect} so a caller that has resolved config for its
   * own reasons — to log the mode, or to decide a code path — does not resolve
   * it twice.
   */
  connectResolved({ config }: { config: RedisConfigResolution }): RedisConnection | null {
    for (const warning of config.warnings) this.logger?.warn({}, warning);

    if (!config.configured) return null;

    if (config.mode === "cluster") {
      const connection = new Cluster(config.endpoints, {
        redisOptions: { ...SHARED_OPTIONS },
        dnsLookup: (address, callback) => callback(null, address),
        scaleReads: "all",
      });
      this.attachLifecycleLogging({
        connection,
        context: { mode: "cluster", endpoints: config.endpoints.length },
      });
      return connection;
    }

    return this.connectStandaloneResolved({ config });
  }

  /**
   * Creates a standalone connection from a URL, typed as one. `null` when no
   * URL is supplied.
   *
   * Some callers need a standalone client specifically rather than "whatever
   * this environment configured" — replay and the Redis-cached fold store both
   * run multi-key operations that Redis Cluster rejects with CROSSSLOT. Taking
   * a URL rather than a full environment is what makes the return type `Redis`:
   * there is no cluster branch to widen it.
   */
  connectStandalone({
    url,
    dbIndex,
  }: {
    url?: string | undefined;
    dbIndex?: string | number | undefined;
  }): Redis | null {
    if (!url) return null;
    const config = this.config.resolve({ url, dbIndex });
    // Resolving a plain URL with no cluster endpoints always yields standalone;
    // the guard is here so a future change to that resolution fails loudly
    // rather than silently handing back a cluster client.
    if (!config.configured || config.mode !== "standalone") {
      throw new Error("Expected a standalone Redis configuration from a plain URL.");
    }
    return this.connectStandaloneResolved({ config });
  }

  private connectStandaloneResolved({
    config,
  }: {
    config: RedisStandaloneConfig;
  }): Redis {
    const connection = new IORedis(config.url, {
      ...SHARED_OPTIONS,
      db: config.db,
      tls: config.tls,
    });
    this.attachLifecycleLogging({
      connection,
      context: { mode: "standalone", db: config.db },
    });
    return connection;
  }

  private attachLifecycleLogging({
    connection,
    context,
  }: {
    connection: RedisConnection;
    context: object;
  }): void {
    const logger = this.logger;
    if (!logger) return;

    connection.on("connect", () => logger.info(context, "connected"));
    connection.on("ready", () => logger.info(context, "ready to accept commands"));
    connection.on("error", (error: Error) =>
      logger.error({ ...context, error }, "error"),
    );
    connection.on("close", () => logger.info(context, "connection closed"));
    connection.on("reconnecting", () => logger.info(context, "reconnecting..."));
  }
}
