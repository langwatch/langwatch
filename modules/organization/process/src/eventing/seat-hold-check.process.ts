import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SEAT_HOLD_CHECK_PIPELINE_NAME = "organization_seat_hold_check";
export const SEAT_HOLD_CHECK_PROCESS_NAME = "seatHoldCheck";

/** Hourly: a hold ends at most an hour before its seat goes to the person waiting longest. */
export const SEAT_HOLD_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export const seatHoldCheckSchema = z.object({ scheduledFor: z.number().int() });

export const seatHoldCheckStateSchema = z.object({ lastCheckAt: z.number().nullable() });
type SeatHoldCheckState = z.infer<typeof seatHoldCheckStateSchema>;

export const SEAT_HOLD_CHECK_INITIAL_STATE: SeatHoldCheckState = { lastCheckAt: null };

type SeatHoldCheckIntents = { check: IntentSpec<typeof seatHoldCheckSchema> };

/** Pure and synchronous: the check itself is an intent, run behind the outbox lease. */
export const seatHoldCheckWake: WakeHandler<SeatHoldCheckState, SeatHoldCheckIntents> = (
  _state,
  ctx,
) => ({
  state: { lastCheckAt: ctx.at },
  intents: [ctx.intent("check", `check:${ctx.at}`, { scheduledFor: ctx.at })],
});
