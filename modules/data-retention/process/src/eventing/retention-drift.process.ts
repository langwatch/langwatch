/**
 * The drift check's daily clock: a scheduled singleton that hands one sweep to the outbox, keyed
 * by the wake. Pure and synchronous; the outbox carries the work and its retries.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const RETENTION_DRIFT_PROCESS_NAME = "retentionDriftCheck";

/** Daily: a gap opens when a change is saved and not applied, and TTL acts within a day. */
export const RETENTION_DRIFT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const retentionDriftSweepSchema = z.object({ scheduledFor: z.number().int() });

export const retentionDriftStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type RetentionDriftState = z.infer<typeof retentionDriftStateSchema>;

export const RETENTION_DRIFT_INITIAL_STATE: RetentionDriftState = { lastSweepAt: null };

type RetentionDriftIntents = { sweep: IntentSpec<typeof retentionDriftSweepSchema> };

export const retentionDriftWake: WakeHandler<RetentionDriftState, RetentionDriftIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
