import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:ops:storage-stats");

export const STORAGE_STATS_PROCESS_NAME = "storageStats";

/** Outbox rows are bookkeeping, one per measurement, pruned like every recurring process's. */
const MEASUREMENT_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface StorageStatsDeps {
  /** One pass over every endpoint, saved for every process's gauges to read. */
  measure: () => Promise<void>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A failed measurement waits for the next wake, as main's interval did. */
export function runStorageStats(deps: StorageStatsDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      await deps.measure();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "storage stats measurement failed (will retry on next interval)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: STORAGE_STATS_PROCESS_NAME,
        before: startedAt - MEASUREMENT_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "storage stats outbox retention failed",
      );
    }
  };
}
