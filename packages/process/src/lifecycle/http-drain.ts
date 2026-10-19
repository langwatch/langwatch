import { setTimeout as delay } from "node:timers/promises";

/** The part of `node:http`'s server a drain touches; HTTP/2 has no connection reapers. */
export type DrainableHttpServer = Readonly<{
  close: (callback?: (error?: Error) => void) => unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}>;

/** How often a drain closes connections that went idle after finishing their request. */
const IDLE_REAP_INTERVAL_MS = 50;

export type DrainLogger = Readonly<{
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}>;

/**
 * Stops accepting, lets in-flight requests finish inside `graceMs`, then destroys only the
 * stragglers, on this call's own clock so the runner never abandons it before the reap.
 * Spec: specs/background/worker-graceful-shutdown.feature (@shutdown-http).
 */
export async function drainHttpServer({
  server,
  graceMs,
  logger,
  closeSessions,
}: {
  server: DrainableHttpServer;
  graceMs: number;
  logger: DrainLogger;
  /** Extra teardown that runs once the listener stops accepting; it never spends the grace. */
  closeSessions?: () => Promise<void>;
}): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  server.closeIdleConnections?.();
  // A keep-alive socket outlives its last response by the 65s idle timeout; reap each as it idles.
  const idleReaper = setInterval(() => server.closeIdleConnections?.(), IDLE_REAP_INTERVAL_MS);
  idleReaper.unref();
  // Started before the session teardown, so that teardown cannot eat into the grace.
  const graceExpired = delay(graceMs, false as const, { ref: false });
  try {
    await closeSessions?.();
  } catch (error) {
    logger.error({ error }, "session teardown failed during shutdown, draining connections anyway");
  }
  const drained = await Promise.race([closed.then(() => true as const), graceExpired]);
  clearInterval(idleReaper);
  if (drained) return;
  logger.info({ graceMs }, "connections outlived the drain grace, destroying the stragglers");
  server.closeAllConnections?.();
  await closed;
}
