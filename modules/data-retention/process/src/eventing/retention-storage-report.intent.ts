import { createLogger } from "@langwatch/observability";

import type { RetentionStorageRequestOutcome } from "../services/retention-storage-report-request.service.ts";
import { type RetentionStorageMeasuredEventData } from "./retention-storage-report.events.ts";
import {
  RETENTION_STORAGE_BILLING_PROCESS_NAME,
  RETENTION_STORAGE_REPORT_PROCESS_NAME,
} from "./retention-storage-report.process.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

/** Outbox rows are bookkeeping once dispatched, pruned like every other recurring process's. */
const DISPATCHED_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RetentionStorageReportSweepDeps {
  /** Sends one measure command per organization, all for the day the wake was due. */
  request: (input: { at: number }) => Promise<RetentionStorageRequestOutcome>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runRetentionStorageReportSweep(
  deps: RetentionStorageReportSweepDeps,
): (payload: { scheduledFor: number }) => Promise<void> {
  return async ({ scheduledFor }): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const outcome = await deps.request({ at: scheduledFor });
    logger.info(outcome, "Retention storage report requested");

    for (const processName of [
      RETENTION_STORAGE_REPORT_PROCESS_NAME,
      RETENTION_STORAGE_BILLING_PROCESS_NAME,
    ]) {
      try {
        await deps.deleteDispatchedBefore({
          processName,
          before: startedAt - DISPATCHED_ROW_RETENTION_MS,
        });
      } catch (error) {
        logger.warn(
          { processName, error: error instanceof Error ? error.message : String(error) },
          "Retention storage report outbox retention failed",
        );
      }
    }
  };
}

/** Sends one day's measurement to billing; a failure throws, so the outbox retries the send. */
export function runRetentionStorageBill({
  bill,
}: {
  bill: (measured: RetentionStorageMeasuredEventData) => Promise<unknown>;
}): (payload: RetentionStorageMeasuredEventData) => Promise<void> {
  return async (payload): Promise<void> => {
    await bill(payload);
  };
}
