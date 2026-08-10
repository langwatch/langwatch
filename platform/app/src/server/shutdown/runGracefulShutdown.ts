import { SHUTDOWN_BUDGET } from "./budget";
import { telemetryFlushes } from "./telemetry";

/**
 * One shutdown implementation, shared by both entrypoints.
 *
 * `start.ts` and `workers.ts` had a hand-rolled sequence each. They agreed on
 * the order but not on the deadline — the app force-exited after 5s, well
 * inside the queue's own 20s drain budget, so the `all` role could not finish
 * a drain no matter what the queue was told. Anything living in only one of
 * the two copies (the re-entrancy guard, the watchdog, the phase logging) was
 * absent from the other by accident rather than by decision.
 */

export interface ShutdownPhase {
  /** Named so a phase that hangs is identifiable in the logs. */
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownLogger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RunGracefulShutdownOptions {
  signal: string;
  phases: ShutdownPhase[];
  logger: ShutdownLogger;
  /** Overridable for tests; production always uses the shared budget. */
  deadlineMs?: number;
  /** Overridable for tests, which must not kill the runner. */
  exit?: (code: number) => never;
}

/**
 * Runs each phase in order, never letting one failure skip the rest.
 *
 * Phases are sequential on purpose: each tears down something the next still
 * needs. Running them concurrently is the defect this whole path exists to fix
 * — App.close used to close ClickHouse alongside the drain that was still
 * writing to it.
 */
export async function runGracefulShutdown({
  signal,
  phases,
  logger,
  deadlineMs = SHUTDOWN_BUDGET.processDeadlineMs,
  exit = process.exit.bind(process) as (code: number) => never,
}: RunGracefulShutdownOptions): Promise<void> {
  logger.info({ signal, deadlineMs }, "received signal, shutting down");

  const deadline = setTimeout(() => {
    logger.error(
      { signal, deadlineMs },
      "graceful shutdown exceeded its deadline, exiting before the pod is killed",
    );
    exit(1);
  }, deadlineMs);
  // The watchdog must never be the reason the process stays alive: if every
  // phase finishes early, a ref'd timer would hold the loop open for the rest
  // of the budget.
  deadline.unref();

  // Telemetry flushes last, so the spans and logs describing this shutdown are
  // themselves exported. Appended here rather than by each caller: a provider
  // that flushes on its own signal handler is racing this sequence, and one
  // that calls process.exit() when its flush resolves wins the race.
  const all = [
    ...phases,
    ...telemetryFlushes().map((f) => ({
      name: `telemetry:${f.name}`,
      run: f.run,
    })),
  ];

  for (const phase of all) {
    try {
      await phase.run();
    } catch (error) {
      // Logged and stepped over. A failure to close a websocket server must
      // not cost us the queue drain that comes after it.
      logger.error({ error, phase: phase.name }, "shutdown phase failed");
    }
  }

  clearTimeout(deadline);
  logger.info({ signal }, "graceful shutdown complete");
  exit(0);
}

/**
 * Wires SIGTERM/SIGINT to one shutdown run.
 *
 * The guard matters more than it looks: Kubernetes sends SIGTERM, and an
 * impatient operator adds a Ctrl-C on top. Without it the second signal starts
 * a parallel teardown over half-closed handles.
 */
export function installShutdownHandlers(
  buildOptions: (signal: string) => RunGracefulShutdownOptions,
): void {
  let shuttingDown = false;
  const handle = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void runGracefulShutdown(buildOptions(signal));
  };
  process.on("SIGTERM", () => handle("SIGTERM"));
  process.on("SIGINT", () => handle("SIGINT"));
}
