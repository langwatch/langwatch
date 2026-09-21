/**
 * Activation codes over Prisma (ADR-139, section 5).
 *
 * The two claim methods are the point of this file. Both push the state the
 * caller resolved against into the WHERE clause of the write, so the database
 * decides who won rather than the process, and a code that was revoked or
 * redeemed between the read and the write refuses the claim. Both are written
 * as SQL for a reason the comment on `claimSingleUse` gives.
 *
 * @see ./activationCode.service.ts
 */

import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type {
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "./activationCodes";

type RegistryClient = PrismaClient | Prisma.TransactionClient;

type Row = Awaited<
  ReturnType<PrismaClient["activationCode"]["findFirstOrThrow"]>
>;

function recordOf(row: Row): ActivationCodeRecord {
  return {
    id: row.id,
    codeHint: row.codeHint,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    email: row.email,
    planType: row.planType,
    maxMembers: row.maxMembers,
    maxMembersLite: row.maxMembersLite,
    licenseTermDays: row.licenseTermDays,
    services: row.services,
    expiresAt: row.expiresAt,
    reusable: row.reusable,
    redeemedAt: row.redeemedAt,
    redeemedByInstanceId: row.redeemedByInstanceId,
    issuedLicenseId: row.issuedLicenseId,
    redemptionCount: row.redemptionCount,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaActivationCodes implements ActivationCodeRepository {
  constructor(private readonly prisma: RegistryClient) {}

  async create(
    input: Parameters<ActivationCodeRepository["create"]>[0],
  ): Promise<ActivationCodeRecord> {
    return recordOf(await this.prisma.activationCode.create({ data: input }));
  }

  async findByCodeHash(codeHash: string): Promise<ActivationCodeRecord | null> {
    const row = await this.prisma.activationCode.findUnique({
      where: { codeHash },
    });
    return row ? recordOf(row) : null;
  }

  async findById(id: string): Promise<ActivationCodeRecord | null> {
    const row = await this.prisma.activationCode.findUnique({ where: { id } });
    return row ? recordOf(row) : null;
  }

  async findAll(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ rows: ActivationCodeRecord[]; total: number }> {
    const where = input.organizationId
      ? { organizationId: input.organizationId }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.activationCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: input.page * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.activationCode.count({ where }),
    ]);
    return { rows: rows.map(recordOf), total };
  }

  /**
   * One conditional write, so two installs posting the same code at the same
   * moment cannot both be told yes: exactly one statement finds a row to update
   * and the other updates none.
   *
   * Written as SQL rather than through `updateMany`, which does not hold under
   * concurrency here. Prisma compiles `updateMany` to
   * `UPDATE ... WHERE id IN (SELECT id FROM ... WHERE <conditions>)`. When two
   * statements meet on the same row, the second waits for the first to commit
   * and then re-checks its WHERE clause against the row as it now stands, which
   * for that shape is only the subquery, and the subquery still runs on the
   * statement's own older snapshot. Both are told yes. With the conditions
   * stated directly against the table the re-check sees `redeemedAt` already
   * set and the second statement updates nothing, which is the answer we need.
   * A CI run with five installs posting at once had three of them win before
   * this was written as SQL.
   */
  async claimSingleUse({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: an activation code is addressed by its own primary key, which
      -- the caller resolved from the hash presented to it. The code names the
      -- organization a redemption will bind rather than belonging to one.
      UPDATE "ActivationCode"
         SET "redeemedAt" = ${at},
             "redeemedByInstanceId" = ${instanceId},
             "redemptionCount" = "redemptionCount" + 1
       WHERE "id" = ${id}
         AND "reusable" = false
         AND "redeemedAt" IS NULL
         AND "revokedAt" IS NULL
         AND "expiresAt" > ${at}
    `;
    return updated === 1;
  }

  /**
   * A reusable code is claimed by every install that presents it, so the write
   * carries only the conditions that can still refuse it: revoked, or past its
   * expiry. Nothing here has to be exclusive, but it is the same SQL as the
   * single-use claim so the count reflects the row as it stood at the write.
   */
  async recordReusableRedemption({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      -- @tenancy: addressed by primary key, as in claimSingleUse above.
      UPDATE "ActivationCode"
         SET "redeemedAt" = ${at},
             "redeemedByInstanceId" = ${instanceId},
             "redemptionCount" = "redemptionCount" + 1
       WHERE "id" = ${id}
         AND "reusable" = true
         AND "revokedAt" IS NULL
         AND "expiresAt" > ${at}
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
    await this.prisma.activationCode.update({
      where: { id },
      data: { issuedLicenseId },
    });
  }

  async releaseClaim({
    id,
    instanceId,
  }: {
    id: string;
    instanceId: string;
  }): Promise<void> {
    await this.prisma.activationCode.updateMany({
      where: { id, redeemedByInstanceId: instanceId },
      data: {
        redeemedAt: null,
        redeemedByInstanceId: null,
        redemptionCount: { decrement: 1 },
      },
    });
  }

  async revoke({
    id,
    at,
    revokedById,
  }: {
    id: string;
    at: Date;
    revokedById: string;
  }): Promise<ActivationCodeRecord | null> {
    const { count } = await this.prisma.activationCode.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, revokedById },
    });
    if (count !== 1) return this.findById(id);
    return this.findById(id);
  }
}
