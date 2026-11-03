/**
 * The Postgres backend. Each claim is a raw conditional UPDATE: Prisma's `updateMany` re-checks
 * only an outer `id IN (SELECT ...)` after the row lock, so two racing callers could both win.
 */
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type {
  PrismaClient,
  StaffAccessChallenge,
  StaffAccessEvent,
  StaffAccessRequest,
  StaffAccessRequester,
} from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  StaffAccessApproval,
  StaffAccessChallengeRepository,
  StaffAccessChallengeRow,
  StaffAccessEventRepository,
  StaffAccessEventRow,
  StaffAccessRedemption,
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
  StaffAccessRequesterRepository,
  StaffAccessRequesterRow,
} from "../staff-access.repository.ts";

type RequesterDatabase = Pick<PrismaClient, "staffAccessRequester" | "$executeRaw">;
type ChallengeDatabase = Pick<PrismaClient, "staffAccessChallenge" | "$executeRaw">;
type RequestDatabase = Pick<PrismaClient, "staffAccessRequest" | "$executeRaw">;
type EventDatabase = Pick<PrismaClient, "staffAccessEvent">;

export class PrismaStaffAccessRequesterRepository
  extends PrismaRepository.for("StaffAccessRequester")
  implements StaffAccessRequesterRepository
{
  static create(database: RequesterDatabase): PrismaStaffAccessRequesterRepository {
    return new PrismaStaffAccessRequesterRepository(database);
  }

  private constructor(private readonly database: RequesterDatabase) {
    super(database);
  }

  async create(row: StaffAccessRequesterRow): Promise<void> {
    await this.database.staffAccessRequester.create({
      data: {
        ...row,
        expiresAt: toDate(row.expiresAt),
        revokedAt: row.revokedAt && toDate(row.revokedAt),
        lastUsedAt: row.lastUsedAt && toDate(row.lastUsedAt),
        createdAt: toDate(row.createdAt),
      },
    });
  }

  async findByLookupId({ lookupId }: { lookupId: string }): Promise<StaffAccessRequesterRow[]> {
    const records = await this.database.staffAccessRequester.findMany({ where: { lookupId } });
    return records.map(requesterOf);
  }

  async findById({ id }: { id: string }): Promise<StaffAccessRequesterRow[]> {
    const records = await this.database.staffAccessRequester.findMany({ where: { id } });
    return records.map(requesterOf);
  }

  async findByOwner({ ownerUserId }: { ownerUserId: string }): Promise<StaffAccessRequesterRow[]> {
    const records = await this.database.staffAccessRequester.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: "desc" },
    });
    return records.map(requesterOf);
  }

  async touch({ id, at }: { id: string; at: Instant }): Promise<void> {
    await this.database.staffAccessRequester.update({
      where: { id },
      data: { lastUsedAt: toDate(at) },
    });
  }

  async revoke({
    id,
    ownerUserId,
    at,
  }: {
    id: string;
    ownerUserId: string;
    at: Instant;
  }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // An operator's own agent, keyed by the operator; no tenant holds it.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequester" SET "revokedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "ownerUserId" = ${ownerUserId} AND "revokedAt" IS NULL`;
    return changed === 1;
  }
}

