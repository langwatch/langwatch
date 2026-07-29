import { z } from "zod";

/** Process name, as mounted on the simulation pipeline. */
export const RUN_METRICS_PROCESS_NAME = "runMetrics";

export const RUN_METRICS_INTENT_TYPES = {
  COMPUTE_RUN_METRICS: "computeRunMetrics",
} as const;

/**
 * How long after a run reports its result its measurement waits.
 *
 * A scenario's spans are ingested on their own path and land a little after the
 * run finishes, so measuring at the instant of `finished` reads a half-written
 * trace. This is a durable deadline on the process instance, not a queue delay:
 * a delay lives only in the job it was attached to, so a worker lost while
 * holding it took the run's only measurement with it.
 */
export const RUN_METRICS_SETTLE_PERIOD_MS = 60_000;

/**
 * Delivery attempts for the one intent. The dispatch is a queue send that
 * either lands or does not, and losing it means a finished run permanently
 * shows no cost, so it is worth retrying across a restart.
 */
export const RUN_METRICS_MAX_ATTEMPTS = 5;

/** The intent enqueues a command and returns; it holds nothing while it runs. */
export const RUN_METRICS_LEASE_DURATION_MS = 60_000;

export interface RunMetricsState {
  /** Empty until the first event is folded; the process key is the same id. */
  scenarioRunId: string;
  /** When the settle period expires. Null when nothing is pending. */
  deadlineAt: number | null;
  /** The measurement has been asked for. A repeat `finished` does not re-ask. */
  requested: boolean;
  /**
   * The run was soft-deleted. Measuring it would spend reads and write cost
   * onto a row nobody can open, so a pending deadline is dropped.
   */
  deleted: boolean;
}

export const INITIAL_RUN_METRICS_STATE: RunMetricsState = {
  scenarioRunId: "",
  deadlineAt: null,
  requested: false,
  deleted: false,
};

/**
 * The content boundary. `finished` carries the judge's reasoning and the run's
 * error text, which the default `event.data` payload would persist verbatim into
 * process state and outbox rows. This process decides on identity and timing
 * alone, so the view is one id.
 */
export const runMetricsEventViewSchema = z.object({
  scenarioRunId: z.string().nullable(),
});

/**
 * Dispatch: measure this run.
 *
 * Deliberately just an identity. The traces to aggregate over are read from the
 * run's own stored state when the command runs, so nothing about which traces
 * exist is carried here or accumulated in process state — and a trace that
 * landed after the run finished is measured rather than missed.
 */
export const runMetricsComputeIntentSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
});

export type RunMetricsComputeIntent = z.infer<
  typeof runMetricsComputeIntentSchema
>;

/**
 * The outbox message key for a run's measurement.
 *
 * Derived from the run, never minted (ADR-081): the outbox skips a duplicate key
 * on insert, so a redelivered `finished` — or a second wake racing the first —
 * asks exactly once.
 */
export function computeRunMetricsMessageKey(scenarioRunId: string): string {
  return `measure:${scenarioRunId}`;
}
