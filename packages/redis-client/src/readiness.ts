/**
 * The boot-time readiness probe.
 *
 * `RedisReadinessService` holds the logger and nothing else — it owns no
 * connection, so a caller constructs one wherever it makes sense (module scope
 * included) and passes the connection it wants probed (ADR-093).
 */
import type { RedisConnection, RedisLogger } from "./types";

export interface RedisReadinessServiceOptions {
  logger?: RedisLogger | undefined;
}

export interface RedisPingOptions {
  /** The connection to probe. `null` / `undefined` succeeds trivially. */
  connection?: RedisConnection | null | undefined;
  /**
   * How long to wait for the PING.
   *
   * 15s, not 3s: ElastiCache with TLS+AUTH can take longer than 3s on a cold
   * connection under load (observed twice on 2026-05-11 during a routine
   * langwatch-workers restart cycle — PING timed out, the boot guard fired, and
   * the pod crashlooped right when the event-sourcing dispatcher needed to come
   * back online). The guard is still useful for surfacing dev misconfiguration;
   * it just must not trip on a real-world TLS handshake.
   */
  timeoutMs?: number;
  /** Where the connection points, for the log line. */
  target?: string | undefined;
}

/**
 * Drops the credentials from each entry of a Redis target.
 *
 * `target` is `REDIS_URL` or `REDIS_CLUSTER_ENDPOINTS` verbatim, and a
 * production `REDIS_URL` routinely carries an AUTH password
 * (`rediss://:secret@host:6379`). This line is logged at error level on a boot
 * failure, which is exactly when logs get pasted into issues and chats, so the
 * password must not be in it.
 *
 * Two places carry one, and dropping only the first would leave a redaction
 * that reads as complete:
 *
 * - the userinfo, matched greedily to the last `@` before the path, because a
 *   password may itself contain `@` and a lazy match leaves the tail of one;
 * - the query string, which ioredis also accepts a `password` in.
 *
 * The path survives, since it is the database index and is not a secret.
 *
 * Nothing is split on commas. A caller passes `REDIS_CLUSTER_ENDPOINTS` — a
 * `host:port` list that carries no credentials — or `REDIS_URL`, one URL that
 * may; never a mix. Splitting first looked harmless and was the bug: a
 * password may contain a comma, and `rediss://admin:p,a@host` split into two
 * fragments that each failed to match the userinfo pattern, so both halves of
 * the credential survived into the log.
 *
 * The query is cut with `indexOf` rather than a second regex. `/\?.*$/` reads
 * as the obvious way to write it and is quadratic: `.` does not cross a
 * newline while an unanchored `$` only matches end of input, so every `?` in a
 * newline-bearing value re-scans the tail before failing.
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
   * Probes Redis with a timeout, rejecting — never exiting — on failure.
   *
   * Callers that own the process lifecycle decide what to do with the
   * rejection: `start.ts` exits, because a web server that cannot reach Redis
   * has nothing to serve; `startWorkers()` lets it propagate so an in-process
   * worker boot failure does not take a serving web process down with it.
   * Keeping `process.exit` out of here is what makes that choice the caller's.
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
