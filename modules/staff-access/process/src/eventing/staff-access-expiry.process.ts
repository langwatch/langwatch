import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const STAFF_ACCESS_EXPIRY_PROCESS_NAME = "staffAccessExpiry";

/** A session lasts an hour; its natural end is audited within a minute of it. */
export const STAFF_ACCESS_EXPIRY_INTERVAL_MS = 60_000;

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
export const STAFF_ACCESS_EXPIRY_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export const staffAccessExpirySchema = z.object({ scheduledFor: z.number().int() });

export const staffAccessExpiryStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type StaffAccessExpiryState = z.infer<typeof staffAccessExpiryStateSchema>;

type StaffAccessExpiryIntents = { sweep: IntentSpec<typeof staffAccessExpirySchema> };

/** Keyed by the wake, so a redelivered wake asks for its sweep once. */
export const staffAccessExpiryWake: WakeHandler<
  StaffAccessExpiryState,
  StaffAccessExpiryIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
