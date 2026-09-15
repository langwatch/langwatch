/**
 * The boot-time readiness probe.
 *
 * `RedisReadinessService` holds the logger and nothing else — it owns no
 * connection, so a caller constructs one wherever it makes sense (module scope
 * included) and passes the connection it wants probed (ADR-093).
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
 * Drops the credentials from a Redis target, logged at error level on boot failure so it must
 * not carry a password. Redacts both the userinfo (greedy to the last `@`, since a password
 * may itself contain one) and the query string (ioredis also accepts `password` there) —
 * dropping only one leaves a redaction that reads as complete. Never splits on commas: a
 * password may contain one, so splitting first left both halves of a credential in the log.
 */
function withoutCredentials(target: string): string {
  if (!target.includes("://")) return target;

  const withoutUserinfo = target.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, "$1");
  const query = withoutUserinfo.indexOf("?");
  return query === -1 ? withoutUserinfo : withoutUserinfo.slice(0, query);
}

export class RedisReadinessService {
  private readonly logger: RedisLogger | undefined;

  constructor(options: RedisReadinessServiceOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Probes Redis with a timeout, rejecting — never exiting — on failure. Callers that own
   * the process lifecycle decide what to do: `start.ts` exits since a server that can't
   * reach Redis has nothing to serve, while `startWorkers()` lets it propagate so a
   * worker-boot failure doesn't take a serving web process down with it. Keeping
   * `process.exit` out of here is what makes that the caller's choice.
   */
  async ping({
    connection,
    timeoutMs = 15_000,
    target = "(unset)",
  }: RedisPingOptions): Promise<void> {
    if (!connection) return;

    const safeTarget = withoutCredentials(target);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        connection.ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`PING timeout after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      this.logger?.info({ target: safeTarget }, "redis ready");
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
  }
}
