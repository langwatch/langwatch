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

    let timer: ReturnType<typeof setTimeout> | undefined;
    let serverInfo: string;
    try {
      serverInfo = await Promise.race([
        connection.ping().then(() => connection.info("server")),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`PING timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
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
    } finally {
      // Without this the pending timer keeps the event loop alive for the full
      // timeout after a successful ping, delaying every short-lived process.
      if (timer) clearTimeout(timer);
    }
    this.refuseUnsupportedVersion({ serverInfo, target: safeTarget });
    this.logger?.info({ target: safeTarget }, "redis ready");
  }

  /** Queue scripts declare Redis 7 script flags, which older servers reject (record §9). */
  private refuseUnsupportedVersion({
    serverInfo,
    target,
  }: {
    serverInfo: string;
    target: string;
  }): void {
    const found = /^redis_version:(\d+)\.(\d+)\S*/m.exec(serverInfo);
    if (!found) {
      this.logger?.warn({ target }, "redis did not report its version; 7.0 or later is required");
      return;
    }
    if (Number(found[1]) >= MINIMUM_REDIS_MAJOR) return;
    const version = found[0].slice("redis_version:".length);
    const message =
      `Redis ${version} is older than the minimum, Redis ${MINIMUM_REDIS_MAJOR}.0 ` +
      `(or Valkey 7.2): the queue's Lua scripts need Redis 7 script flags. Upgrade the server at ${target}.`;
    this.logger?.error({ target, version }, message);
    throw new Error(message);
  }
}
