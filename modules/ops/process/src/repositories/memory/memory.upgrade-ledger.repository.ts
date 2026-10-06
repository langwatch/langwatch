import {
  createUpgradeReader,
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeReader,
  type UpgradeStatus,
  type UpgradeStepPage,
} from "@langwatch/upgrade/reader";

import type { UpgradeLedgerRepository } from "../upgrade-ledger.repository.ts";

/** A database that holds no ledger: the reader finds none of its tables and records nothing. */
export class MemoryUpgradeLedgerRepository implements UpgradeLedgerRepository {
  private constructor(private readonly reader: UpgradeReader) {}

  static create({
    steps = [],
  }: { steps?: UpgradeImage["steps"] } = {}): MemoryUpgradeLedgerRepository {
    return new MemoryUpgradeLedgerRepository(
      createUpgradeReader({
        postgres: { query: async () => ({ rows: [] }) },
        image: { release: "unreleased", steps },
        floor: null,
      }),
    );
  }

  findStatus(): Promise<UpgradeStatus> {
    return this.reader.status();
  }

  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage> {
    return this.reader.listSteps(filter);
  }
}
