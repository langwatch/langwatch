import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Every ten minutes: how soon after a window lapses its customers see the expiry row. */
export const IMPERSONATION_EXPIRY_INTERVAL_MS = 10 * 60 * 1000;

export const impersonationExpirySchema = z.object({
  scheduledFor: z.number().int(),
});

export const impersonationExpiryStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
});
type ImpersonationExpiryState = z.infer<typeof impersonationExpiryStateSchema>;

export const IMPERSONATION_EXPIRY_INITIAL_STATE: ImpersonationExpiryState = {
  lastSweepAt: null,
};

type ImpersonationExpiryIntents = {
  sweep: IntentSpec<typeof impersonationExpirySchema>;
};

/** Pure and synchronous; the audit and the clear run behind the outbox lease. */
export const impersonationExpiryWake: WakeHandler<
  ImpersonationExpiryState,
  ImpersonationExpiryIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
