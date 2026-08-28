import { z } from "zod";
import type { IntentSpec, WakeHandler } from "../../pipeline/processManagerDefinition";

export const BLOB_CLEANUP_PROCESS_NAME = "blobCleanup" as const;

/**
 * Outbox rows this process writes are pure bookkeeping (one per tick), so they
 * are pruned on the same schedule every other recurring process uses. Without
 * this the table grows one row per tick forever.
 */
export const BLOB_CLEANUP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const blobCleanupSchema = z.object({ scheduledFor: z.number().int() });

export interface BlobCleanupState {
  lastSweepAt: number | null;
}

export const BLOB_CLEANUP_INITIAL_STATE: BlobCleanupState = { lastSweepAt: null };

export type BlobCleanupIntents = {
  sweep: IntentSpec<typeof blobCleanupSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads — because
 * the commit that persists this evolution is what fences racing workers. The
 * sweep itself is an intent, so it runs behind the outbox lease instead.
 */
export const blobCleanupWake: WakeHandler<BlobCleanupState, BlobCleanupIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
