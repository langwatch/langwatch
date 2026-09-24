import type { IssuedLicense, Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  IssuedLicenseDraft,
  IssuedLicensePatch,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../issued-license.repository.ts";

/**
 * A transaction client carries the same model methods, so a caller that needs
 * the row and its own writes to land together passes one in.
 */
export type IssuedLicenseDatabase = Pick<PrismaClient, "issuedLicense" | "$executeRaw">;

export class PrismaIssuedLicenseRepository implements IssuedLicenseRepository {
  static create(database: IssuedLicenseDatabase): PrismaIssuedLicenseRepository {
    return new PrismaIssuedLicenseRepository(database);
  }

  private constructor(private readonly prisma: IssuedLicenseDatabase) {}

  async create(data: IssuedLicenseDraft): Promise<IssuedLicenseRecord> {
    return rowOf(await this.prisma.issuedLicense.create({ data: createColumnsOf(data) }));
  }

  async findById(id: string): Promise<IssuedLicenseRecord | null> {
    const row = await this.prisma.issuedLicense.findUnique({ where: { id } });
    return row === null ? null : rowOf(row);
  }

  async findByTokenHash(tokenHash: string): Promise<IssuedLicenseRecord | null> {
    const row = await this.prisma.issuedLicense.findUnique({ where: { tokenHash } });
    return row === null ? null : rowOf(row);
  }

  async findByVirtualKeyId(virtualKeyId: string): Promise<IssuedLicenseRecord | null> {
    const row = await this.prisma.issuedLicense.findUnique({ where: { virtualKeyId } });
    return row === null ? null : rowOf(row);
  }

  async findByReplacesId(replacesId: string): Promise<IssuedLicenseRecord | null> {
    const row = await this.prisma.issuedLicense.findUnique({ where: { replacesId } });
    return row === null ? null : rowOf(row);
  }

  async findAllByOrganization(organizationId: string): Promise<IssuedLicenseRecord[]> {
    const rows = await this.prisma.issuedLicense.findMany({ where: { organizationId } });
    return rows.map(rowOf);
  }

  async findAllBoundToInstance(instanceId: string): Promise<IssuedLicenseRecord[]> {
    const rows = await this.prisma.issuedLicense.findMany({
      where: { instanceId, revokedAt: null },
      orderBy: { instanceBoundAt: "desc" },
    });
    return rows.map(rowOf);
  }

  async listAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }> {
    const term = search?.trim();
    const where: Prisma.IssuedLicenseWhereInput = term
      ? {
          OR: [
            { organizationName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { licenseId: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.issuedLicense.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.issuedLicense.count({ where }),
    ]);
    return { rows: rows.map(rowOf), total };
  }

  async update(id: string, data: IssuedLicensePatch): Promise<IssuedLicenseRecord> {
    return rowOf(
      await this.prisma.issuedLicense.update({ where: { id }, data: updateColumnsOf(data) }),
    );
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
    // One conditional write, so the database decides which install wins. As
    // SQL, for the reason given above `attachVirtualKey`.
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: a license is addressed by its own primary key. The row names
      -- the organization it was issued to rather than belonging to one.
      UPDATE "IssuedLicense"
         SET "instanceId" = ${instanceId},
             "instanceBoundAt" = ${toDate(at)},
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "instanceId" IS NULL
    `;
    return updated === 1;
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
    // The state the caller resolved against is part of the write, so a change
    // between the read and this statement loses the key its grant. Stated as
    // SQL because `updateMany` re-checks only its subquery, on the statement's
    // own older snapshot, and tells two concurrent writers yes (ADR-156).
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: addressed by primary key; the row names its organization.
      UPDATE "IssuedLicense"
         SET "virtualKeyId" = ${virtualKeyId},
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "virtualKeyId" IS NULL
         AND "organizationId" = ${requires.organizationId}
         AND "instanceId" = ${requires.instanceId}
         AND "revokedAt" IS NULL
         AND "supersededAt" IS NULL
         AND "expiresAt" > ${toDate(requires.activeAt)}
    `;
    return updated === 1;
  }
}

/** Prisma speaks `Date`; the feature speaks `Instant`. This is that boundary. */
function rowOf(row: IssuedLicense): IssuedLicenseRecord {
  return {
    ...row,
    issuedAt: fromDate(row.issuedAt),
    expiresAt: fromDate(row.expiresAt),
    revokedAt: row.revokedAt === null ? null : fromDate(row.revokedAt),
    supersededAt: row.supersededAt === null ? null : fromDate(row.supersededAt),
    instanceBoundAt: row.instanceBoundAt === null ? null : fromDate(row.instanceBoundAt),
    lastSyncAt: row.lastSyncAt === null ? null : fromDate(row.lastSyncAt),
    createdAt: fromDate(row.createdAt),
    updatedAt: fromDate(row.updatedAt),
  };
}

function createColumnsOf(data: IssuedLicenseDraft): Prisma.IssuedLicenseUncheckedCreateInput {
  return {
    ...data,
    issuedAt: toDate(data.issuedAt),
    expiresAt: toDate(data.expiresAt),
    revokedAt: data.revokedAt === null ? null : toDate(data.revokedAt),
    supersededAt: data.supersededAt === null ? null : toDate(data.supersededAt),
    instanceBoundAt: data.instanceBoundAt === null ? null : toDate(data.instanceBoundAt),
    lastSyncAt: data.lastSyncAt === null ? null : toDate(data.lastSyncAt),
  };
}

function updateColumnsOf(data: IssuedLicensePatch): Prisma.IssuedLicenseUncheckedUpdateInput {
  const { issuedAt, expiresAt, revokedAt, supersededAt, instanceBoundAt, lastSyncAt, ...rest } =
    data;
  return {
    ...rest,
    ...(issuedAt === undefined ? {} : { issuedAt: toDate(issuedAt) }),
    ...(expiresAt === undefined ? {} : { expiresAt: toDate(expiresAt) }),
    ...("revokedAt" in data ? { revokedAt: revokedAt ? toDate(revokedAt) : null } : {}),
    ...("supersededAt" in data ? { supersededAt: supersededAt ? toDate(supersededAt) : null } : {}),
    ...("instanceBoundAt" in data
      ? { instanceBoundAt: instanceBoundAt ? toDate(instanceBoundAt) : null }
      : {}),
    ...("lastSyncAt" in data ? { lastSyncAt: lastSyncAt ? toDate(lastSyncAt) : null } : {}),
  };
}
