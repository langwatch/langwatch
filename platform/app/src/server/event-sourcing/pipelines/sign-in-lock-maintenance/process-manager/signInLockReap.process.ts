import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:identity:sign-in-lock:reap");

export const SIGN_IN_LOCK_REAP_PROCESS_NAME = "signInLockReap";

/**
 * Hourly. Nothing here is time-critical: the rows being removed already grant
 * nothing, so the interval only decides how promptly the table stops carrying
 * them.
 */
export const SIGN_IN_LOCK_REAP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How long a finished row is kept before it is swept.
 *
 * Not zero, and the reason is the COUNT rather than the lock: `failedCount` is
 * what makes five failures over ten minutes different from five over a year,
 * and removing a row the moment its lock lifted would reset that count every
 * time round. A day is comfortably longer than the longest lock an
 * administrator can set.
 */
export const SIGN_IN_LOCK_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const signInLockReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface SignInLockReapState {
  lastReapAt: number | null;
}

export interface SignInLockReapDeps {
  /** Removes the rows that are finished with; returns how many went. */
  reap: (params: { settledBefore: Date }) => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type SignInLockReapIntents = {
  reap: IntentSpec<typeof signInLockReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The delete itself is an intent, so it runs behind the outbox lease.
 */
export const signInLockReapWake: WakeHandler<
  SignInLockReapState,
  SignInLockReapIntents
> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runSignInLockReap({
  reap,
  deleteDispatchedBefore,
  now,
}: SignInLockReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (now ?? Date.now)();

    const swept = await reap({
      settledBefore: new Date(startedAt - SIGN_IN_LOCK_RETENTION_MS),
    });
    if (swept > 0) {
      logger.info({ swept }, "finished sign-in lock-out rows removed");
    }

    try {
      await deleteDispatchedBefore({
        processName: SIGN_IN_LOCK_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "sign-in lock-out reap outbox retention failed",
      );
    }
  };
}
