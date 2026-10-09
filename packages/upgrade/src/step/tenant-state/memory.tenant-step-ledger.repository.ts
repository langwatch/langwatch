import type { TenantStepLedger } from "./tenant-step-settle.service.ts";

/** The ledger's tenant step rows' twin, for tests and the memory tier: settled or not, by id. */
export class MemoryTenantStepLedgerRepository implements TenantStepLedger {
  private readonly rows = new Map<string, boolean>();

  static create(): MemoryTenantStepLedgerRepository {
    return new MemoryTenantStepLedgerRepository();
  }

  private constructor() {}

  async settleTenantStep({ id, settled }: { id: string; settled: boolean }): Promise<void> {
    this.rows.set(id, settled);
  }

  /** Whether the last settle found the step settled; false when it was never settled. */
  isSettled({ id }: { id: string }): boolean {
    return this.rows.get(id) === true;
  }
}
