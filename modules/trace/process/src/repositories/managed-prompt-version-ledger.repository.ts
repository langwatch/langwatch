import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

/**
 * The upgrade ledger's record of the managed prompt version replay step, read while serving. A
 * read port only: nothing here can write the ledger.
 */
export abstract class ManagedPromptVersionLedgerRepository {
  /** The step's ledger row; empty when the ledger has none (or no ledger exists yet). */
  abstract findReplayStep(): Promise<LedgerStepRecord[]>;
}
