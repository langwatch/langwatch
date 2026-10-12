import type { IntentContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:workers:usageStatsWorker");

export const USAGE_REPORT_PROCESS_NAME = "usageReport" as const;

/** One outbox row per day of bookkeeping, pruned like every other recurring process's. */
const REPORT_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageReportRunDeps {
  /** Takes and posts the report; reports its own outcome, and never throws for a refused post. */
  readonly send: (params: { heartbeat: () => void }) => Promise<string>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

export function runUsageReport(
  deps: UsageReportRunDeps,
): (payload: unknown, context: IntentContext) => Promise<void> {
  return async (_payload, context): Promise<void> => {
    const startedAt = deps.now();
    const outcome = await deps.send({ heartbeat: () => context.heartbeat?.() });
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
