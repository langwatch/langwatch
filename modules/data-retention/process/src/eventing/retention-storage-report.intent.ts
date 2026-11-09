import { createLogger } from "@langwatch/observability";

import type { RetentionStorageReportOutcome } from "../services/retention-storage-report.service.ts";
import { RETENTION_STORAGE_REPORT_PROCESS_NAME } from "./retention-storage-report.process.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

/** One bookkeeping outbox row per tick, pruned like every other recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RetentionStorageReportSweepDeps {
  /** Measures and reports every organization; one that fails is counted and tried tomorrow. */
  sweep: () => Promise<RetentionStorageReportOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runRetentionStorageReportSweep(
  deps: RetentionStorageReportSweepDeps,
): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const outcome = await deps.sweep();
    logger.info(outcome, "Retention storage report finished");

    try {
      await deps.deleteDispatchedBefore({
        processName: RETENTION_STORAGE_REPORT_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Retention storage report outbox retention failed",
      );
    }
  };
}
