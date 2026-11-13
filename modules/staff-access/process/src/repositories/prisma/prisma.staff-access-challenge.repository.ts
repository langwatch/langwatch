/**
 * The Postgres backend. Each claim is a raw conditional UPDATE: Prisma's `updateMany` re-checks
 * only an outer `id IN (SELECT ...)` after the row lock, so two racing callers could both win.
 */
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient, StaffAccessChallenge } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  StaffAccessChallengeRepository,
  StaffAccessChallengeRow,
} from "../staff-access.repository.ts";

type ChallengeDatabase = Pick<PrismaClient, "staffAccessChallenge" | "$executeRaw">;

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

function challengeOf(record: StaffAccessChallenge): StaffAccessChallengeRow {
  return {
    ...record,
    expiresAt: fromDate(record.expiresAt),
    usedAt: record.usedAt && fromDate(record.usedAt),
    createdAt: fromDate(record.createdAt),
  };
}
