import { createLogger } from "@langwatch/observability";
import { LANGY_SESSION_KEY_REAP_PROCESS_NAME } from "../processes/langy-session-key-reap.process";

const logger = createLogger("langwatch:langy:session-key-reap");

/**
 * Outbox rows this process writes are pure bookkeeping (one per tick), pruned
 * on the same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface LangySessionKeyReapDeps {
  /** Revokes every elapsed, unrevoked Langy session key; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

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
