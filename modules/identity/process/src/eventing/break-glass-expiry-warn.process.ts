import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME = "breakGlassExpiryWarn";

/** Hourly: each fourteen-, seven- and one-day mark is sent once, so a late tick loses nothing. */
export const BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS = 60 * 60 * 1000;

export const breakGlassExpiryWarnSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface BreakGlassExpiryWarnState {
  lastWarnAt: number | null;
}

export const BREAK_GLASS_EXPIRY_WARN_INITIAL_STATE: BreakGlassExpiryWarnState = {
  lastWarnAt: null,
};

export type BreakGlassExpiryWarnIntents = {
  warn: IntentSpec<typeof breakGlassExpiryWarnSchema>;
};

/** Pure and synchronous; the warning itself runs behind the outbox lease. */
export const breakGlassExpiryWarnWake: WakeHandler<
  BreakGlassExpiryWarnState,
  BreakGlassExpiryWarnIntents
> = (_state, ctx) => ({
  state: { lastWarnAt: ctx.at },
  intents: [ctx.intents.warn(`warn:${ctx.at}`, { scheduledFor: ctx.at })],
});
