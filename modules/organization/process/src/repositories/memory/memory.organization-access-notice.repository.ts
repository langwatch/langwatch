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
    const taken = this.rows.some(
      (row) =>
        row.organizationId === input.organizationId &&
        row.kind === input.kind &&
        row.email === input.email &&
        row.dayKey === input.dayKey,
    );
    if (taken) return [];
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
}
