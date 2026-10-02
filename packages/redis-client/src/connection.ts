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

/** Redis commands whose arguments carry a password. */
const CREDENTIAL_COMMANDS = new Set(["auth", "hello"]);

/**
 * The password among a command's arguments: the last one of `AUTH [user] pass`,
 * the one after the username in `HELLO protover AUTH user pass`. A username is
 * not a secret, and masking `default` would blank unrelated text.
 */
function credentialValues(name: string, args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  let password: unknown;
  if (name === "auth") {
    password = args[args.length - 1];
  } else {
    const at = args.findIndex((a) => typeof a === "string" && a.toLowerCase() === "auth");
    password = at < 0 ? undefined : args[at + 2];
  }
  return typeof password === "string" && password.length > 0 ? [password] : [];
}

/**
 * A server that does not know the command echoes its first arguments, cut at
 * about 128 bytes, so an exact match can miss the password. The list goes.
 */
const ECHOED_ARGUMENTS = /(with args beginning with:)[^\n]*/g;

/** Replaces the password, and any echoed argument list, in a text. */
function maskValues(text: unknown, values: string[]): unknown {
  if (typeof text !== "string") return text;
  const masked = values.reduce((out, value) => out.split(value).join("[redacted]"), text);
  return masked.replace(ECHOED_ARGUMENTS, "$1 [redacted]");
}

/**
 * ioredis attaches the failed command to a reply error as `command`, so a
 * rejected AUTH carries the password in `args` (and maybe the message). The
 * same object rejects every queued command, so it is redacted in place.
 */
function redactCommandCredentials(error: unknown): void {
  if (!error || typeof error !== "object") return;
  const command = (error as { command?: unknown }).command;
  if (!command || typeof command !== "object") return;
  const { name, args } = command as { name?: unknown; args?: unknown };
  if (typeof name !== "string" || !CREDENTIAL_COMMANDS.has(name.toLowerCase())) {
    return;
  }
  const values = credentialValues(name.toLowerCase(), args);
  const target = error as { message?: unknown; stack?: unknown };
  target.message = maskValues(target.message, values);
  target.stack = maskValues(target.stack, values);
  (command as { args: unknown }).args = Array.isArray(args)
    ? args.map(() => "[redacted]")
    : "[redacted]";
}

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
      // A node's error reaches the cluster as "node error", on the same object.
      connection.on("node error", (error: unknown) => redactCommandCredentials(error));
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

    // Registered first, so it runs before any listener a caller adds later,
    // and synchronously, before the rejected command promises that share the
    // same error object are handled.
    connection.on("error", (error: unknown) => {
      redactCommandCredentials(error);
      if (logger) {
        logger.error({ ...context, error }, "error");
      } else if (connection.listenerCount("error") === 1) {
        // Keeps ioredis's own report for a connection nobody else listens on;
        // registering a listener at all is what turns that report off.
        console.error(
          "[ioredis] Unhandled error event:",
          error instanceof Error ? error.stack : error,
        );
      }
    });
    if (!logger) return;

    connection.on("connect", () => logger.info(context, "connected"));
    connection.on("ready", () => logger.info(context, "ready to accept commands"));
    connection.on("close", () => logger.info(context, "connection closed"));
    connection.on("reconnecting", () => logger.info(context, "reconnecting..."));
  }
}
