/**
 * The one place that decides how long shutdown may take.
 *
 * Four clocks run during a pod's termination, and they are nested, not
 * parallel. Each must finish inside the one outside it, or the outer clock
 * fires mid-drain and the work the inner one was protecting is lost anyway:
 *
 *   terminationGracePeriodSeconds   kubelet SIGKILL      (charts/langwatch)
 *   └─ processDeadlineMs            force-exit watchdog  (start.ts, workers.ts)
 *      └─ appCloseMs                App.close backstop   (app-layer/app.ts)
 *         └─ queueDrainMs           GroupQueueProcessor  (groupQueue.ts)
 *
 * They used to be four independent literals in four files, agreeing only by
 * comment — and they did not agree. start.ts force-exited at 5s while the
 * GroupQueue was still entitled to 20s, so the app's in-process worker stack
 * (the `all` role) could never actually finish a drain. Deriving them from one
 * number is what stops that returning: raise the drain budget and every clock
 * above it moves with it.
 *
 * Only the innermost number is configurable. The slack above it is fixed
 * because it pays for work whose cost does not scale with queue depth —
 * closing the HTTP server, tearing down the worker stack, flushing telemetry.
 */

/** Time the GroupQueue may spend waiting for in-flight jobs to finish. */
const DEFAULT_DRAIN_MS = 25_000;

/**
 * Dev drains near-instantly, and a developer waiting the full production
 * budget for Ctrl-C is worse than losing a job on a local queue. Long enough
 * to finish a real in-flight write, short enough not to be in the way.
 */
const DEV_DRAIN_MS = 5_000;

/** Room for the rest of EventSourcing.close() once the queue itself is drained. */
const APP_CLOSE_SLACK_MS = 5_000;

/**
 * Room for everything the entrypoints do around App.close: closing the HTTP
 * server and websockets, tearing down the worker stack, flushing PostHog.
 */
const PROCESS_SLACK_MS = 15_000;

/**
 * Slack between the process giving up on its own and the kubelet's SIGKILL.
 * Covers the signal-to-handler gap and the kubelet's own bookkeeping, and
 * guarantees the log line explaining the overrun is written and shipped before
 * the process dies.
 */
export const KUBELET_SLACK_MS = 10_000;

function isDevelopment(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENVIRONMENT === "local"
  );
}

/**
 * Reads the drain budget. `SHUTDOWN_DRAIN_TIMEOUT_MS` overrides it — raise it
 * for a queue running long jobs, and raise the chart's
 * terminationGracePeriodSeconds to match (the chart refuses to render
 * otherwise).
 */
function resolveDrainMs(): number {
  const raw = process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  if (raw !== void 0 && raw !== "") {
    const parsed = Number(raw);
    // Silently falling back on a typo'd override would hand back the default
    // budget under a name that promises otherwise, which is the failure this
    // module exists to prevent. Fail where the value is set instead.
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `SHUTDOWN_DRAIN_TIMEOUT_MS must be a positive number of milliseconds, got "${raw}"`,
      );
    }
    return parsed;
  }
  return isDevelopment() ? DEV_DRAIN_MS : DEFAULT_DRAIN_MS;
}

export interface ShutdownBudget {
  /** GroupQueueProcessor.close() — waiting for in-flight jobs. */
  queueDrainMs: number;
  /** App.close() — the whole EventSourcing drain, queue included. */
  appCloseMs: number;
  /** The entrypoint watchdog: exit on our own terms before the kubelet does. */
  processDeadlineMs: number;
  /**
   * The smallest terminationGracePeriodSeconds that can hold all of the above.
   * The chart asserts against this; nothing at runtime can enforce it, because
   * by the time SIGKILL arrives there is no process left to complain.
   */
  requiredGracePeriodSeconds: number;
}

export function resolveShutdownBudget(): ShutdownBudget {
  const queueDrainMs = resolveDrainMs();
  const appCloseMs = queueDrainMs + APP_CLOSE_SLACK_MS;
  const processDeadlineMs = appCloseMs + PROCESS_SLACK_MS;
  return {
    queueDrainMs,
    appCloseMs,
    processDeadlineMs,
    requiredGracePeriodSeconds: Math.ceil(
      (processDeadlineMs + KUBELET_SLACK_MS) / 1000,
    ),
  };
}

/**
 * Resolved once at module load so every consumer in a process sees the same
 * numbers. Tests that need a different budget call resolveShutdownBudget()
 * directly rather than mutating this.
 */
export const SHUTDOWN_BUDGET: ShutdownBudget = resolveShutdownBudget();
