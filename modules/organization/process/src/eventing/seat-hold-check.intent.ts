import { createLogger } from "@langwatch/observability";

import { SEAT_HOLD_CHECK_PROCESS_NAME } from "./seat-hold-check.process.ts";

const logger = createLogger("langwatch:organization:seat-hold-check");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const CHECK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SeatHoldCheckDeps {
  /** Deletes ended holds and admits the people waiting longest; answers how many it admitted. */
  check: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runSeatHoldCheck(deps: SeatHoldCheckDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const admitted = await deps.check();
    if (admitted > 0) logger.info({ admitted }, "Seat hold check admitted people waiting");

    try {
      await deps.deleteDispatchedBefore({
        processName: SEAT_HOLD_CHECK_PROCESS_NAME,
        before: startedAt - CHECK_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Seat hold check outbox retention failed",
      );
    }
  };
}
