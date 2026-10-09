import {
  createUpgradeReader,
  describeStepStatus,
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
  /** The steps a retry reopened, read back as pending. */
  private readonly reopened = new Set<string>();

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

  async getStep(input: { id: string }): Promise<UpgradeStepDetail> {
    const step = await this.reader.getStep(input);
    if (!this.reopened.has(step.id)) return step;
    return {
      ...step,
      status: "pending",
      statusLabel: describeStepStatus({ status: "pending" }),
      lastError: null,
    };
  }

  getRun(input: { id: string }): Promise<UpgradeRunDetail> {
    return this.reader.getRun(input);
  }

  /** Checks and records with no await between them, so concurrent retries reopen it once. */
  async reopenFailedStep({ id }: { id: string }): Promise<boolean> {
    const { status } = await this.getStep({ id });
    if (status !== "failed" || this.reopened.has(id)) return false;
    this.reopened.add(id);
    return true;
  }
}
