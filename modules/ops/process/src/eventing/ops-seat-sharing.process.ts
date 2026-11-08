import type { IntentSpec, ProcessManagerApplier, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { isSeatSharingCheckDue } from "../rules/seat-sharing.rules.ts";
import { runSeatSharingCheck, type SeatSharingRunDeps } from "./ops-seat-sharing.intent.ts";

/**
 * Hourly, so the check runs on the first wake a day after the last one and a restart skips none.
 */
const SEAT_SHARING_WAKE_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const seatSharingScheduleStateSchema = z.object({
  /** Epoch ms of the last check this process asked for; null before the first. */
  lastCheckedAt: z.number().nullable(),
});
export type SeatSharingScheduleState = z.infer<typeof seatSharingScheduleStateSchema>;

const checkSchema = z.object({ scheduledFor: z.number().int() });

type SeatSharingIntents = {
  check: IntentSpec<typeof checkSchema>;
};

/** The first wake checks at once; the intent is keyed by the UTC day, so a redelivery asks once. */
export const seatSharingWake: WakeHandler<SeatSharingScheduleState, SeatSharingIntents> = (
  state,
  ctx,
) => {
  const at = Math.max(ctx.at, ctx.now);
  if (!isSeatSharingCheckDue({ at, lastCheckedAt: state.lastCheckedAt })) return { state };
  return {
    state: { lastCheckedAt: at },
    intents: [ctx.intent("check", `check:${Math.floor(at / DAY_MS)}`, { scheduledFor: at })],
  };
};

/** One instance for the whole deployment: the check walks every organization. */
export function seatSharingPM(deps: SeatSharingRunDeps): ProcessManagerApplier<never> {
  return (pm) =>
    pm
      .state(seatSharingScheduleStateSchema, { lastCheckedAt: null })
      .schedule({ everyMs: SEAT_SHARING_WAKE_INTERVAL_MS })
      .onWake(seatSharingWake)
      .intent("check", checkSchema, runSeatSharingCheck(deps))
      .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 });
}
