// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SEAT_INVOICING_PROCESS_NAME = "seatInvoicing";

/** A seat change is invoiced within about a minute of licensing recording it. */
export const SEAT_INVOICING_INTERVAL_MS = 60 * 1000;

export const seatInvoicingPassSchema = z.object({ scheduledFor: z.number().int() });

export const seatInvoicingStateSchema = z.object({
  /** Epoch ms of the last pass this process asked for. */
  lastPassAt: z.number().nullable(),
});
export type SeatInvoicingState = z.infer<typeof seatInvoicingStateSchema>;

export const SEAT_INVOICING_INITIAL_STATE: SeatInvoicingState = { lastPassAt: null };

export type SeatInvoicingIntents = {
  pass: IntentSpec<typeof seatInvoicingPassSchema>;
};

/** Every wake asks for one pass. Pure; the pass itself runs behind the outbox lease. */
export const seatInvoicingWake: WakeHandler<SeatInvoicingState, SeatInvoicingIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPassAt: ctx.at },
  intents: [ctx.intent("pass", `pass:${ctx.at}`, { scheduledFor: ctx.at })],
});
