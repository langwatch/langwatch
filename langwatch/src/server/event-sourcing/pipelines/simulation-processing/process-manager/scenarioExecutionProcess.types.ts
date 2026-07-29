import { z } from "zod";

import { CHILD_PROCESS } from "~/server/scenarios/scenario.constants";

/** Process name, as mounted on the simulation pipeline. */
export const SCENARIO_EXECUTION_PROCESS_NAME = "scenarioExecution";

export const SCENARIO_EXECUTION_INTENT_TYPES = {
  FAIL_RUN: "failRun",
} as const;

/**
 * How long a run may go quiet before it is declared dead.
 *
 * 2× the child-process timeout, the same bound the legacy stall derivation and
 * both boot sweeps used — the sweeps still run, but only as a cutover drain for
 * runs stuck before this process existed. A child that hits its own 15-minute
 * cap still has a full cap's worth of margin to report the failure itself, so
 * this deadline only fires when nothing is left to report it — which is exactly
 * the case it exists for.
 */
export const SCENARIO_PROGRESS_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;

/**
 * Floor for how long a run may sit queued before it is declared undispatched.
 *
 * Queue wait is NOT evidence of worker death: a run waits behind its own batch
 * siblings for as long as the batch takes, and nothing about that is unhealthy.
 * A fixed window is therefore the wrong shape — it either fires on a large
 * healthy batch or is too slack to catch a small abandoned one.
 *
 * So the window is derived from the batch instead: see
 * {@link dispatchDeadlineMsFor}. This is the floor it starts from, matching the
 * progress deadline so a single-run batch behaves exactly as a running one.
 */
export const SCENARIO_DISPATCH_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;

/**
 * Additional queue allowance per sibling in the batch.
 *
 * A batch of N runs drains at the pool's concurrency, so the last sibling's
 * legitimate wait grows with N. Rather than guess the concurrency — which is
 * per-deployment and not visible from the fold — each sibling buys the run a
 * further slice of patience. Generous on purpose: this deadline exists to
 * catch a run nothing will ever dispatch, and being late to that costs a stuck
 * row, while being early costs a healthy run its result.
 */
export const SCENARIO_DISPATCH_PER_SIBLING_MS = 30_000;

/** Ceiling, so a pathological denominator cannot arm a deadline years out. */
export const SCENARIO_DISPATCH_DEADLINE_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * How long THIS run may sit queued, given how many siblings it queued with.
 *
 * `batchTotal` rides on the `queued` event (ADR-072), so the denominator is
 * known at the moment the deadline is armed — no read, no extra state.
 * A run whose event predates the denominator gets the floor, which is the same
 * bound it had before this was derived at all.
 */
export function dispatchDeadlineMsFor(batchTotal: number): number {
  const siblings =
    Number.isFinite(batchTotal) && batchTotal > 1 ? batchTotal - 1 : 0;
  return Math.min(
    SCENARIO_DISPATCH_DEADLINE_MS + siblings * SCENARIO_DISPATCH_PER_SIBLING_MS,
    SCENARIO_DISPATCH_DEADLINE_CAP_MS,
  );
}

/**
 * How long a cancel may take to be honoured before the run is finalised as
 * cancelled anyway.
 *
 * Short, because cancellation is a Redis broadcast to a live child: either a
 * worker holds the child and SIGTERMs it within seconds, or no worker holds
 * it and no amount of waiting will produce a terminal event.
 */
export const SCENARIO_CANCEL_DEADLINE_MS = 60_000;

/**
 * Retries for the terminal-write intent. `finishRun` is idempotent, so a
 * retried write is harmless — and losing it would leave the run in exactly
 * the non-terminal state this process exists to prevent.
 *
 * This is not the scenario's own no-retry contract: nothing is re-executed
 * here, only the record of its death is written.
 */
export const SCENARIO_EXECUTION_MAX_ATTEMPTS = 3;

/** A terminal write is one command dispatch; it does not need a long lease. */
export const SCENARIO_EXECUTION_LEASE_DURATION_MS = 60_000;

export interface ScenarioExecutionState {
  /** Empty until the first event carrying identities is folded. */
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  setId: string;
  /**
   * A cancel was asked for. Decides which terminal status a fired deadline
   * writes — a run the user cancelled is CANCELLED even if no worker was left
   * alive to honour it.
   */
  cancelRequested: boolean;
  /** A terminal event arrived, or a wake wrote one. The deadline stays off. */
  settled: boolean;
}

export const INITIAL_SCENARIO_EXECUTION_STATE: ScenarioExecutionState = {
  scenarioRunId: "",
  scenarioId: "",
  batchRunId: "",
  setId: "",
  cancelRequested: false,
  settled: false,
};

/**
 * The content boundary. Simulation events carry conversation messages, so the
 * default `event.data` payload would persist customer content into process
 * state and outbox rows. This process needs identities and nothing else.
 */
export const scenarioExecutionEventViewSchema = z.object({
  scenarioRunId: z.string().nullable(),
  scenarioId: z.string().nullable(),
  batchRunId: z.string().nullable(),
  scenarioSetId: z.string().nullable(),
  /**
   * How many runs the batch set out to queue. Only `queued` carries it, and
   * only since ADR-072 — absent everywhere else, which is why it is nullable
   * rather than defaulted to 1.
   */
  batchTotal: z.number().int().nonnegative().nullable().optional(),
});

export type ScenarioExecutionEventView = z.infer<
  typeof scenarioExecutionEventViewSchema
>;

export const scenarioExecutionFailRunIntentSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  /** Write CANCELLED rather than ERROR. */
  cancelled: z.boolean(),
  /** Human-readable cause, recorded on the terminal event. */
  reason: z.string(),
});

export type ScenarioExecutionFailRunIntent = z.infer<
  typeof scenarioExecutionFailRunIntentSchema
>;
