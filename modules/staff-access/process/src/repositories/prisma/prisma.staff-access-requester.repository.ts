/**
 * The Postgres backend. Each claim is a raw conditional UPDATE: Prisma's `updateMany` re-checks
 * only an outer `id IN (SELECT ...)` after the row lock, so two racing callers could both win.
 */
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient, StaffAccessRequester } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  StaffAccessRequesterRepository,
  StaffAccessRequesterRow,
} from "../staff-access.repository.ts";

type RequesterDatabase = Pick<PrismaClient, "staffAccessRequester" | "$executeRaw">;

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

function requesterOf(record: StaffAccessRequester): StaffAccessRequesterRow {
  return {
    ...record,
    expiresAt: fromDate(record.expiresAt),
    revokedAt: record.revokedAt && fromDate(record.revokedAt),
    lastUsedAt: record.lastUsedAt && fromDate(record.lastUsedAt),
    createdAt: fromDate(record.createdAt),
  };
}
