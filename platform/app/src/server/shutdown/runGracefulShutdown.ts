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
  /**
   * How long this phase may take before the sequence moves on without it.
   *
   * Every phase gets one, because a phase that never settles takes the whole
   * shutdown with it — including the queue drain that is the point of the
   * exercise. The websocket close is the live example: it resolves only once
   * `wss.clients` is empty, and `ws` does not terminate clients for you, so a
   * single laptop-suspended tab holds it open indefinitely. Without a bound,
   * that tab prevents the drain from ever starting and the process dies at the
   * watchdog with nothing flushed.
   */
  timeoutMs?: number;
}

/**
 * Default ceiling for a phase that does not name its own.
 *
 * Sized so the common shutdown fits several phases inside the process
 * deadline. The drain phase overrides it — it legitimately needs the whole
 * budget and has its own internal bound.
 */
const DEFAULT_PHASE_TIMEOUT_MS = 10_000;

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

  // Deliberately NOT unref'd, and cleared in a finally below. An unref'd
  // watchdog stops holding the loop open, which sounds tidy until a phase
  // stalls on something that is not itself a handle: the loop empties, Node
  // exits 0, and a shutdown that never drained reports success. Keeping it
  // ref'd means the process stays alive long enough for the watchdog to say
  // what happened.
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
    ...telemetryFlushes().map(
      (f): ShutdownPhase => ({
        name: `telemetry:${f.name}`,
        run: f.run,
      }),
    ),
  ];

  try {
    for (const phase of all) {
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
        // server that will not close must not cost us the queue drain that
        // comes after it — that drain is the reason this sequence exists.
        logger.error({ error, phase: phase.name }, "shutdown phase failed");
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } finally {
    clearTimeout(deadline);
  }

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
