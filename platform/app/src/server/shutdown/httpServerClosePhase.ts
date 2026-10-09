import { setTimeout as delay } from "node:timers/promises";
import { SHUTDOWN_BUDGET } from "./budget";
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
  graceMs = SHUTDOWN_BUDGET.httpDrainGraceMs,
  timeoutMs = SHUTDOWN_BUDGET.httpClosePhaseMs,
}: {
  server: CloseableHttpServer;
  /** Extra teardown that must run once the listener stops accepting. */
  closeSessions?: () => Promise<void>;
  logger: ShutdownLogger;
  /**
   * How long in-flight requests get before the leftovers are destroyed, and
   * the phase's own ceiling around it. Both come from the shutdown budget,
   * which is what keeps the grace inside the ceiling — the two agreeing only
   * by comment is the failure mode budget.ts exists to prevent.
   */
  graceMs?: number;
  timeoutMs?: number;
}): ShutdownPhase {
  return {
    name: "http-server",
    timeoutMs,
    run: async () => {
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      server.closeIdleConnections?.();
      // The grace starts here, not after the teardown below: it measures how
      // long in-flight requests have been given, and anything awaited before
      // it would silently eat into that budget. Unreffed, so a drain that
      // finishes early never holds the process open waiting for the timer.
      const graceExpired = delay(graceMs, false as const, { ref: false });
      // Session teardown must not decide whether sockets get reaped. It runs
      // for its own sake, and a failure is reported and stepped over — the
      // listener is already closed, and leaving the sockets alive until the
      // process deadline is the worse of the two outcomes.
      try {
        await closeSessions?.();
      } catch (error) {
        logger.error(
          { error },
          "session teardown failed during shutdown, draining connections anyway",
        );
      }
      const drained = await Promise.race([
        closed.then(() => true),
        graceExpired,
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
