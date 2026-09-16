import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const CLI_LOGIN_KEY_REAP_PROCESS_NAME = "cliLoginKeyReap";

/**
 * Hourly. A login key's session `expiresAt` and `findVerifiedToken` already
 * refuse an elapsed one — not an auth hole. This retires the ingest keys
 * under a stalled session: those carry no expiry and authorize until revoked.
 */
export const CLI_LOGIN_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

export const cliLoginKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface CliLoginKeyReapState {
  lastReapAt: number | null;
}

export const CLI_LOGIN_KEY_REAP_INITIAL_STATE: CliLoginKeyReapState = {
  lastReapAt: null,
};

export type CliLoginKeyReapIntents = {
  reap: IntentSpec<typeof cliLoginKeyReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous, no I/O, no clock read —
 * the commit that persists this evolution is what fences racing workers.
 * The revoke itself is an intent, run behind the outbox lease.
 */
export const cliLoginKeyReapWake: WakeHandler<CliLoginKeyReapState, CliLoginKeyReapIntents> = (
  _state,
  ctx,
) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
