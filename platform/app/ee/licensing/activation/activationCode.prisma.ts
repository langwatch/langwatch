/**
 * Activation codes over Prisma (ADR-139, section 5).
 *
 * The two claim methods are the point of this file. Both push the state the
 * caller resolved against into the WHERE clause of the write, so the database
 * decides who won rather than the process, and a code that was revoked or
 * redeemed between the read and the write refuses the claim.
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
   * moment cannot both be told yes: `redeemedAt: null` is part of the WHERE, so
   * exactly one statement finds a row to update and the other updates none.
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
    const { count } = await this.prisma.activationCode.updateMany({
      where: {
        id,
        reusable: false,
        redeemedAt: null,
        revokedAt: null,
        expiresAt: { gt: at },
      },
      data: {
        redeemedAt: at,
        redeemedByInstanceId: instanceId,
        redemptionCount: { increment: 1 },
      },
    });
    return count === 1;
  }

  /**
   * A reusable code is claimed by every install that presents it, so the write
   * carries only the conditions that can still refuse it: revoked, or past its
   * expiry.
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
    const { count } = await this.prisma.activationCode.updateMany({
      where: { id, reusable: true, revokedAt: null, expiresAt: { gt: at } },
      data: {
        redeemedAt: at,
        redeemedByInstanceId: instanceId,
        redemptionCount: { increment: 1 },
      },
    });
    return count === 1;
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
