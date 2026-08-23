import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:langy:session-key-reap");

export const LANGY_SESSION_KEY_REAP_PROCESS_NAME = "langySessionKeyReap";

/**
 * Hourly. The keys carry their own `expiresAt` and `ApiKeyService.verify`
 * already refuses an elapsed one, so a reaped key was inert before this ran —
 * the sweep is about not leaving a long tail of live-looking rows behind a
 * manager that died without revoking them, not about closing an auth hole.
 */
export const LANGY_SESSION_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Outbox rows this process writes are pure bookkeeping (one per tick), pruned
 * on the same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const langySessionKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface LangySessionKeyReapState {
  lastReapAt: number | null;
}

export interface LangySessionKeyReapDeps {
  /** Revokes every elapsed, unrevoked Langy session key; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
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

export function runLangySessionKeyReap(deps: LangySessionKeyReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    // `reap` owns the outcome reporting — it increments the reaped counter and
    // logs the count under `langwatch:langy:api-key`. A second INFO line here,
    // under a different logger name, only splits one event across two Loki
    // streams so a query on either reports half the story. This wrapper logs
    // its OWN failure mode (the retention prune) and nothing else.
    await deps.reap();

    try {
      await deps.deleteDispatchedBefore({
        processName: LANGY_SESSION_KEY_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Langy session-key reap outbox retention failed",
      );
    }
  };
}
