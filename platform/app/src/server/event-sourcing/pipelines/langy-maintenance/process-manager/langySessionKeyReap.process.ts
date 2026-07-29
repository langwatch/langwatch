import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { Event } from "~/server/event-sourcing/domain/types";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

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

/**
 * The `langySessionKeyReap` process-manager topology, exported standalone so
 * the pipeline mounts one expression of it and tests can build the exact
 * definition the runtime runs. `langy-maintenance/pipeline.ts` mounts it as
 * `.withProcessManager(LANGY_SESSION_KEY_REAP_PROCESS_NAME,
 * langySessionKeyReapPM(deps.sessionKeyReap))`.
 */
export function langySessionKeyReapPM(
  deps: LangySessionKeyReapDeps,
): ProcessManagerApplier<Event> {
  return (pm) =>
    pm
      .state<LangySessionKeyReapState>({ lastReapAt: null })
      .schedule({ everyMs: LANGY_SESSION_KEY_REAP_INTERVAL_MS })
      .onWake(langySessionKeyReapWake)
      .intent("reap", langySessionKeyReapSchema, runLangySessionKeyReap(deps))
      // One bounded UPDATE over the (name, revokedAt, expiresAt) index added
      // in 20260728120000 — nothing like the blob sweep's keyspace walk, so
      // the default-ish lease is ample. NOTE the FIRST tick after deploy also
      // clears the historical backlog of keys this reaper never reached while
      // it was rejected by the tenancy guard, so that one runs long.
      .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 });
}
