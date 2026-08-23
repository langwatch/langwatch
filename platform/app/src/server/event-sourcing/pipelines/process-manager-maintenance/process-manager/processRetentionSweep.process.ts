import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { toSafeFailureDiagnostic } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import {
  incrementProcessManagerRetentionFailures,
  incrementProcessManagerRetentionSweptRows,
} from "~/server/metrics";

const logger = createLogger("langwatch:process-manager:retention-sweep");

export const PROCESS_RETENTION_SWEEP_PROCESS_NAME =
  "processRetentionSweep" as const;

/**
 * Hourly. The tables this reaps grow with traffic, so the interval only has to
 * be short enough that one wake's bounded budget keeps up with an hour of
 * inserts, which at the observed peak (roughly 360k outbox rows in a day) it
 * comfortably does.
 */
export const PROCESS_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Dispatched outbox rows are completed work. 24h is long enough that an
 * operator debugging this morning's incident still finds the rows, and short
 * enough that the steady-state table is a day of traffic rather than a year.
 *
 * LOAD-BEARING BEYOND DEBUGGABILITY. A TRANSIENT evolution writes no inbox
 * marker, so for those processes the dispatched row IS the idempotency
 * record and this window is how long a redelivery stays suppressed. That is
 * a weaker guarantee than the inbox below gives, and knowingly so: this
 * number was picked for table size, it is SHORTER than the ~25h redelivery
 * horizon that number is reasoned against, and raising it would give back
 * the row growth the transient path exists to remove.
 *
 * What makes it safe is a precondition on `.transient()` rather than this
 * constant: a transient process's intent handlers must be idempotent at
 * their own sink, so a redelivery past this window costs a duplicate
 * DISPATCH and never a duplicate EFFECT. Both current transient processes
 * satisfy it — gateway debits collapse on
 * `(TenantId, BudgetId, GatewayRequestId)` in the ledger, and webhook
 * delivery claims its idempotency key before sending. Before making a
 * process transient, confirm its sinks do the same; see
 * packages/eventing/specs/transient-process-instances.feature.
 */
export const DISPATCHED_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Dead rows are the operator's failure record, not completed work, so they get
 * a month rather than a day.
 */
export const DEAD_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Inbox rows are idempotency markers, so the window only has to outlive the
 * horizon in which the same source event can be redelivered. Origin guards
 * reject events older than 1h and traces older than 24h, and the longest
 * debounce bucket is 600s, which puts that horizon around 25h. Seven days is a
 * wide margin over it, and the `TriggerSent` claim is a second layer against a
 * double side effect regardless.
 */
export const CONSUMED_INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows deleted per statement. Bounds one statement's lock footprint. */
export const RETENTION_SWEEP_BATCH_SIZE = 5_000;

/**
 * The ceiling on batches per family per wake, reached by the ramp below rather
 * than on the first tick. It degrades a huge backlog into "drains a million
 * rows an hour" rather than "holds the database for as long as it takes",
 * which is the failure mode an unbounded catch-up delete has.
 */
export const RETENTION_SWEEP_MAX_BATCHES_PER_WAKE = 200;

/**
 * Batches per family on the first wake. The budget doubles every wake after it
 * until it reaches the ceiling above.
 *
 * The batch SIZE bounds one statement's lock footprint and the batch CEILING
 * bounds how many statements a wake issues, but neither bounds what the deletes
 * cost the instance underneath: write-ahead log, dead tuples until autovacuum
 * catches up, and index churn. A wake that opened at the full ceiling would
 * spend all of that at once, and the first wake is exactly when the backlog is
 * largest and the free space smallest. That is the shape that turns a cleanup
 * into the write outage it exists to prevent.
 *
 * Ramping instead reaches the ceiling in seven wakes, so a multi-million row
 * backlog still drains within a day while the early hours stay small enough for
 * checkpoints and autovacuum to keep pace. It costs nothing in steady state,
 * where an hour of traffic is a few batches and even the first wake's budget is
 * never spent.
 */
export const RETENTION_SWEEP_INITIAL_BATCHES_PER_WAKE = 5;

/**
 * Pause between delete statements, so a wake leaves the instance room to serve
 * the pipeline that is still writing to these tables. The one-time backlog
 * purge paces itself the same way, and this worker has more reason to rather
 * than less: it runs hourly with nobody watching the database while it works.
 */
export const RETENTION_SWEEP_BATCH_PAUSE_MS = 200;

