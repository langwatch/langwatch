import type {
  StaffAccessCopyLedgerRepository,
  StaffAccessCopyLedgerRow,
} from "../staff-access.repository.ts";

export class MemoryStaffAccessCopyLedgerRepository implements StaffAccessCopyLedgerRepository {
  #rows: StaffAccessCopyLedgerRow[] = [];

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

  async reserve(row: StaffAccessCopyLedgerRow): Promise<boolean> {
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

  async complete({
    id,
    targetId,
    targetProjectId,
    incomplete,
  }: {
    id: string;
    targetId: string;
    targetProjectId: string;
    incomplete: string | null;
  }): Promise<void> {
    this.#rows = this.#rows.map((row) =>
      row.id === id ? { ...row, targetId, targetProjectId, incomplete } : row,
    );
  }

  async release({ id }: { id: string }): Promise<void> {
    this.#rows = this.#rows.filter((row) => row.id !== id || row.targetId !== null);
  }
}
