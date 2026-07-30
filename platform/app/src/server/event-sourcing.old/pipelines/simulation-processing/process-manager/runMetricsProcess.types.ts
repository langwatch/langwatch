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
 * When to measure again after a measurement came back with nothing to record,
 * as delays from the measurement that found nothing.
 *
 * **Why re-measure at all.** The settle period is a bet that cost enrichment
 * beats the deadline, and the run's `finished` event is not what it is racing:
 * spans are exported on the agent SDK's own schedule and priced when they fold,
 * so a run can report its result before its traces exist at all. Measure once
 * and a lost bet is permanent — every trace read, none of them priced yet, and
 * nothing ever asks again. The per-trace path this replaced did ask again
 * (three retries on exactly this condition); the retry was dropped when the
 * trigger moved onto the process manager, not decided against.
 *
 * **Why on the empty answer specifically.** It is the one signal that separates
 * "measured too early" from "measured". Re-arming on it re-reads only the runs
 * that lost the bet; every run whose measurement recorded something is
 * disarmed by its own `metrics_recorded` event and never pays for this.
 *
 * **Why these numbers.** Geometric, and short: the first covers enrichment
 * lagging the run by more than the settle period, the second covers an ingest
 * or fold backlog, which is the only failure mode that runs to minutes. Beyond
 * that the honest reading is not "late" but "this run has no cost to show" — an
 * uninstrumented agent, or a model we hold no price for — and re-asking spends
 * a fold read plus one read per trace on every such run, forever.
 */
export const RUN_METRICS_REMEASURE_DELAYS_MS = [120_000, 900_000] as const;

/**
 * The hard cap on how many times one run is measured: the settled measurement
 * plus one per re-measure delay.
 *
 * The ladder running out is what stops the process, so this is derived from it
 * rather than declared beside it — two numbers that must agree is one that can
 * disagree.
 */
export const RUN_METRICS_MAX_MEASUREMENTS =
  RUN_METRICS_REMEASURE_DELAYS_MS.length + 1;

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
  /**
   * When the next measurement is due — the settle period first, then a
   * re-measure. Null when nothing is pending.
   */
  deadlineAt: number | null;
  /**
   * How many measurements have been asked for. Zero until the settle period
   * elapses; capped at {@link RUN_METRICS_MAX_MEASUREMENTS}, which is what
   * makes a run whose traces never report a cost stop asking. A repeat
   * `finished` does not re-ask once this has moved.
   */
  attempts: number;
  /**
   * A measurement was recorded. Set from the run's own `metrics_recorded`
   * event, and the only thing that ends the re-measure ladder early.
   */
  measured: boolean;
  /**
   * The run was soft-deleted. Measuring it would spend reads and write cost
   * onto a row nobody can open, so a pending deadline is dropped.
   */
  deleted: boolean;
}

export const INITIAL_RUN_METRICS_STATE: RunMetricsState = {
  scenarioRunId: "",
  deadlineAt: null,
  attempts: 0,
  measured: false,
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
 * The outbox message key for one of a run's measurements.
 *
 * Derived from the run and the attempt it belongs to, never minted (ADR-098):
 * the outbox skips a duplicate key on insert, so a redelivered `finished` — or
 * a second wake racing the first, which sees the same stored state and so
 * computes the same attempt — asks exactly once.
 *
 * The attempt is in the key because that same suppression is total: a key that
 * did not vary would let the process record a re-measure it asked for, have the
 * outbox drop it as already-dispatched, and leave the run unpriced with nothing
 * failing anywhere.
 */
export function computeRunMetricsMessageKey(
  scenarioRunId: string,
  attempt: number,
): string {
  return `measure:${scenarioRunId}:${attempt}`;
}
