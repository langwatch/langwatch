import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

/** The upgrade ledger's record of the span_analytics replay step, read while serving. */
export abstract class SpanAnalyticsFloorRepository {
  /** The step's ledger row; empty when the ledger has none (or no ledger exists yet). */
  abstract findReplayStep(): Promise<LedgerStepRecord[]>;
}
