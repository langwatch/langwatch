import type { SystemMigrationRunnerService } from "@langwatch/system-migrations";

import type { UpgradeRunnerRepository } from "../../runner/runner-ledger.repository.ts";
import type { TenantStepStateRepository } from "./tenant-state.repository.ts";

/** What settling reads from the tenant state table. */
export type TenantStepSettleState = Pick<TenantStepStateRepository, "hasUnsettledTenant">;

/** What settling writes to the ledger: the tenant step's row, never its status vocabulary. */
export type TenantStepLedger = Pick<UpgradeRunnerRepository, "settleTenantStep">;

/** The runner that drove some steps over one tenant source; it answers who is left. */
export type TenantStepBucket = {
  ids: readonly string[];
  runner: Pick<SystemMigrationRunnerService, "hasUnfinishedTenant">;
};

/**
 * Settles each tenant step's ledger row from its tenants' state after a pass: done only when every
 * eligible tenant holds a finished row (dev/docs/ARCHITECTURE.md, "No stuck states"). A held or
 * parked tenant answers pending from one indexed read before any tenant is walked.
 */
export class TenantStepSettleService {
  static create({
    state,
    ledger,
  }: {
    state: TenantStepSettleState;
    ledger: TenantStepLedger;
  }): TenantStepSettleService {
    return new TenantStepSettleService(state, ledger);
  }

  private constructor(
    private readonly state: TenantStepSettleState,
    private readonly ledger: TenantStepLedger,
  ) {}

  /** Answers the ids left pending, so the caller keeps waking passes until they settle. */
  async settle({ buckets }: { buckets: readonly TenantStepBucket[] }): Promise<string[]> {
    const pending: string[] = [];
    for (const { ids, runner } of buckets) {
      for (const id of ids) {
        const unsettled =
          (await this.state.hasUnsettledTenant({ migrationName: id })) ||
          (await runner.hasUnfinishedTenant({ migrationName: id }));
        await this.ledger.settleTenantStep({ id, settled: !unsettled });
        if (unsettled) pending.push(id);
      }
    }
    return pending;
  }
}
