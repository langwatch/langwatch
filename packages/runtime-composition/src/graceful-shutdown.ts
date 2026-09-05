import { telemetryFlushes } from "./shutdown-telemetry";

/**
 * One shutdown implementation, shared by every process entrypoint. Hand-rolled
 * sequences agreed on the order but not on the deadline, and the guard, the
 * watchdog and the phase logging each lived in only one of them.
 */

export interface ShutdownPhase {
  /** Named so a phase that hangs is identifiable in the logs. */
  name: string;
  run: () => Promise<void> | void;
  /**
   * How long this phase may take before the sequence moves on without it. A phase that never
   * settles takes the whole shutdown with it, drain included: a websocket close resolves only
   * once every client has gone, so one suspended tab holds it open indefinitely.
   */
  timeoutMs?: number;
}

/**
 * Default ceiling for a phase that does not name its own. Sized so the common
 * shutdown fits several phases inside the process deadline; a drain phase that
 * legitimately needs the whole budget overrides it.
 */
const DEFAULT_PHASE_TIMEOUT_MS = 10_000;

/** The watchdog ceiling for a whole sequence whose caller names none. */
const DEFAULT_PROCESS_DEADLINE_MS = 45_000;

export interface ShutdownLogger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RunGracefulShutdownOptions {
  signal: string;
  phases: ShutdownPhase[];
  logger: ShutdownLogger;
  /** Overridable for tests; production passes the process's resolved budget. */
  deadlineMs?: number;
  /** Overridable for tests, which must not kill the runner. */
  exit?: (code: number) => never;
}

/**
 * Runs each phase in order, logging a failure or timeout against the phase name and stepping
 * over it, and returns the first failure for a caller that still owes its own error contract.
 * Phases are sequential because each tears down something the next still needs.
 */
export async function runShutdownPhases({
  phases,
  logger,
}: {
  phases: ShutdownPhase[];
  logger: ShutdownLogger;
}): Promise<unknown> {
  let firstError: unknown;
  for (const phase of phases) {
    const phaseTimeoutMs = phase.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(phase.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `shutdown phase "${phase.name}" did not finish within ${phaseTimeoutMs}ms`,
                ),
              ),
            phaseTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      // Logged and stepped over, whether it threw or timed out. A websocket
      // server that will not close must not cost us the queue drain that comes
      // after it — that drain is the reason this sequence exists.
      logger.error({ error, phase: phase.name }, "shutdown phase failed");
      firstError ??= error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return firstError;
}

/**
 * Runs the phases under a process watchdog, flushes telemetry last, and exits.
 */
export async function runGracefulShutdown({
  signal,
  phases,
  logger,
  deadlineMs = DEFAULT_PROCESS_DEADLINE_MS,
  exit = process.exit.bind(process) as (code: number) => never,
}: RunGracefulShutdownOptions): Promise<void> {
  logger.info({ signal, deadlineMs }, "received signal, shutting down");

  // Deliberately NOT unref'd, and cleared in a finally below. An unref'd
  // watchdog stops holding the loop open, which sounds tidy until a phase
  // stalls on something that is not itself a handle: the loop empties, Node
  // exits 0, and a shutdown that never drained reports success.
  const deadline = setTimeout(() => {
    logger.error(
      { signal, deadlineMs },
      "graceful shutdown exceeded its deadline, exiting before the pod is killed",
    );
    exit(1);
  }, deadlineMs);

  // Telemetry flushes last, so the spans and logs describing this shutdown are
  // themselves exported. Appended here rather than by each caller: a provider
  // that flushes on its own signal handler is racing this sequence, and one
  // that calls process.exit() when its flush resolves wins the race.
  const all: ShutdownPhase[] = [
    ...phases,
    ...telemetryFlushes().map((f): ShutdownPhase => ({
      name: `telemetry:${f.name}`,
      run: f.run,
    })),
  ];

  try {
    await runShutdownPhases({ phases: all, logger });
  } finally {
    clearTimeout(deadline);
  }

  logger.info({ signal }, "graceful shutdown complete");
  exit(0);
}

/**
 * Wires SIGTERM/SIGINT to one shutdown run. Kubernetes sends SIGTERM and an
 * impatient operator adds a Ctrl-C on top; without the guard the second signal
 * starts a parallel teardown over half-closed handles.
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
