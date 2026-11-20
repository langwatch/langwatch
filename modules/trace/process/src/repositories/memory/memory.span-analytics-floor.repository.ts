import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

import { SpanAnalyticsFloorRepository } from "../span-analytics-floor.repository.ts";

/** What a process with no upgrade ledger holds: nothing to replay, as on a fresh install. */
const FRESH_INSTALL: readonly LedgerStepRecord[] = [
  { status: "not-needed", report: null, startedAt: null },
];

/**
 * A replay step's ledger row held in memory. With no rows given, every fact it holds was
 * projected as written, so it answers as a fresh install does (the step not needed, no floor).
 */
export class MemorySpanAnalyticsFloorRepository extends SpanAnalyticsFloorRepository {
  private constructor(private readonly records: readonly LedgerStepRecord[]) {
    super();
  }

  static create({
    records = FRESH_INSTALL,
  }: { records?: readonly LedgerStepRecord[] } = {}): MemorySpanAnalyticsFloorRepository {
    return new MemorySpanAnalyticsFloorRepository(records);
  }

  async findReplayStep(): Promise<LedgerStepRecord[]> {
    return this.records.map((record) => ({ ...record }));
  }
}
