/**
 * The boot-time readiness probe. Holds the logger and nothing else — it owns
 * no connection, so a caller constructs one wherever it makes sense and
 * passes the connection it wants probed (ADR-093).
 */
import type { RedisConnection, RedisLogger } from "./types.ts";

export interface RedisReadinessServiceOptions {
  logger?: RedisLogger | undefined;
}

export interface RedisPingOptions {
  /** The connection to probe. `null` / `undefined` succeeds trivially. */
  connection?: RedisConnection | null | undefined;
  /**
   * How long to wait for the PING. 15s, not 3s: ElastiCache with TLS+AUTH can take longer
   * than 3s on a cold connection under load, and this guard tripping on a real handshake
   * crashloops a pod that needed to come back online — not just surface dev misconfiguration.
   */
  timeoutMs?: number;
  /** Where the connection points, for the log line. */
  target?: string | undefined;
}

/**
 * Logged at error level on boot failure, so must not carry a password. Redacts
 * the userinfo (to the last `@`) and query string (`password` too) — never
 * splits on commas, since a password may contain one and leak both halves.
 */
function withoutCredentials(target: string): string {
  if (!target.includes("://")) return target;

  const withoutUserinfo = target.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, "$1");
  const query = withoutUserinfo.indexOf("?");
  return query === -1 ? withoutUserinfo : withoutUserinfo.slice(0, query);
}

/** Redis 7 introduced script flags; Valkey 7.2 and later report a compatible `redis_version`. */
const MINIMUM_REDIS_MAJOR = 7;

/** A server older than Redis 7 refused at boot; `code` is what callers and tests match on. */
export class UnsupportedRedisVersionError extends Error {
  readonly code = "redis_version_unsupported";
  readonly version: string;

  constructor({ version, target }: { version: string; target: string }) {
    super(
      `Redis ${version} is older than the minimum, Redis ${MINIMUM_REDIS_MAJOR}.0 ` +
        `(or Valkey 7.2): the queue's Lua scripts need Redis 7 script flags. Upgrade the server at ${target}.`,
    );
    this.name = "UnsupportedRedisVersionError";
    this.version = version;
  }
}

/** Rejects with `timeoutMessage` once `timeoutMs` passes; the timer never outlives the race. */
async function withinTimeout<T>({
  work,
  timeoutMs,
  timeoutMessage,
}: {
  work: Promise<T>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    // Without this the pending timer keeps the event loop alive for the full
    // timeout after a successful call, delaying every short-lived process.
    if (timer) clearTimeout(timer);
  }
}

export class RedisReadinessService {
  private readonly logger: RedisLogger | undefined;

  constructor(options: RedisReadinessServiceOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Rejects — never exits — on failure. `start.ts` exits since a server with
   * no Redis has nothing to serve; `startWorkers()` lets it propagate so a
   * worker-boot failure doesn't take a serving web process down too.
   */
  async ping({
    connection,
    timeoutMs = 15_000,
    target = "(unset)",
  }: RedisPingOptions): Promise<void> {
    if (!connection) return;

    const safeTarget = withoutCredentials(target);

    try {
      await withinTimeout({
        work: connection.ping(),
        timeoutMs,
        timeoutMessage: `PING timeout after ${timeoutMs}ms`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error(
        { error, target: safeTarget },
        `redis unreachable at boot — ${message}\n` +
          `  REDIS_URL / REDIS_CLUSTER_ENDPOINTS points at: ${safeTarget}\n` +
          `  Running the app on the host against a containerised Redis? The host port (6379) must be published.\n` +
          `  Otherwise bring the stack up with 'make haven up' or 'make quickstart'.`,
      );
      throw error instanceof Error ? error : new Error(message);
    }
    await this.refuseUnsupportedVersion({ connection, timeoutMs, target: safeTarget });
    this.logger?.info({ target: safeTarget }, "redis ready");
  }

  /**
   * Queue scripts declare Redis 7 script flags, which older servers reject (record §9). A server
   * that answers PING but will not say its version (an ACL user denied `INFO`, a managed provider
   * that strips it) is let through with a warning: only a version known to be too old is refused.
   */
  private async refuseUnsupportedVersion({
    connection,
    timeoutMs,
    target,
  }: {
    connection: RedisConnection;
    timeoutMs: number;
    target: string;
  }): Promise<void> {
    let serverInfo: string;
    try {
      serverInfo = await withinTimeout({
        work: connection.info("server"),
        timeoutMs,
        timeoutMessage: `INFO timeout after ${timeoutMs}ms`,
      });
    } catch (error) {
      this.logger?.warn(
        { error, target },
        "redis did not answer INFO, so its version is unknown; 7.0 or later is required",
      );
      return;
    }
    const version = /^redis_version:(\S+)/m.exec(serverInfo)?.[1];
    const major = version === undefined ? Number.NaN : Number.parseInt(version, 10);
    if (version === undefined || Number.isNaN(major)) {
      this.logger?.warn({ target }, "redis did not report its version; 7.0 or later is required");
      return;
    }
    if (major >= MINIMUM_REDIS_MAJOR) return;
    const error = new UnsupportedRedisVersionError({ version, target });
    this.logger?.error({ target, version }, error.message);
    throw error;
  }
}
