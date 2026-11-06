import type {
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../organization-access-notice.repository.ts";

type StoredNotice = AccessNoticeRow & { delivery: "immediate" | "digest" | null };

/** The access-notice outbox held in-process, unique per organization, kind, address and day. */
export class MemoryOrganizationAccessNoticeRepository implements OrganizationAccessNoticeRepository {
  static create(): MemoryOrganizationAccessNoticeRepository {
    return new MemoryOrganizationAccessNoticeRepository();
  }

  readonly rows: StoredNotice[] = [];

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
    const row: StoredNotice = {
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
      delivery: null,
    };
    this.rows.push(row);
    return [row];
  }

  async getMailWindow({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ lastMailedAt: number | null }> {
    const mailed = this.rows
      .filter((row) => row.organizationId === organizationId && row.mailedAt !== null)
      .map((row) => row.mailedAt ?? 0);
    return { lastMailedAt: mailed.length === 0 ? null : Math.max(...mailed) };
  }

  async markMailed(
    input: Parameters<OrganizationAccessNoticeRepository["markMailed"]>[0],
  ): Promise<string[]> {
    const marked: string[] = [];
    for (const [index, row] of this.rows.entries()) {
      if (!input.ids.includes(row.id) || row.mailedAt !== null) continue;
      this.rows[index] = { ...row, mailedAt: input.at, delivery: input.delivery };
      marked.push(row.id);
    }
    return marked;
  }

  async findHeld({ organizationId }: { organizationId: string }): Promise<AccessNoticeRow[]> {
    return this.rows
      .filter((row) => row.organizationId === organizationId && row.mailedAt === null)
      .toSorted((a, b) => a.createdAt - b.createdAt);
  }

  async findOrganizationsWithHeld(): Promise<string[]> {
    return [
      ...new Set(this.rows.filter((row) => row.mailedAt === null).map((row) => row.organizationId)),
    ];
  }
}
