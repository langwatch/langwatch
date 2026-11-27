/**
 * Organization's seat-change outbox instance (ADR-002): a write appends its seat change in its own
 * transaction, and the daily wake prunes the delivered rows, as the audit outbox does.
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import {
  SEAT_PEAK_PRUNE_INTENT,
  type SEAT_PEAK_RECORD_INTENT,
} from "../rules/seat-change.rules.ts";
import type { recordSeatChangedCommandDataSchema } from "./seat-peak.events.ts";

/** As the audit outbox: a day of retries; a dead change stays visible on the ops outbox page. */
export const SEAT_PEAK_MAX_ATTEMPTS = 12;
/** Delivered changes are kept two days for diagnosis, then pruned daily. */
export const SEAT_PEAK_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
export const SEAT_PEAK_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const seatPeakPruneSchema = z.object({ scheduledFor: z.number().int() });
export const seatPeakProcessStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type SeatPeakProcessState = z.infer<typeof seatPeakProcessStateSchema>;
export const SEAT_PEAK_PROCESS_INITIAL_STATE: SeatPeakProcessState = { lastPruneAt: null };

type SeatPeakIntents = {
  [SEAT_PEAK_RECORD_INTENT]: IntentSpec<typeof recordSeatChangedCommandDataSchema>;
  [SEAT_PEAK_PRUNE_INTENT]: IntentSpec<typeof seatPeakPruneSchema>;
};

export const seatPeakPruneWake: WakeHandler<SeatPeakProcessState, SeatPeakIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent(SEAT_PEAK_PRUNE_INTENT, `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
