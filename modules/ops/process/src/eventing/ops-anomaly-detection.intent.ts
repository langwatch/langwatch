import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:observability:anomalyWorker");

export const ANOMALY_DETECTION_PROCESS_NAME = "anomalyDetection";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const DETECTION_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AnomalyDetectionTickResult {
  surfaced: number;
  cleared: number;
}

export interface AnomalyDetectionDeps {
  /** One detector tick; converges on the same anomalies however often it runs. */
  detect: () => Promise<AnomalyDetectionTickResult>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A failed tick waits for the next wake, as main's loop did, rather than retrying a stale one. */
export function runAnomalyDetection(deps: AnomalyDetectionDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      const result = await deps.detect();
      if (result.surfaced > 0 || result.cleared > 0) {
        logger.info(result, "anomaly tick");
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "anomaly detector tick failed (will retry on next interval)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: ANOMALY_DETECTION_PROCESS_NAME,
        before: startedAt - DETECTION_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "anomaly detection outbox retention failed",
      );
    }
  };
}
