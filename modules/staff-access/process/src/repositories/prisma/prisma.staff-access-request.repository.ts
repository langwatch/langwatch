/**
 * The Postgres backend. Each claim is a raw conditional UPDATE: Prisma's `updateMany` re-checks
 * only an outer `id IN (SELECT ...)` after the row lock, so two racing callers could both win.
 */
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient, StaffAccessRequest } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  StaffAccessApproval,
  StaffAccessRedemption,
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../staff-access.repository.ts";

type RequestDatabase = Pick<PrismaClient, "staffAccessRequest" | "$executeRaw">;

export class PrismaStaffAccessRequestRepository
  extends PrismaRepository.for("StaffAccessRequest")
  implements StaffAccessRequestRepository
{
  static create(database: RequestDatabase): PrismaStaffAccessRequestRepository {
    return new PrismaStaffAccessRequestRepository(database);
  }

  private constructor(private readonly database: RequestDatabase) {
    super(database);
  }

  async create(row: StaffAccessRequestRow): Promise<void> {
    await this.database.staffAccessRequest.create({
      data: {
        ...row,
        expiresAt: toDate(row.expiresAt),
        approvedAt: row.approvedAt && toDate(row.approvedAt),
        redeemedAt: row.redeemedAt && toDate(row.redeemedAt),
        accessExpiresAt: row.accessExpiresAt && toDate(row.accessExpiresAt),
        revokedAt: row.revokedAt && toDate(row.revokedAt),
        endAuditedAt: row.endAuditedAt && toDate(row.endAuditedAt),
        createdAt: toDate(row.createdAt),
      },
    });
  }

  countSince({ requesterId, since }: { requesterId: string; since: Instant }): Promise<number> {
    return this.database.staffAccessRequest.count({
      where: { requesterId, createdAt: { gte: toDate(since) } },
    });
  }

  async findById({ id }: { id: string }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({ where: { id } });
    return records.map(requestOf);
  }

  async findByApiKeyId({ apiKeyId }: { apiKeyId: string }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({ where: { apiKeyId } });
    return records.map(requestOf);
  }

  async findByOpsTokenLookupId({
    lookupId,
  }: {
    lookupId: string;
  }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({
      where: { opsTokenLookupId: lookupId },
    });
    return records.map(requestOf);
  }

  async findRecent({
    since,
    limit,
  }: {
    since: Instant;
    limit: number;
  }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({
      where: { createdAt: { gte: toDate(since) } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return records.map(requestOf);
  }

  async findLive({ at }: { at: Instant }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({
      where: {
        revokedAt: null,
        OR: [
          { status: { in: ["pending", "approving", "approved"] }, expiresAt: { gt: toDate(at) } },
          { status: "redeemed", accessExpiresAt: { gt: toDate(at) } },
        ],
      },
    });
    return records.map(requestOf);
  }

  async findEndedUnaudited({
    at,
    limit,
  }: {
    at: Instant;
    limit: number;
  }): Promise<StaffAccessRequestRow[]> {
    const records = await this.database.staffAccessRequest.findMany({
      where: {
        endAuditedAt: null,
        OR: [
          { status: "redeemed", revokedAt: null, accessExpiresAt: { lte: toDate(at) } },
          {
            status: { in: ["approving", "approved"] },
            revokedAt: null,
            expiresAt: { lte: toDate(at) },
          },
          { revokedAt: { not: null }, signedHash: { not: null } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return records.map(requestOf);
  }

  async claimApproval(input: StaffAccessApproval): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, decided by its id (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest"
      SET "status" = 'approving',
          "spendApproved" = ${input.spendApproved},
          "approvalCredentialId" = ${input.credentialId},
          "approvalSignature" = ${input.signature}, "signedHash" = ${input.signedHash}
      WHERE "id" = ${input.id} AND "status" = 'pending' AND "expiresAt" > ${toDate(input.at)}`;
    return changed === 1;
  }

  async confirmApproval({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, confirmed by its id once audited (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest" SET "status" = 'approved', "approvedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "status" = 'approving' AND "revokedAt" IS NULL`;
    return changed === 1;
  }

  async deny({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, decided by its id (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest" SET "status" = 'denied'
      WHERE "id" = ${id} AND "status" = 'pending' AND "expiresAt" > ${toDate(at)}`;
    return changed === 1;
  }

  async redeem(input: StaffAccessRedemption): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, redeemed once by its id (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest"
      SET "status" = 'redeemed', "redeemedAt" = ${toDate(input.at)}, "pinnedIp" = ${input.pinnedIp},
          "accessExpiresAt" = ${toDate(input.accessExpiresAt)}
      WHERE "id" = ${input.id} AND "requesterId" = ${input.requesterId}
        AND "status" = 'approved' AND "redeemedAt" IS NULL AND "revokedAt" IS NULL
        AND "expiresAt" > ${toDate(input.at)}`;
    return changed === 1;
  }

  async attachCredentials(input: {
    id: string;
    apiKeyId: string | null;
    hashedOpsToken: string | null;
    opsTokenLookupId: string | null;
  }): Promise<void> {
    await this.database.staffAccessRequest.update({
      where: { id: input.id },
      data: {
        apiKeyId: input.apiKeyId,
        hashedOpsToken: input.hashedOpsToken,
        opsTokenLookupId: input.opsTokenLookupId,
      },
    });
  }

  async revoke({
    id,
    at,
    byUserId,
    cause,
  }: {
    id: string;
    at: Instant;
    byUserId: string | null;
    cause: string;
  }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access session, revoked by its id (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest"
      SET "status" = 'revoked', "revokedAt" = ${toDate(at)}, "revokedByUserId" = ${byUserId},
          "revokeCause" = ${cause}
      WHERE "id" = ${id} AND "status" IN ('pending', 'approving', 'approved', 'redeemed') AND "revokedAt" IS NULL
        AND "endAuditedAt" IS NULL
        AND ("accessExpiresAt" IS NULL OR "accessExpiresAt" > ${toDate(at)})`;
    return changed === 1;
  }

  async markEndAudited({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request's end, marked audited by its id (ADR-202).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest" SET "endAuditedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "endAuditedAt" IS NULL`;
    return changed === 1;
  }
}

function requestOf(record: StaffAccessRequest): StaffAccessRequestRow {
  return {
    ...record,
    expiresAt: fromDate(record.expiresAt),
    approvedAt: record.approvedAt && fromDate(record.approvedAt),
    redeemedAt: record.redeemedAt && fromDate(record.redeemedAt),
    accessExpiresAt: record.accessExpiresAt && fromDate(record.accessExpiresAt),
    revokedAt: record.revokedAt && fromDate(record.revokedAt),
    endAuditedAt: record.endAuditedAt && fromDate(record.endAuditedAt),
    createdAt: fromDate(record.createdAt),
  };
}
