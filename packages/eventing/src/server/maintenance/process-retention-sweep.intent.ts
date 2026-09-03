import { createLogger } from "@langwatch/observability";
import { toSafeFailureDiagnostic } from "../../process-manager/failureDiagnostic";
import {
  CONSUMED_INBOX_RETENTION_MS,
  DEAD_OUTBOX_RETENTION_MS,
  DISPATCHED_OUTBOX_RETENTION_MS,
  type ProcessRetentionSweepPayload,
  RETENTION_SWEEP_BATCH_PAUSE_MS,
  RETENTION_SWEEP_BATCH_SIZE,
  RETENTION_SWEEP_DEADLINE_MS,
  RETENTION_SWEEP_INITIAL_BATCHES_PER_WAKE,
  RETENTION_SWEEP_MAX_BATCHES_PER_WAKE,
} from "./process-retention-sweep.process";
import type { ProcessRetentionMetricsPort, RetentionFamily } from "./retention-metrics.port";

const logger = createLogger("langwatch:process-manager:retention-sweep");

export interface ProcessRetentionSweepDeps {
  deleteDispatchedOutboxBatch: (params: { before: number; limit: number }) => Promise<number>;
  deleteDeadOutboxBatch: (params: { before: number; limit: number }) => Promise<number>;
  deleteConsumedInboxBatch: (params: { before: number; limit: number }) => Promise<number>;
  metrics: ProcessRetentionMetricsPort;
  now?: () => number;
  /** Overridable so a test does not wait out the pacing pause. */
  sleep?: (ms: number) => Promise<void>;
}

type DeleteBatch = (params: { before: number; limit: number }) => Promise<number>;

interface FamilyPlan {
  family: RetentionFamily;
  deleteBatch: DeleteBatch;
  /** Rows older than this epoch ms are eligible for this family. */
  before: number;
}

/** The three families and the cutoff each one reaps behind, for this wake. */
function planFamilies(deps: ProcessRetentionSweepDeps, startedAt: number): FamilyPlan[] {
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
    metrics,
  }: {
    deadline: number;
    now: () => number;
    maxBatches: number;
    sleep: (ms: number) => Promise<void>;
    metrics: ProcessRetentionMetricsPort;
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
    metrics.recordSweptRows(plan.family, rows);
    return rows;
  } catch (error) {
    metrics.recordFailure(plan.family);
    logger.error(
      { ...toSafeFailureDiagnostic(error), family: plan.family },
      "Process-manager retention sweep failed for one family",
    );
    return 0;
  }
}

/**
 * The sweep's external work, kept out of the process definition so the
 * definition stays pure and synchronous. Redelivery is safe: every delete is
 * bounded by an absolute cutoff computed from the wake it runs for, so a
 * second run of the same intent deletes rows the first one did not reach and
 * nothing else.
 */
export function runProcessRetentionSweep(deps: ProcessRetentionSweepDeps) {
  return async (payload: ProcessRetentionSweepPayload): Promise<void> => {
    const now = deps.now ?? Date.now;
    const sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    // Clamped here rather than bounded in the schema. The only writer is the
    // wake handler, which already caps the budget, so a larger value could
    // only arrive on a payload this code did not write. Rejecting one would
    // fail the intent, exhaust its retries and dead-letter the sweep, which
    // stops retention altogether and regrows the tables this exists to bound.
    // Clamping holds the delete loop to the same ceiling and keeps the sweep
    // running.
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
        startedAt + Math.floor(((index + 1) * RETENTION_SWEEP_DEADLINE_MS) / plans.length),
      );
      swept[plan.family] = await sweepFamily(plan, {
        deadline: familyDeadline,
        now,
        maxBatches,
        sleep,
        metrics: deps.metrics,
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