export class PrismaStaffAccessChallengeRepository
  extends PrismaRepository.for("StaffAccessChallenge")
  implements StaffAccessChallengeRepository
{
  static create(database: ChallengeDatabase): PrismaStaffAccessChallengeRepository {
    return new PrismaStaffAccessChallengeRepository(database);
  }

  private constructor(private readonly database: ChallengeDatabase) {
    super(database);
  }

  async create(row: StaffAccessChallengeRow): Promise<void> {
    await this.database.staffAccessChallenge.create({
      data: {
        ...row,
        expiresAt: toDate(row.expiresAt),
        usedAt: row.usedAt && toDate(row.usedAt),
        createdAt: toDate(row.createdAt),
      },
    });
  }

  async findOpen({
    userId,
    purpose,
    at,
  }: {
    userId: string;
    purpose: string;
    at: Instant;
  }): Promise<StaffAccessChallengeRow[]> {
    const records = await this.database.staffAccessChallenge.findMany({
      where: { userId, purpose, usedAt: null, expiresAt: { gt: toDate(at) } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return records.map(challengeOf);
  }

  async claim({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A person's own passkey challenge, spent by its id; no tenant holds it.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessChallenge" SET "usedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "usedAt" IS NULL AND "expiresAt" > ${toDate(at)}`;
    return changed === 1;
  }
}

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
          { status: "approved", expiresAt: { gt: toDate(at) } },
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
        status: "redeemed",
        revokedAt: null,
        endAuditedAt: null,
        accessExpiresAt: { lte: toDate(at) },
      },
      orderBy: { accessExpiresAt: "asc" },
      take: limit,
    });
    return records.map(requestOf);
  }

  async approve(input: StaffAccessApproval): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, decided by its id (ADR-192).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest"
      SET "status" = 'approved', "approvedAt" = ${toDate(input.at)},
          "spendApproved" = ${input.spendApproved},
          "approvalCredentialId" = ${input.credentialId},
          "approvalSignature" = ${input.signature}, "signedHash" = ${input.signedHash}
      WHERE "id" = ${input.id} AND "status" = 'pending' AND "expiresAt" > ${toDate(input.at)}`;
    return changed === 1;
  }

  async deny({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, decided by its id (ADR-192).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest" SET "status" = 'denied'
      WHERE "id" = ${id} AND "status" = 'pending' AND "expiresAt" > ${toDate(at)}`;
    return changed === 1;
  }

  async redeem(input: StaffAccessRedemption): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access request, redeemed once by its id (ADR-192).
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
        // A platform staff access session, revoked by its id (ADR-192).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest"
      SET "status" = 'revoked', "revokedAt" = ${toDate(at)}, "revokedByUserId" = ${byUserId},
          "revokeCause" = ${cause}, "endAuditedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "status" IN ('approved', 'redeemed') AND "revokedAt" IS NULL`;
    return changed === 1;
  }

  async claimEndAudit({ id, at }: { id: string; at: Instant }): Promise<boolean> {
    const changed = await this.database.$executeRaw`
      ${skipTenantCheck({
        // A platform staff access session's end, audited once by its id (ADR-192).
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "StaffAccessRequest" SET "endAuditedAt" = ${toDate(at)}
      WHERE "id" = ${id} AND "endAuditedAt" IS NULL AND "revokedAt" IS NULL`;
    return changed === 1;
  }

  async releaseEndAudit({ id }: { id: string }): Promise<void> {
    await this.database.staffAccessRequest.update({ where: { id }, data: { endAuditedAt: null } });
  }
}

export class PrismaStaffAccessEventRepository
  extends PrismaRepository.for("StaffAccessEvent")
  implements StaffAccessEventRepository
{
  static create(database: EventDatabase): PrismaStaffAccessEventRepository {
    return new PrismaStaffAccessEventRepository(database);
  }

  private constructor(private readonly database: EventDatabase) {
    super(database);
  }

  async create(row: StaffAccessEventRow): Promise<void> {
    await this.database.staffAccessEvent.create({ data: { ...row, at: toDate(row.at) } });
  }

  async finish(input: {
    id: string;
    status: number;
    errorCode: string | null;
    durationMs: number;
  }): Promise<void> {
    await this.database.staffAccessEvent.update({
      where: { id: input.id },
      data: { status: input.status, errorCode: input.errorCode, durationMs: input.durationMs },
    });
  }

  async findByRequest({ requestId }: { requestId: string }): Promise<StaffAccessEventRow[]> {
    const records = await this.database.staffAccessEvent.findMany({
      where: { requestId },
      orderBy: { at: "asc" },
    });
    return records.map((record: StaffAccessEvent) => ({ ...record, at: fromDate(record.at) }));
  }
}

function requesterOf(record: StaffAccessRequester): StaffAccessRequesterRow {
  return {
    ...record,
    expiresAt: fromDate(record.expiresAt),
    revokedAt: record.revokedAt && fromDate(record.revokedAt),
    lastUsedAt: record.lastUsedAt && fromDate(record.lastUsedAt),
    createdAt: fromDate(record.createdAt),
  };
}

function challengeOf(record: StaffAccessChallenge): StaffAccessChallengeRow {
  return {
    ...record,
    expiresAt: fromDate(record.expiresAt),
    usedAt: record.usedAt && fromDate(record.usedAt),
    createdAt: fromDate(record.createdAt),
  };
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
