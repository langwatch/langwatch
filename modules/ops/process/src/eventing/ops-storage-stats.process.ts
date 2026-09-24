import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Every fifteen seconds, main's interval; each wake now measures once across the fleet. */
export const STORAGE_STATS_INTERVAL_MS = 15_000;

export const storageStatsMeasurementSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface StorageStatsState {
  lastMeasuredAt: number | null;
}

export const STORAGE_STATS_INITIAL_STATE: StorageStatsState = {
  lastMeasuredAt: null,
};

export type StorageStatsIntents = {
  measure: IntentSpec<typeof storageStatsMeasurementSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its measurement once. */
export const storageStatsWake: WakeHandler<StorageStatsState, StorageStatsIntents> = (
  _state,
  ctx,
) => ({
  state: { lastMeasuredAt: ctx.at },
  intents: [ctx.intents.measure(`measure:${ctx.at}`, { scheduledFor: ctx.at })],
});
