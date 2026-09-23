/**
 * The only place in the platform that constructs an ioredis client. Importing
 * this module creates nothing: a connection exists only because a method was
 * called (ADR-093).
 */
import IORedis, { Cluster, type Redis } from "ioredis";

import {
  RedisConfigService,
  type RedisConfigResolution,
  type RedisEnvironment,
  type RedisStandaloneConfig,
} from "./config.ts";
import type { RedisConnection, RedisLogger } from "./types.ts";

export interface RedisConnectionServiceOptions {
  /** Receives connection lifecycle events and configuration warnings. */
  logger?: RedisLogger | undefined;
  /** Injected so a caller can share one resolver; defaults to a fresh one. */
  config?: RedisConfigService | undefined;
}

/**
 * `maxRetriesPerRequest: null` is required by BullMQ-style blocking commands and
 * the GroupQueue dispatcher. `offlineQueue: false` never worked (real option is
 * `enableOfflineQueue`); turning it off for real needs its own sequenced work.
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
   * `null` is a supported, first-class outcome: deployments and test runs
   * without Redis are normal, and consumers branch on it for a fallback.
   */
  connect(env: RedisEnvironment): RedisConnection | null {
    return this.connectResolved({ config: this.config.resolve(env) });
  }

  /**
   * Separate from {@link connect} so a caller that resolved config for its own
   * reasons — to log the mode, or decide a code path — does not resolve twice.
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
   * `null` when no URL is supplied. Typed `Redis`, not `RedisConnection`,
   * because replay and the Redis-cached fold store run multi-key operations
   * that Redis Cluster rejects with CROSSSLOT.
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

  private connectStandaloneResolved({ config }: { config: RedisStandaloneConfig }): Redis {
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
    connection.on("error", (error: Error) => logger.error({ ...context, error }, "error"));
    connection.on("close", () => logger.info(context, "connection closed"));
    connection.on("reconnecting", () => logger.info(context, "reconnecting..."));
  }
}
