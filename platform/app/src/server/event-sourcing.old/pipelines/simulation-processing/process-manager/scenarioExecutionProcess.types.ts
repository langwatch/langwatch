import { z } from "zod";
import {
  CHILD_PROCESS,
  SCENARIO_WORKER,
} from "~/server/scenarios/scenario.constants";
import { scenarioFailureOutcomeSchema } from "~/server/scenarios/scenario-failure-outcome";

/** Process name, as mounted on the simulation pipeline. */
export const SCENARIO_EXECUTION_PROCESS_NAME = "scenarioExecution";

export const SCENARIO_EXECUTION_INTENT_TYPES = {
  EXECUTE_RUN: "executeRun",
  FAIL_RUN: "failRun",
} as const;

/**
 * How long a run may go quiet before it is declared dead.
 *
 * 2× the child-process timeout, the same bound the deleted read-time `STALLED`
 * derivation and both boot sweeps used — the sweeps still run, but only as a
 * cutover drain for runs stuck before this process existed. A child that hits
 * its own 15-minute cap still has a full cap's worth of margin to report the
 * failure itself, so this deadline only fires when nothing is left to report
 * it — which is exactly the case it exists for.
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
const SCENARIO_DISPATCH_PER_SIBLING_MS = 30_000;

/** Ceiling, so a pathological denominator cannot arm a deadline years out. */
const SCENARIO_DISPATCH_DEADLINE_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * How long THIS run may sit queued, given how many siblings it queued with.
 *
 * `batchTotal` rides on the `queued` event (ADR-103), so the denominator is
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
 * Delivery attempts, shared by both intents because the dispatcher is
 * configured per process rather than per intent type.
 *
 * Set for `failRun`, which is idempotent (`finishRun` collapses a repeat) and
 * whose loss would leave the run in exactly the non-terminal state this
 * process exists to prevent. `executeRun` must NOT inherit "try again" from
 * this number — a scenario costs money per run — so its at-most-once contract
 * is enforced inside its own handler, by reading back whether the run has
 * already left the queue. See `scenarioExecutionIntentHandlers.ts`.
 */
export const SCENARIO_EXECUTION_MAX_ATTEMPTS = 3;

/**
 * How long a leased dispatch stays invisible to other loops.
 *
 * `OutboxDispatcherService` leases once and never renews, and the `executeRun`
 * handler holds its lease for the entire child process. The lease therefore
 * has to outlast the child's own cap, or a second worker re-leases a message
 * whose run is still alive and spawns it twice. The margin covers prefetch,
 * spawn and the terminal write on either side of the child.
 */
const SCENARIO_EXECUTION_LEASE_MARGIN_MS = 5 * 60 * 1000;
export const SCENARIO_EXECUTION_LEASE_DURATION_MS =
  CHILD_PROCESS.TIMEOUT_MS + SCENARIO_EXECUTION_LEASE_MARGIN_MS;

/**
 * In-flight dispatches per worker. This is what the pool's `_pending` array
 * used to bound: pending work is now a Postgres row and the dispatcher is the
 * only thing deciding how many children a worker holds at once.
 *
 * `batchSize` matches, because dispatches here take minutes — leasing more
 * than can be in flight would hide the surplus behind a 20-minute lease.
 */
export const SCENARIO_EXECUTION_CONCURRENCY = SCENARIO_WORKER.CONCURRENCY;

/** The reference the child process is spawned against. */
export const scenarioExecutionTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

export type ScenarioExecutionTarget = z.infer<
  typeof scenarioExecutionTargetSchema
>;

export interface ScenarioExecutionState {
  /** Empty until the first event carrying identities is folded. */
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  setId: string;
  /**
   * What to execute, carried by the `queued` event. Null for a run whose
   * `queued` event predates the field, which is a run nothing can dispatch —
   * the deadline finalises it rather than the outbox.
   */
  target: ScenarioExecutionTarget | null;
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
  target: null,
  cancelRequested: false,
  settled: false,
};

/**
 * The content boundary. Simulation events carry conversation messages, so the
 * default `event.data` payload would persist customer content into process
 * state and outbox rows. This process needs identities, and the target
 * reference it has to dispatch against, and nothing else.
 */
export const scenarioExecutionEventViewSchema = z.object({
  scenarioRunId: z.string().nullable(),
  scenarioId: z.string().nullable(),
  batchRunId: z.string().nullable(),
  scenarioSetId: z.string().nullable(),
  /**
   * How many runs the batch set out to queue. Only `queued` carries it, and
   * only since ADR-103 — absent everywhere else, which is why it is nullable
   * rather than defaulted to 1.
   */
  batchTotal: z.number().int().nonnegative().nullable().optional(),
  /**
   * Nullish rather than nullable: step 1's narrowed view had no `target` at
   * all, so an inbox row written before this change omits the key entirely.
   * A required field here would throw on every one of those and wedge the
   * process for exactly the runs that were in flight across the deploy.
   */
  target: scenarioExecutionTargetSchema.nullish().transform((t) => t ?? null),
});

/**
 * Dispatch: run this scenario. The handler holds its outbox lease for the
 * whole child process, which is why the lease above is sized from the child's
 * timeout rather than from a write.
 */
export const scenarioExecutionExecuteRunIntentSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  target: scenarioExecutionTargetSchema,
});

export type ScenarioExecutionExecuteRunIntent = z.infer<
  typeof scenarioExecutionExecuteRunIntentSchema
>;

export const scenarioExecutionFailRunIntentSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  /** Which terminal status to write. One modelled outcome, not two booleans. */
  outcome: scenarioFailureOutcomeSchema,
  /** Human-readable cause, recorded on the terminal event. */
  reason: z.string(),
});

export type ScenarioExecutionFailRunIntent = z.infer<
  typeof scenarioExecutionFailRunIntentSchema
>;

/**
 * The outbox message key for a run's dispatch.
 *
 * Derived from the run, never minted (ADR-098). The outbox skips a duplicate
 * key on insert, so a `queued` event that is folded twice enqueues one
 * dispatch — the idempotency is the key, not a claim table.
 */
export function executeRunMessageKey(scenarioRunId: string): string {
  return `execute:${scenarioRunId}`;
}

/** The outbox message key for a run's terminal write. Derived for the same reason. */
export function failRunMessageKey(scenarioRunId: string): string {
  return `fail:${scenarioRunId}`;
}
