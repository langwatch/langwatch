import type { RedisConnection, RedisLogger } from "./types";

export interface PingRedisOptions {
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
  logger?: RedisLogger | undefined;
}

/**
 * Probes Redis with a timeout, rejecting — never exiting — on failure.
 *
 * Callers that own the process lifecycle decide what to do with the rejection:
 * `start.ts` exits, because a web server that cannot reach Redis has nothing to
 * serve; `startWorkers()` lets it propagate so an in-process worker boot failure
 * does not take a serving web process down with it. Keeping `process.exit` out
 * of here is what makes that choice the caller's.
 */
export async function pingRedis({
  connection,
  timeoutMs = 15_000,
  target = "(unset)",
  logger,
}: PingRedisOptions): Promise<void> {
  if (!connection) return;

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
    logger?.info({ target }, "redis ready");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(
      { error, target },
      `redis unreachable at boot — ${message}\n` +
        `  REDIS_URL / REDIS_CLUSTER_ENDPOINTS points at: ${target}\n` +
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
