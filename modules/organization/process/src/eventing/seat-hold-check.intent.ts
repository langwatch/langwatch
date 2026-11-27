import { createLogger } from "@langwatch/observability";

import type { SeatHoldCheckOutcome } from "../services/seat-hold.service.ts";
import { SEAT_HOLD_CHECK_PROCESS_NAME } from "./seat-hold-check.process.ts";

const logger = createLogger("langwatch:organization:seat-hold-check");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const CHECK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SeatHoldCheckDeps {
  /** Admits the people waiting longest where holds ended, then deletes those holds. */
  check: () => Promise<SeatHoldCheckOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runSeatHoldCheck(deps: SeatHoldCheckDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const { admitted, failures } = await deps.check();
    if (admitted > 0) logger.info({ admitted }, "Seat hold check admitted people waiting");
    for (const { organizationId, error } of failures) {
      logger.error({ organizationId, error }, "Seat hold check failed; the next check retries it");
    }

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
