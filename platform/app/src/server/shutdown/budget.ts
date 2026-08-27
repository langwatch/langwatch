/**
 * The one place that decides how long shutdown may take.
 *
 * Four clocks run during a pod's termination, and they are nested, not
 * parallel. Each must finish inside the one outside it, or the outer clock
 * fires mid-drain and the work the inner one was protecting is lost anyway:
 *
 *   terminationGracePeriodSeconds   kubelet SIGKILL      (charts/langwatch)
 *   └─ processDeadlineMs            force-exit watchdog  (start.ts, workers.ts)
 *      ├─ httpClosePhaseMs          http-server phase    (httpServerClosePhase.ts)
 *      │  └─ httpDrainGraceMs       in-flight requests   (httpServerClosePhase.ts)
 *      └─ appCloseMs                App.close backstop   (app-layer/app.ts)
 *         └─ queueDrainMs           GroupQueueProcessor  (groupQueue.ts)
 *
 * The http pair is a sibling of appCloseMs rather than a parent: the phases
 * run in sequence, so both are spent out of the same process deadline.
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
 * The share of PROCESS_SLACK_MS the http-server phase may spend. The rest of
 * that slack pays for the worker stack teardown and the telemetry flush that
 * run after it, so the drain cannot have all of it.
 */
const HTTP_CLOSE_PHASE_SHARE = 0.5;

/**
 * Room inside the http-server phase for the work either side of the drain:
 * the MCP session teardown before it, and the close callback firing after the
 * stragglers are destroyed. What is left is what in-flight requests get.
 */
const HTTP_CLOSE_SLACK_MS = 2_000;

/**
 * Slack between the process giving up on its own and the kubelet's SIGKILL.
 * Covers the signal-to-handler gap and the kubelet's own bookkeeping, and
 * guarantees the log line explaining the overrun is written and shipped before
 * the process dies.
 */
export const KUBELET_SLACK_MS = 10_000;

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development" || process.env.ENVIRONMENT === "local";
}

/**
 * Reads the drain budget. `SHUTDOWN_DRAIN_TIMEOUT_MS` overrides it — raise it
 * for a queue running long jobs, and raise the chart's
 * terminationGracePeriodSeconds to match (the chart refuses to render
 * otherwise).
 */
function resolveDrainMs(): number {
  const fallback = isDevelopment() ? DEV_DRAIN_MS : DEFAULT_DRAIN_MS;
  const raw = process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  if (raw === void 0 || raw === "") return fallback;

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  // Loud, but NOT fatal. This module is evaluated on the boot path of every
  // process, so throwing here would turn one bad character in a value that
  // only matters during shutdown into a crashloop across the whole fleet —
  // trading a healthy running system for a misconfigured death budget. The
  // chart refuses to render such a value in the first place
  // (langwatch.positiveSeconds), so reaching this branch means the variable
  // was set by hand; carry on with a budget that works and say so.
  console.error(
    `[shutdown] SHUTDOWN_DRAIN_TIMEOUT_MS must be a positive number of milliseconds, got "${raw}" — falling back to ${fallback}ms. The pod's terminationGracePeriodSeconds may not match this budget.`,
  );
  return fallback;
}

export interface ShutdownBudget {
  /** GroupQueueProcessor.close() — waiting for in-flight jobs. */
  queueDrainMs: number;
  /** App.close() — the whole EventSourcing drain, queue included. */
  appCloseMs: number;
  /** The entrypoint watchdog: exit on our own terms before the kubelet does. */
  processDeadlineMs: number;
  /** The http-server phase's own ceiling, named so it never inherits the default. */
  httpClosePhaseMs: number;
  /**
   * How long in-flight requests get before the leftover sockets are destroyed.
   * Sits inside httpClosePhaseMs, or the runner abandons the phase before the
   * destroy it exists to perform.
   */
  httpDrainGraceMs: number;
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
  const httpClosePhaseMs = Math.floor(
    PROCESS_SLACK_MS * HTTP_CLOSE_PHASE_SHARE,
  );
  return {
    queueDrainMs,
    appCloseMs,
    processDeadlineMs,
    requiredGracePeriodSeconds: Math.ceil((processDeadlineMs + KUBELET_SLACK_MS) / 1000),
  };
}

/**
 * Resolved once at module load so every consumer in a process sees the same
 * numbers. Tests that need a different budget call resolveShutdownBudget()
 * directly rather than mutating this.
 */
export const SHUTDOWN_BUDGET: ShutdownBudget = resolveShutdownBudget();
