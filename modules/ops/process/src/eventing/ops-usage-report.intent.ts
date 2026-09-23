import { createLogger } from "@langwatch/observability";

import { USAGE_REPORT_PROCESS_NAME } from "./ops-usage-report.process.ts";

const logger = createLogger("langwatch:workers:usageStatsWorker");

/** One outbox row per day of bookkeeping, pruned like every other recurring process's. */
const REPORT_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageReportRunDeps {
  /** Takes and posts the report; reports its own outcome, and never throws for a refused post. */
  readonly send: () => Promise<string>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

export function runUsageReport(deps: UsageReportRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    const outcome = await deps.send();
    logger.info({ outcome }, "usage report tick");

    try {
      await deps.deleteDispatchedBefore({
        processName: USAGE_REPORT_PROCESS_NAME,
        before: startedAt - REPORT_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "usage report outbox retention failed",
      );
    }
  };
}
