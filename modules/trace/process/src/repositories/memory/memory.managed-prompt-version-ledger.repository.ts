import type { LedgerStepRecord } from "@langwatch/upgrade/reader";

import { ManagedPromptVersionLedgerRepository } from "../managed-prompt-version-ledger.repository.ts";

/** What a process with no upgrade ledger holds: nothing to replay, as on a fresh install. */
const FRESH_INSTALL: readonly LedgerStepRecord[] = [
  { status: "not-needed", report: null, startedAt: null },
];

/**
 * The replay step's ledger row held in memory. With no rows given, every trace it holds was
 * projected as written, so it answers as a fresh install does (the step not needed, no floor).
 */
export class MemoryManagedPromptVersionLedgerRepository extends ManagedPromptVersionLedgerRepository {
  private constructor(private readonly records: readonly LedgerStepRecord[]) {
    super();
  }

  static create({
    records = FRESH_INSTALL,
  }: { records?: readonly LedgerStepRecord[] } = {}): MemoryManagedPromptVersionLedgerRepository {
    return new MemoryManagedPromptVersionLedgerRepository(records);
  }

  async findReplayStep(): Promise<LedgerStepRecord[]> {
    return this.records.map((record) => ({ ...record }));
  }
}
