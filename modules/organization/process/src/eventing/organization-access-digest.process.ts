import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Every fifteen minutes: a closed notice window is mailed within a quarter hour. */
export const ACCESS_DIGEST_INTERVAL_MS = 15 * 60 * 1000;

export const accessDigestSendSchema = z.object({
  scheduledFor: z.number().int(),
});

export const accessDigestStateSchema = z.object({
  lastSweptAt: z.number().nullable(),
});
type AccessDigestState = z.infer<typeof accessDigestStateSchema>;

export const ACCESS_DIGEST_INITIAL_STATE: AccessDigestState = { lastSweptAt: null };

type AccessDigestIntents = {
  send: IntentSpec<typeof accessDigestSendSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its sweep once. */
export const accessDigestWake: WakeHandler<AccessDigestState, AccessDigestIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweptAt: ctx.at },
  intents: [ctx.intent("send", `send:${ctx.at}`, { scheduledFor: ctx.at })],
});