/**
 * Outbox lease for the sweep intent. Generous because a wake that has ramped to
 * the ceiling spends 600 paced delete statements across the three families,
 * which takes far longer than the handful a steady-state hour needs.
 */
export const PROCESS_RETENTION_SWEEP_LEASE_MS = 15 * 60 * 1000;

/**
 * Wall-clock budget for one wake, deliberately well under the lease.
 *
 * The batch ceiling alone does not bound TIME: 600 delete statements against a
 * loaded database can outlast the lease, and once it expires another worker
 * leases the same row and starts a second sweep while the first is still
 * deleting. Two sweeps on the same predicates is not a correctness problem —
 * the deletes are idempotent — but it doubles the write load at exactly the
 * moment the database is already struggling, which is how a slow sweep becomes
 * an outage. Stopping early instead just leaves the remainder for the next
 * hourly tick.
 */
export const RETENTION_SWEEP_DEADLINE_MS = 10 * 60 * 1000;

export const processRetentionSweepSchema = z.object({
  scheduledFor: z.number().int(),
  /**
   * Optional so a payload written without it drains at the opening budget
   * rather than the ceiling, which is the safe direction to guess in.
   */
  maxBatchesPerFamily: z.number().int().positive().optional(),
});

export type ProcessRetentionSweepPayload = z.output<
  typeof processRetentionSweepSchema
>;

export interface ProcessRetentionSweepState {
  lastSweepAt: number | null;
  /** Wakes this process has scheduled, which is what the ramp counts. */
  sweepsScheduled: number;
}

/**
 * Batches one family may spend on a wake that follows `priorWakes` earlier
 * ones: the opening budget doubled once per wake, up to the ceiling.
 */
export function retentionSweepBatchBudget(priorWakes: number): number {
  const doublings = Math.min(Math.max(priorWakes, 0), 32);
  return Math.min(
    RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
    RETENTION_SWEEP_INITIAL_BATCHES_PER_WAKE * 2 ** doublings,
  );
}

/** The three row families this sweep reaps, each with its own window. */
export type RetentionFamily = "dispatched_outbox" | "dead_outbox" | "inbox";

export interface ProcessRetentionSweepDeps {
  deleteDispatchedOutboxBatch: (params: {
    before: number;
    limit: number;
  }) => Promise<number>;
  deleteDeadOutboxBatch: (params: {
    before: number;
    limit: number;
  }) => Promise<number>;
  deleteConsumedInboxBatch: (params: {
    before: number;
    limit: number;
  }) => Promise<number>;
  now?: () => number;
  /** Overridable so a test does not wait out the pacing pause. */
  sleep?: (ms: number) => Promise<void>;
}

