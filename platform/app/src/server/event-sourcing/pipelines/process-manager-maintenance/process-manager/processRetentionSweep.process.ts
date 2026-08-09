import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { incrementProcessManagerRetentionSweptRows } from "~/server/metrics";
import { toSafeFailureDiagnostic } from "~/server/event-sourcing/process-manager/failureDiagnostic";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

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
 * Batches per family per wake. The ceiling exists so a first tick against a
 * huge backlog degrades into "drains 1M rows an hour" rather than "holds the
 * database for as long as it takes", which is the failure mode an unbounded
 * catch-up delete has.
 */
export const RETENTION_SWEEP_MAX_BATCHES_PER_WAKE = 200;

export const processRetentionSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface ProcessRetentionSweepState {
  lastSweepAt: number | null;
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
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * Drains one family in bounded batches until it runs dry or the wake's budget
 * is spent. A short batch means the family is drained, which is what ends the
 * loop without issuing a delete that would match nothing.
 */
async function drainFamily({
  deleteBatch,
  before,
}: {
  deleteBatch: (params: { before: number; limit: number }) => Promise<number>;
  before: number;
}): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < RETENTION_SWEEP_MAX_BATCHES_PER_WAKE; batch++) {
    const deleted = await deleteBatch({
      before,
      limit: RETENTION_SWEEP_BATCH_SIZE,
    });
    total += deleted;
    if (deleted < RETENTION_SWEEP_BATCH_SIZE) break;
  }
  return total;
}

export function runProcessRetentionSweep(deps: ProcessRetentionSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    const families: Array<{
      family: RetentionFamily;
      deleteBatch: (params: {
        before: number;
        limit: number;
      }) => Promise<number>;
      before: number;
    }> = [
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

    const swept: Record<RetentionFamily, number> = {
      dispatched_outbox: 0,
      dead_outbox: 0,
      inbox: 0,
    };

    // Per-family isolation: one family's failure must not cost the others their
    // sweep. The whole point of this process manager is that the tables cannot
    // grow unbounded, and a shared try/catch would let one bad statement stop
    // the other two indefinitely.
    for (const { family, deleteBatch, before } of families) {
      try {
        swept[family] = await drainFamily({ deleteBatch, before });
        incrementProcessManagerRetentionSweptRows(family, swept[family]);
      } catch (error) {
        logger.error(
          { ...toSafeFailureDiagnostic(error), family },
          "Process-manager retention sweep failed for one family",
        );
      }
    }

    logger.info(
      {
        dispatchedOutboxRows: swept.dispatched_outbox,
        deadOutboxRows: swept.dead_outbox,
        inboxRows: swept.inbox,
        durationMs: (deps.now ?? Date.now)() - startedAt,
      },
      "Process-manager retention sweep completed",
    );
  };
}
