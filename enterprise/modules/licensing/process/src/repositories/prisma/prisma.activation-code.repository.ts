import type { ActivationCode, Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  ActivationClaim,
  ActivationCodeDraft,
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "../activation-code.repository.ts";

/**
 * A transaction client carries the same model methods, so a caller that needs
 * the row and its own writes to land together passes one in.
 */
export type ActivationCodeDatabase = Pick<PrismaClient, "activationCode" | "$executeRaw">;

export class PrismaActivationCodeRepository implements ActivationCodeRepository {
  static create(database: ActivationCodeDatabase): PrismaActivationCodeRepository {
    return new PrismaActivationCodeRepository(database);
  }

  private constructor(private readonly prisma: ActivationCodeDatabase) {}

  async create(input: ActivationCodeDraft): Promise<ActivationCodeRecord> {
    return rowOf(
      await this.prisma.activationCode.create({
        data: { ...input, expiresAt: toDate(input.expiresAt), services: [...input.services] },
      }),
    );
  }

  async findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    const row = await this.prisma.activationCode.findUnique({ where: { codeHash } });
    return row === null ? null : rowOf(row);
  }

  async findById(id: string): Promise<ActivationCodeRecord | null> {
    const row = await this.prisma.activationCode.findUnique({ where: { id } });
    return row === null ? null : rowOf(row);
  }

  async findAll({
    page,
    pageSize,
    organizationId,
  }: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ rows: ActivationCodeRecord[]; total: number }> {
    const where: Prisma.ActivationCodeWhereInput = organizationId ? { organizationId } : {};
    const [rows, total] = await Promise.all([
      this.prisma.activationCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.activationCode.count({ where }),
    ]);
    return { rows: rows.map(rowOf), total };
  }

  async claimSingleUse({ id, instanceId, at }: ActivationClaim): Promise<boolean> {
    // The whole decision, as one statement: exactly one concurrent post finds a
    // row to update, and everybody else is told the code is already redeemed.
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: a code is addressed by its own primary key. The row names the
      -- organization it was minted for rather than belonging to one.
      UPDATE "ActivationCode"
         SET "redeemedAt" = ${toDate(at)},
             "redeemedByInstanceId" = ${instanceId},
             "redemptionCount" = "redemptionCount" + 1,
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "redeemedAt" IS NULL
         AND "revokedAt" IS NULL
         AND "expiresAt" > ${toDate(at)}
    `;
    return updated === 1;
  }

  async recordReusableRedemption({ id, instanceId, at }: ActivationClaim): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: addressed by primary key; the row names its organization.
      UPDATE "ActivationCode"
         SET "redeemedAt" = ${toDate(at)},
             "redeemedByInstanceId" = ${instanceId},
             "redemptionCount" = "redemptionCount" + 1,
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "reusable" = true
         AND "revokedAt" IS NULL
         AND "expiresAt" > ${toDate(at)}
    `;
    return updated === 1;
  }

  async attachIssuedLicense({
    id,
    issuedLicenseId,
  }: {
    id: string;
    issuedLicenseId: string;
  }): Promise<void> {
    await this.prisma.activationCode.update({ where: { id }, data: { issuedLicenseId } });
  }

  async releaseClaim({ id, instanceId }: { id: string; instanceId: string }): Promise<void> {
    // Conditional on the claim still being this install's: a reusable code
    // another install has since redeemed keeps that redemption.
    await this.prisma.$executeRaw`
      -- @tenancy: addressed by primary key; the row names its organization.
      UPDATE "ActivationCode"
         SET "redeemedAt" = NULL,
             "redeemedByInstanceId" = NULL,
             "redemptionCount" = GREATEST("redemptionCount" - 1, 0),
             "updatedAt" = now()
       WHERE "id" = ${id}
         AND "redeemedByInstanceId" = ${instanceId}
    `;
  }

  async revoke({
    id,
    at,
    revokedById,
  }: {
    id: string;
    at: Instant;
    revokedById: string;
  }): Promise<boolean> {
    const updated = await this.prisma.activationCode.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: toDate(at), revokedById },
    });
    return updated.count === 1;
  }
}

/** Prisma speaks `Date`; the feature speaks `Instant`. This is that boundary. */
function rowOf({
  codeHash: _codeHash,
  revokedById: _revokedById,
  createdById: _createdById,
  updatedAt: _updatedAt,
  ...row
}: ActivationCode): ActivationCodeRecord {
  return {
    ...row,
    expiresAt: fromDate(row.expiresAt),
    redeemedAt: row.redeemedAt === null ? null : fromDate(row.redeemedAt),
    revokedAt: row.revokedAt === null ? null : fromDate(row.revokedAt),
    createdAt: fromDate(row.createdAt),
  };
}
