import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const CLI_LOGIN_KEY_REAP_PROCESS_NAME = "cliLoginKeyReap";

/**
 * Hourly. A login key carries its session's `expiresAt` and
 * `ApiKeyTokenResolutionService.findVerifiedToken` already refuses an
 * elapsed one, so the sweep is not closing an authentication hole. It is
 * what retires the ingest keys under a session that stopped refreshing:
 * those carry no expiry of their own and keep authorizing until their
 * parent is revoked.
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
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The revoke itself is an intent, so it runs behind the outbox
 * lease.
 */
export const cliLoginKeyReapWake: WakeHandler<CliLoginKeyReapState, CliLoginKeyReapIntents> = (
  _state,
  ctx,
) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
