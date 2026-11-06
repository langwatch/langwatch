import type {
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../organization-access-notice.repository.ts";

/** The access-notice log held in-process, unique per organization, kind, address and day. */
export class MemoryOrganizationAccessNoticeRepository implements OrganizationAccessNoticeRepository {
  static create(): MemoryOrganizationAccessNoticeRepository {
    return new MemoryOrganizationAccessNoticeRepository();
  }

  readonly rows: AccessNoticeRow[] = [];

  private constructor() {}

  async record(
    input: Parameters<OrganizationAccessNoticeRepository["record"]>[0],
  ): Promise<AccessNoticeRow[]> {
    const taken = this.rows.find(
      (row) =>
        row.organizationId === input.organizationId &&
        row.kind === input.kind &&
        row.email === input.email &&
        row.dayKey === input.dayKey,
    );
    if (taken) return taken.mailedAt === null ? [taken] : [];
    const row: AccessNoticeRow = {
      id: input.id,
      organizationId: input.organizationId,
      kind: input.kind,
      email: input.email,
      name: input.name,
      idp: input.idp,
      idpRefused: input.idpRefused,
      dayKey: input.dayKey,
      createdAt: input.at,
      mailedAt: null,
    };
    this.rows.push(row);
    return [row];
  }

  async markMailed(
    input: Parameters<OrganizationAccessNoticeRepository["markMailed"]>[0],
  ): Promise<string[]> {
    const marked: string[] = [];
    for (const [index, row] of this.rows.entries()) {
      if (!input.ids.includes(row.id) || row.mailedAt !== null) continue;
      this.rows[index] = { ...row, mailedAt: input.at };
      marked.push(row.id);
    }
    return marked;
  }

  async countRefusedForDay(
    input: Parameters<OrganizationAccessNoticeRepository["countRefusedForDay"]>[0],
  ): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.organizationId === input.organizationId &&
        row.dayKey === input.dayKey &&
        row.idpRefused,
    ).length;
  }

  async releaseMailed(
    input: Parameters<OrganizationAccessNoticeRepository["releaseMailed"]>[0],
  ): Promise<void> {
    for (const [index, row] of this.rows.entries()) {
      if (row.id === input.id) this.rows[index] = { ...row, mailedAt: null };
    }
  }
}
