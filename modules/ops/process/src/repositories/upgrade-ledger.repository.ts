import type {
  ListRunsInput,
  ListStepsFilter,
  UpgradeReleasePage,
  UpgradeRunDetail,
  UpgradeRunPage,
  UpgradeStatus,
  UpgradeStepDetail,
  UpgradeStepPage,
} from "@langwatch/upgrade/reader";

/**
 * The upgrade ledger as the checkup and the Upgrades page read it: the runner's own tables,
 * read only, through the framework's reader (Q-U8, default taken). Specs:
 * modules/ops/specs/upgrades-checkup.feature, modules/ops/specs/upgrades.feature
 */
export interface UpgradeLedgerRepository {
  findStatus(): Promise<UpgradeStatus>;
  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage>;
  findReleases(): Promise<UpgradeReleasePage>;
  findRuns(input?: ListRunsInput): Promise<UpgradeRunPage>;
  /** Refuses with `upgrade_not_found` when neither the ledger nor the image holds the step. */
  getStep(input: { id: string }): Promise<UpgradeStepDetail>;
  /** Refuses with `upgrade_not_found` when the ledger holds no such run. */
  getRun(input: { id: string }): Promise<UpgradeRunDetail>;
}
