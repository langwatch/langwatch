import type { ShutdownLogger, ShutdownPhase } from "./runGracefulShutdown";

/**
 * The subset of `node:http`'s Server the close phase touches. The connection
 * reapers are optional because an HTTP/2 server does not have them — there
 * the phase's own timeout stays the only bound.
 */
export interface CloseableHttpServer {
  close(callback?: () => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

/**
 * Closes the HTTP listener without costing the rest of the shutdown sequence.
 *
 * Stop accepting, then let requests already in flight finish.
 * closeAllConnections() destroys active sockets, so calling it outright
 * turned every rolling deploy into a burst of 502s for whatever was
 * mid-request. Idle connections go immediately; the rest get `graceMs` and
 * only the stragglers are destroyed.
 *
 * The destroy happens INSIDE the phase, on the phase's own clock. The
 * earlier cut put closeAllConnections() in a finally behind `await closed` —
 * but when a long-lived response (an SSE stream, a stuck keep-alive) never
 * ends, `closed` never settles, the runner's phase timeout fires first, and
 * the destroy never ran at all: the phase "failed" on every rolling deploy
 * while the sockets it was meant to reap survived to the process deadline.
 */
export function createHttpServerClosePhase({
  server,
  closeSessions,
  logger,
  graceMs,
}: {
  server: CloseableHttpServer;
  /** Extra teardown that must run once the listener stops accepting. */
  closeSessions?: () => Promise<void>;
  logger: ShutdownLogger;
  /**
   * How long in-flight requests get before the leftovers are destroyed.
   * Must sit inside the phase timeout, or the runner gives up first and the
   * destroy is unreachable again.
   */
  graceMs: number;
}): ShutdownPhase {
  return {
    name: "http-server",
    run: async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      server.closeIdleConnections?.();
      await closeSessions?.();
      const drained = await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), graceMs).unref();
        }),
      ]);
      if (!drained) {
        logger.info(
          { graceMs },
          "connections outlived the drain grace, destroying the stragglers",
        );
        server.closeAllConnections?.();
        await closed;
      }
    },
  };
}
