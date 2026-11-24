import { createLogger } from "@langwatch/observability";

import type { RetentionDriftRequestOutcome } from "../services/retention-drift-request.service.ts";
import { RETENTION_DRIFT_PROCESS_NAME } from "./retention-drift.process.ts";

const logger = createLogger("langwatch:data-retention:retention-drift");

/** Outbox rows are bookkeeping once dispatched, pruned like every other recurring process's. */
const DISPATCHED_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RetentionDriftSweepDeps {
  /** Sends one check command per organization with rules, all for the wake's instant. */
  request: (input: { at: number }) => Promise<RetentionDriftRequestOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runRetentionDriftSweep(
  deps: RetentionDriftSweepDeps,
): (payload: { scheduledFor: number }) => Promise<void> {
  return async ({ scheduledFor }): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const outcome = await deps.request({ at: scheduledFor });
    logger.info(outcome, "Retention drift check requested");
    try {
      await deps.deleteDispatchedBefore({
        processName: RETENTION_DRIFT_PROCESS_NAME,
        before: startedAt - DISPATCHED_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Retention drift check outbox retention failed",
      );
    }
  };
}
