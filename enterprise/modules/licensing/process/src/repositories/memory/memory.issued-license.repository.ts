import { Temporal, type Instant } from "@langwatch/time";

import type {
  IssuedLicenseDraft,
  IssuedLicensePatch,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../issued-license.repository.ts";

/**
 * The registry in memory. The two conditional writes are the twin's whole
 * point: they answer false exactly where the Prisma statement's WHERE clause
 * would match no row, so a test can prove the race without a database.
 */
export class MemoryIssuedLicenseRepository implements IssuedLicenseRepository {
  static create(rows: readonly IssuedLicenseRecord[] = []): MemoryIssuedLicenseRepository {
    return new MemoryIssuedLicenseRepository(new Map(rows.map((row) => [row.id, { ...row }])));
  }

  #sequence = 0;

  private constructor(private readonly rows: Map<string, IssuedLicenseRecord>) {
    this.#sequence = rows.size;
  }

  async create(data: IssuedLicenseDraft): Promise<IssuedLicenseRecord> {
    this.refuseDuplicate(data);
    this.#sequence += 1;
    const timestamp = data.issuedAt;
    const row: IssuedLicenseRecord = {
      ...data,
      id: `issued-license-${this.#sequence}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<IssuedLicenseRecord | null> {
    return this.copyOf(this.rows.get(id));
  }

  async findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null> {
    return this.copyOf(this.all().find((row) => row.tokenHash === tokenHash));
  }

  async findByVirtualKeyId(virtualKeyId: string): Promise<IssuedLicenseRecord | null> {
    return this.copyOf(this.all().find((row) => row.virtualKeyId === virtualKeyId));
  }

  async findByReplacesId(replacesId: string): Promise<IssuedLicenseRecord | null> {
    return this.copyOf(this.all().find((row) => row.replacesId === replacesId));
  }

  async findAllByOrganization(organizationId: string): Promise<IssuedLicenseRecord[]> {
    return this.all()
      .filter((row) => row.organizationId === organizationId)
      .map((row) => ({ ...row }));
  }

  async findAllBoundToInstance(instanceId: string): Promise<IssuedLicenseRecord[]> {
    return this.all()
      .filter((row) => row.instanceId === instanceId && row.revokedAt === null)
      .toSorted(
        (a, b) =>
          (b.instanceBoundAt?.epochMilliseconds ?? 0) - (a.instanceBoundAt?.epochMilliseconds ?? 0),
      )
      .map((row) => ({ ...row }));
  }

  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }> {
    const term = search?.trim().toLowerCase();
    const matched = this.all()
      .filter((row) => (term ? matches(row, term) : true))
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt));
    return {
      rows: matched.slice(page * pageSize, page * pageSize + pageSize).map((row) => ({ ...row })),
      total: matched.length,
    };
  }

  async update(id: string, data: IssuedLicensePatch): Promise<IssuedLicenseRecord> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no issued license ${id}`);
    const updated: IssuedLicenseRecord = { ...row, ...data };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async bindInstance({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Instant;
  }): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.instanceId !== null) return false;
    this.rows.set(id, { ...row, instanceId, instanceBoundAt: at });
    return true;
  }

  async attachVirtualKey({
    id,
    virtualKeyId,
    requires,
  }: {
    id: string;
    virtualKeyId: string;
    requires: { organizationId: string; instanceId: string; activeAt: Instant };
  }): Promise<boolean> {
    const row = this.rows.get(id);
    const admitted =
      row !== undefined &&
      row.virtualKeyId === null &&
      row.organizationId === requires.organizationId &&
      row.instanceId === requires.instanceId &&
      row.revokedAt === null &&
      row.supersededAt === null &&
      Temporal.Instant.compare(row.expiresAt, requires.activeAt) > 0;
    if (!admitted) return false;
    this.rows.set(id, { ...row, virtualKeyId });
    return true;
  }

  private all(): IssuedLicenseRecord[] {
    return [...this.rows.values()];
  }

  private copyOf(row: IssuedLicenseRecord | undefined): IssuedLicenseRecord | null {
    return row ? { ...row } : null;
  }

  /** The unique indexes the table carries, reported the way Prisma reports them. */
  private refuseDuplicate(data: IssuedLicenseDraft): void {
    for (const column of ["tokenHash", "licenseId", "replacesId"] as const) {
      const value = data[column];
      if (value === null) continue;
      if (this.all().some((row) => row[column] === value)) {
        throw Object.assign(new Error(`unique constraint on ${column}`), {
          code: "P2002",
          meta: { target: [column] },
        });
      }
    }
  }
}

function matches(row: IssuedLicenseRecord, term: string): boolean {
  return [row.organizationName, row.email, row.licenseId].some((value) =>
    value.toLowerCase().includes(term),
  );
}
