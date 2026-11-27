import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

/**
 * The upgrade ledger's record of one replay step, read while serving. A read port only: nothing
 * here can write the ledger. Each floor reads its own step through the one port.
 */
export abstract class SpanAnalyticsFloorRepository {
  /** The step's ledger row; empty when the ledger has none (or no ledger exists yet). */
  abstract findReplayStep(): Promise<LedgerStepRecord[]>;
}
