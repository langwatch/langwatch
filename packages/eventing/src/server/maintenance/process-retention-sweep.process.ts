import { z } from "zod";

import type { IntentSpec, WakeHandler } from "../../pipeline/processManagerDefinition.ts";

export const PROCESS_RETENTION_SWEEP_PROCESS_NAME = "processRetentionSweep" as const;

/**
 * Hourly. The interval only has to be short enough that one wake's bounded
 * budget keeps up with an hour of inserts — comfortably true even at the
 * observed peak (~360k outbox rows/day).
 */
export const PROCESS_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 24h retention for dispatched outbox rows balances debuggability with table
 * size and supports redelivery idempotency for transient processes.
 */
export const DISPATCHED_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Dead rows are the operator's failure record, not completed work, so they get
 * a month rather than a day.
 */
export const DEAD_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Inbox rows are idempotency markers, so the window only has to outlive the
 * redelivery horizon (~25h: 24h trace guard + 600s debounce). Seven days is a
 * wide margin, and the `TriggerSent` claim is a second layer regardless.
 */
export const CONSUMED_INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows deleted per statement. Bounds one statement's lock footprint. */
export const RETENTION_SWEEP_BATCH_SIZE = 5_000;

/**
 * The ceiling on batches per family per wake, reached by the ramp below rather
 * than on the first tick — it degrades a huge backlog into "drains a million
 * rows an hour" rather than an unbounded catch-up delete holding the database.
 */
export const RETENTION_SWEEP_MAX_BATCHES_PER_WAKE = 200;

/**
 * Initial batches that ramp to the ceiling over seven wakes, balancing
 * backlog drain speed with instance load to prevent write outages.
 */
export const RETENTION_SWEEP_INITIAL_BATCHES_PER_WAKE = 5;

/**
 * Pause between delete statements, so a wake leaves the instance room to serve
 * the pipeline still writing to these tables — it runs hourly with nobody
 * watching the database while it works.
 */
export const RETENTION_SWEEP_BATCH_PAUSE_MS = 200;

/**
 * Outbox lease for the sweep intent. Generous because a wake that has ramped to
 * the ceiling spends 600 paced delete statements across the three families,
 * which takes far longer than the handful a steady-state hour needs.
 */
export const PROCESS_RETENTION_SWEEP_LEASE_MS = 15 * 60 * 1000;

/**
 * Wall-clock budget well under the lease to prevent concurrent sweeps;
 * stopping early leaves remainder for the next tick.
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

export type ProcessRetentionSweepPayload = z.output<typeof processRetentionSweepSchema>;

export interface ProcessRetentionSweepState {
  lastSweepAt: number | null;
  /** Wakes this process has scheduled, which is what the ramp counts. */
  sweepsScheduled: number;
}

export const PROCESS_RETENTION_SWEEP_INITIAL_STATE: ProcessRetentionSweepState = {
  lastSweepAt: null,
  sweepsScheduled: 0,
};

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

export type ProcessRetentionSweepIntents = {
  sweep: IntentSpec<typeof processRetentionSweepSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads —
 * because the commit that persists this evolution is what fences racing
 * workers. The deletes run behind the outbox lease as an intent instead.
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
