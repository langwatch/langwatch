import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:cli-login-key:reap");

export const CLI_LOGIN_KEY_REAP_PROCESS_NAME = "cliLoginKeyReap";

/**
 * Hourly. A login key carries its session's `expiresAt` and
 * `ApiKeyService.verify` already refuses an elapsed one, so the sweep is not
 * closing an authentication hole. It is what retires the ingest keys under a
 * session that stopped refreshing: those carry no expiry of their own and
 * keep exporting until their parent is revoked.
 */
export const CLI_LOGIN_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const cliLoginKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface CliLoginKeyReapState {
  lastReapAt: number | null;
}

export interface CliLoginKeyReapDeps {
  /** Revokes every elapsed, unrevoked login key and its children; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type CliLoginKeyReapIntents = {
  reap: IntentSpec<typeof cliLoginKeyReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The revoke itself is an intent, so it runs behind the outbox lease.
 */
export const cliLoginKeyReapWake: WakeHandler<
  CliLoginKeyReapState,
  CliLoginKeyReapIntents
> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runCliLoginKeyReap(deps: CliLoginKeyReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    // `reap` reports its own outcome under `langwatch:api-key:cli-login-key-reaper`.
    // A second line here would split one event across two log streams.
    await deps.reap();

    try {
      await deps.deleteDispatchedBefore({
        processName: CLI_LOGIN_KEY_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "CLI login key reap outbox retention failed",
      );
    }
  };
}
