import type { ListStepsFilter, UpgradeStatus, UpgradeStepPage } from "@langwatch/upgrade/reader";

/**
 * The upgrade ledger as the checkup and the Upgrades page read it: the runner's own tables,
 * read only, through the framework's reader (Q-U8, default taken). Spec:
 * modules/ops/specs/upgrades-checkup.feature
 */
export interface UpgradeLedgerRepository {
  findStatus(): Promise<UpgradeStatus>;
  findSteps(filter?: ListStepsFilter): Promise<UpgradeStepPage>;
}
