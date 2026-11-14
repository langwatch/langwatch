// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SEAT_LINE_REPAIR_PIPELINE_NAME = "billing_seat_line_repair";
export const SEAT_LINE_REPAIR_PROCESS_NAME = "seatLineRepair";

/** Every 15 minutes: a lifted seat line is put back long before the next cycle bills it. */
export const SEAT_LINE_REPAIR_INTERVAL_MS = 15 * 60 * 1000;

export const seatLineRepairSchema = z.object({ scheduledFor: z.number().int() });

export const seatLineRepairStateSchema = z.object({ lastRepairAt: z.number().nullable() });
type SeatLineRepairState = z.infer<typeof seatLineRepairStateSchema>;

export const SEAT_LINE_REPAIR_INITIAL_STATE: SeatLineRepairState = { lastRepairAt: null };

type SeatLineRepairIntents = { repair: IntentSpec<typeof seatLineRepairSchema> };

/** Pure and synchronous: the repair itself is an intent, run behind the outbox lease. */
export const seatLineRepairWake: WakeHandler<SeatLineRepairState, SeatLineRepairIntents> = (
  _state,
  ctx,
) => ({
  state: { lastRepairAt: ctx.at },
  intents: [ctx.intent("repair", `repair:${ctx.at}`, { scheduledFor: ctx.at })],
});
