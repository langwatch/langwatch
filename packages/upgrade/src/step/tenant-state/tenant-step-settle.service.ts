import type { UpgradeRunnerRepository } from "../../runner/runner-ledger.repository.ts";
import type { TenantStepStateRepository } from "./tenant-state.repository.ts";

/** What settling reads from the tenant state table. */
export type TenantStepSettleState = Pick<TenantStepStateRepository, "hasUnsettledTenant">;

/** What settling writes to the ledger: the tenant step's row, never its status vocabulary. */
export type TenantStepLedger = Pick<UpgradeRunnerRepository, "settleTenantStep">;

/**
 * Settles each tenant step's ledger row from its tenants' state after a pass: done when no tenant
 * is held or parked, pending again when one is (Alex, 2026-10-09, S6-SETTLE).
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

  async settle({ ids }: { ids: readonly string[] }): Promise<void> {
    for (const id of ids) {
      const unsettled = await this.state.hasUnsettledTenant({ migrationName: id });
      await this.ledger.settleTenantStep({ id, settled: !unsettled });
    }
  }
}
