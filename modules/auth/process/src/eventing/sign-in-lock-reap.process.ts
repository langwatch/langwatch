import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Hourly, as main: the rows removed grant nothing, so this only sets how promptly they go. */
export const SIGN_IN_LOCK_REAP_INTERVAL_MS = 60 * 60 * 1000;

export const signInLockReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export const signInLockReapStateSchema = z.object({
  lastReapAt: z.number().nullable(),
});
export type SignInLockReapState = z.infer<typeof signInLockReapStateSchema>;

export const SIGN_IN_LOCK_REAP_INITIAL_STATE: SignInLockReapState = {
  lastReapAt: null,
};

export type SignInLockReapIntents = {
  reap: IntentSpec<typeof signInLockReapSchema>;
};

/** Pure and synchronous; the delete itself runs behind the outbox lease. */
export const signInLockReapWake: WakeHandler<SignInLockReapState, SignInLockReapIntents> = (
  _state,
  ctx,
) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intent("reap", `reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
