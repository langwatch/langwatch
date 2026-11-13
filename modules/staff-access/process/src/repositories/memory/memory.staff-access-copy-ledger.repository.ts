import type {
  StaffAccessCopyLedgerRepository,
  StaffAccessCopyLedgerRow,
} from "../staff-access.repository.ts";

export class MemoryStaffAccessCopyLedgerRepository implements StaffAccessCopyLedgerRepository {
  readonly #rows: StaffAccessCopyLedgerRow[] = [];

  static create(): MemoryStaffAccessCopyLedgerRepository {
    return new MemoryStaffAccessCopyLedgerRepository();
  }

  async findForPair({
    sourceOrganizationId,
    targetOrganizationId,
  }: {
    sourceOrganizationId: string;
    targetOrganizationId: string;
  }): Promise<StaffAccessCopyLedgerRow[]> {
    return this.#rows.filter(
      (row) =>
        row.sourceOrganizationId === sourceOrganizationId &&
        row.targetOrganizationId === targetOrganizationId,
    );
  }

  async record(row: StaffAccessCopyLedgerRow): Promise<boolean> {
    const taken = this.#rows.some(
      (existing) =>
        existing.targetOrganizationId === row.targetOrganizationId &&
        existing.kind === row.kind &&
        existing.sourceId === row.sourceId,
    );
    if (taken) return false;
    this.#rows.push(row);
    return true;
  }
}