type ProcessRetentionSweepIntents = {
  sweep: IntentSpec<typeof processRetentionSweepSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads —
 * because the commit that persists this evolution is what fences racing
 * workers. The deletes themselves are an intent, so they run behind the outbox
 * lease instead, and exactly one worker per tick does the work.
 */
export const processRetentionSweepWake: WakeHandler<
  ProcessRetentionSweepState,
  ProcessRetentionSweepIntents
> = (state, ctx) => {
  const priorWakes = state.sweepsScheduled ?? 0;
  return {
    state: { lastSweepAt: ctx.at, sweepsScheduled: priorWakes + 1 },
    intents: [
      ctx.intents.sweep(`sweep:${ctx.at}`, {
        scheduledFor: ctx.at,
        maxBatchesPerFamily: retentionSweepBatchBudget(priorWakes),
      }),
    ],
  };
};

type DeleteBatch = (params: {
  before: number;
  limit: number;
}) => Promise<number>;

interface FamilyPlan {
  family: RetentionFamily;
  deleteBatch: DeleteBatch;
  /** Rows older than this epoch ms are eligible for this family. */
  before: number;
}

/** The three families and the cutoff each one reaps behind, for this wake. */
function planFamilies(
  deps: ProcessRetentionSweepDeps,
  startedAt: number,
): FamilyPlan[] {
  return [
    {
      family: "dispatched_outbox",
      deleteBatch: deps.deleteDispatchedOutboxBatch,
      before: startedAt - DISPATCHED_OUTBOX_RETENTION_MS,
    },
    {
      family: "dead_outbox",
      deleteBatch: deps.deleteDeadOutboxBatch,
      before: startedAt - DEAD_OUTBOX_RETENTION_MS,
    },
    {
      family: "inbox",
      deleteBatch: deps.deleteConsumedInboxBatch,
      before: startedAt - CONSUMED_INBOX_RETENTION_MS,
    },
  ];
}

/**
 * Drains one family in bounded batches until it runs dry, the wake's batch
 * budget is spent, or the deadline passes. A short batch means the family is
 * drained, which is what ends the loop without issuing a delete that would
 * match nothing.
 */
async function drainFamily({
  deleteBatch,
  before,
  deadline,
  now,
  maxBatches,
  sleep,
}: {
  deleteBatch: DeleteBatch;
  before: number;
  deadline: number;
  now: () => number;
  maxBatches: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    if (now() >= deadline) break;
    const deleted = await deleteBatch({
      before,
      limit: RETENTION_SWEEP_BATCH_SIZE,
    });
    total += deleted;
    if (deleted < RETENTION_SWEEP_BATCH_SIZE) break;
    await sleep(RETENTION_SWEEP_BATCH_PAUSE_MS);
  }
  return total;
}

/**
 * Drains one family and reports it. Never throws: one family's failure must not
 * cost the others their sweep. The whole point of this process manager is that
 * the tables cannot grow unbounded, and a shared try/catch would let one bad
 * statement stop the other two indefinitely.
 */
async function sweepFamily(
  plan: FamilyPlan,
  {
    deadline,
    now,
    maxBatches,
    sleep,
  }: {
    deadline: number;
    now: () => number;
    maxBatches: number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<number> {
  try {
    const rows = await drainFamily({
      ...plan,
      deadline,
      now,
      maxBatches,
      sleep,
    });
    incrementProcessManagerRetentionSweptRows(plan.family, rows);
    return rows;
  } catch (error) {
    incrementProcessManagerRetentionFailures(plan.family);
    logger.error(
      { ...toSafeFailureDiagnostic(error), family: plan.family },
      "Process-manager retention sweep failed for one family",
    );
    return 0;
  }
}

export function runProcessRetentionSweep(deps: ProcessRetentionSweepDeps) {
  return async (payload: ProcessRetentionSweepPayload): Promise<void> => {
    const now = deps.now ?? Date.now;
    const sleep =
      deps.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    // Clamped here rather than bounded in the schema. The only writer is the
    // wake handler above, which already caps the budget, so a larger value
    // could only arrive on a payload this code did not write. Rejecting one
    // would fail the intent, exhaust its retries and dead-letter the sweep,
    // which stops retention altogether and regrows the tables this exists to
    // bound. Clamping holds the delete loop to the same ceiling and keeps the
    // sweep running.
    const maxBatches = Math.min(
      payload.maxBatchesPerFamily ?? RETENTION_SWEEP_INITIAL_BATCHES_PER_WAKE,
      RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
    );
    const startedAt = now();
    const deadline = startedAt + RETENTION_SWEEP_DEADLINE_MS;

    const swept: Record<RetentionFamily, number> = {
      dispatched_outbox: 0,
      dead_outbox: 0,
      inbox: 0,
    };
    const plans = planFamilies(deps, startedAt);
    for (const [index, plan] of plans.entries()) {
      // Each family's window ends at its share of the wake, measured from the
      // start: family i may not run past (i+1)/N of the budget. A family that
      // finishes early donates its leftover to the ones after it, but a
      // backlogged first family can never spend the whole wake and leave the
      // families behind it starved on every single run — with inbox last and
      // biggest, that shape would quietly regrow the incident this sweep
      // exists to prevent.
      const familyDeadline = Math.min(
        deadline,
        startedAt +
          Math.floor(
            ((index + 1) * RETENTION_SWEEP_DEADLINE_MS) / plans.length,
          ),
      );
      swept[plan.family] = await sweepFamily(plan, {
        deadline: familyDeadline,
        now,
        maxBatches,
        sleep,
      });
    }

    const durationMs = now() - startedAt;
    logger.info(
      {
        dispatchedOutboxRows: swept.dispatched_outbox,
        deadOutboxRows: swept.dead_outbox,
        inboxRows: swept.inbox,
        durationMs,
        // The budget this wake was allowed, so an operator watching the first
        // hours after deploy can see the ramp climbing toward the ceiling.
        maxBatchesPerFamily: maxBatches,
        // A wake that stops on the deadline leaves work behind on purpose. It
        // is not an error, but a run of them means the hourly budget is no
        // longer keeping up with the insert rate.
        hitDeadline: durationMs >= RETENTION_SWEEP_DEADLINE_MS,
      },
      "Process-manager retention sweep completed",
    );
  };
}
