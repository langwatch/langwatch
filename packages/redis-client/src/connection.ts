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

/** Redis commands whose arguments carry a password. */
const CREDENTIAL_COMMANDS = new Set(["auth", "hello"]);

/**
 * The credential values among a command's arguments: every string argument of
 * AUTH (user and password), and those after the AUTH token of HELLO.
 */
function credentialValues(name: string, args: unknown): string[] {
  if (!Array.isArray(args)) return [];
  const strings = (list: unknown[]) =>
    list.filter((a): a is string => typeof a === "string" && a.length > 0);
  if (name === "auth") return strings(args);
  const at = args.findIndex(
    (a) => typeof a === "string" && a.toLowerCase() === "auth",
  );
  return at < 0 ? [] : strings(args.slice(at + 1));
}

/** Replaces every credential value in a text, such as an error message. */
function maskValues(text: unknown, values: string[]): unknown {
  if (typeof text !== "string") return text;
  return values.reduce((out, value) => out.split(value).join("[redacted]"), text);
}

/**
 * ioredis attaches the failed command to a reply error as
 * `command: { name, args }`, so a rejected AUTH carries the password in
 * `args`, and a server that renamed AUTH echoes it in the message too. The
 * same object rejects every queued command and can end up in a crash log, so
 * the values are replaced on the error itself.
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
  connectResolved({
    config,
  }: {
    config: RedisConfigResolution;
  }): RedisConnection | null {
    for (const warning of config.warnings) this.logger?.warn({}, warning);

    if (!config.configured) return null;

    if (config.mode === "cluster") {
      const connection = new Cluster(config.endpoints, {
        redisOptions: { ...SHARED_OPTIONS },
        dnsLookup: (address, callback) => callback(null, address),
        scaleReads: "all",
      });
      // A node's error reaches the cluster as "node error", on the same object.
      connection.on("node error", (error: unknown) =>
        redactCommandCredentials(error),
      );
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
      throw new Error(
        "Expected a standalone Redis configuration from a plain URL.",
      );
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
    connection.on("ready", () =>
      logger.info(context, "ready to accept commands"),
    );
    connection.on("close", () => logger.info(context, "connection closed"));
    connection.on("reconnecting", () => logger.info(context, "reconnecting..."));
  }
}
