import {
  createUpgradeReader,
  type ListRunsInput,
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeReader,
  type UpgradeReleasePage,
  type UpgradeRunDetail,
  type UpgradeRunPage,
  type UpgradeStatus,
  type UpgradeStepDetail,
  type UpgradeStepPage,
} from "@langwatch/upgrade/reader";

import type { UpgradeLedgerRepository } from "../upgrade-ledger.repository.ts";

/** A database that holds no ledger: the reader finds none of its tables and records nothing. */
export class MemoryUpgradeLedgerRepository implements UpgradeLedgerRepository {
  private constructor(private readonly reader: UpgradeReader) {}

  /** A test may hand a reader of its own, so a page reads a ledger with releases and runs. */
  static create({
    steps = [],
    reader,
  }: {
    steps?: UpgradeImage["steps"];
    reader?: UpgradeReader;
  } = {}): MemoryUpgradeLedgerRepository {
    return new MemoryUpgradeLedgerRepository(
      reader ??
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

  findReleases(): Promise<UpgradeReleasePage> {
    return this.reader.listReleases();
  }

  findRuns(input?: ListRunsInput): Promise<UpgradeRunPage> {
    return this.reader.listRuns(input);
  }

  getStep(input: { id: string }): Promise<UpgradeStepDetail> {
    return this.reader.getStep(input);
  }

  getRun(input: { id: string }): Promise<UpgradeRunDetail> {
    return this.reader.getRun(input);
  }
}
