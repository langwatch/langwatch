import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const LANGY_SESSION_KEY_REAP_PROCESS_NAME = "langySessionKeyReap";

/**
 * Hourly. The keys carry their own `expiresAt` and `ApiKeyService.verify`
 * already refuses an elapsed one, so a reaped key was inert before this ran —
 * the sweep is about not leaving a long tail of live-looking rows behind a
 * manager that died without revoking them, not about closing an auth hole.
 */
export const LANGY_SESSION_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

export const langySessionKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface LangySessionKeyReapState {
  lastReapAt: number | null;
}

type LangySessionKeyReapIntents = {
  reap: IntentSpec<typeof langySessionKeyReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous — no I/O, no clock reads — because
 * the commit that persists this evolution is what fences racing workers. The
 * revoke itself is an intent, so it runs behind the outbox lease instead.
 */
export const langySessionKeyReapWake: WakeHandler<
  LangySessionKeyReapState,
  LangySessionKeyReapIntents
> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
