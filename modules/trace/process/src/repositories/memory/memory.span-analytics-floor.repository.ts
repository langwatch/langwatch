import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

import { SpanAnalyticsFloorRepository } from "../span-analytics-floor.repository.ts";

/**
 * A process with no upgrade ledger and nothing to replay: every span it holds was projected as
 * written, so it answers as a fresh install does (the step not needed, no floor).
 */
export class MemorySpanAnalyticsFloorRepository extends SpanAnalyticsFloorRepository {
  static create(): MemorySpanAnalyticsFloorRepository {
    return new MemorySpanAnalyticsFloorRepository();
  }

  async findReplayStep(): Promise<LedgerStepRecord[]> {
    return [{ status: "not-needed", report: null, startedAt: null }];
  }
}
