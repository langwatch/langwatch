/** The Postgres copy ledger: a row is reserved, then completed with its target. */
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient, StaffAccessCopyLedger } from "@langwatch/prisma-client/generated";
import { fromDate, toDate } from "@langwatch/time";

import type {
  StaffAccessCopyLedgerRepository,
  StaffAccessCopyLedgerRow,
} from "../staff-access.repository.ts";

type LedgerDatabase = Pick<PrismaClient, "staffAccessCopyLedger">;

export class PrismaStaffAccessCopyLedgerRepository
  extends PrismaRepository.for("StaffAccessCopyLedger")
  implements StaffAccessCopyLedgerRepository
{
  static create(database: LedgerDatabase): PrismaStaffAccessCopyLedgerRepository {
    return new PrismaStaffAccessCopyLedgerRepository(database);
  }

  private constructor(private readonly database: LedgerDatabase) {
    super(database);
  }

  async findForPair({
    sourceOrganizationId,
    targetOrganizationId,
  }: {
    sourceOrganizationId: string;
    targetOrganizationId: string;
  }): Promise<StaffAccessCopyLedgerRow[]> {
    const records = await this.database.staffAccessCopyLedger.findMany({
      where: { sourceOrganizationId, targetOrganizationId },
      orderBy: { createdAt: "asc" },
    });
    return records.map((record: StaffAccessCopyLedger) => ({
      ...record,
      createdAt: fromDate(record.createdAt),
    }));
  }

  async reserve(row: StaffAccessCopyLedgerRow): Promise<boolean> {
    const { count } = await this.database.staffAccessCopyLedger.createMany({
      data: [{ ...row, createdAt: toDate(row.createdAt) }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async complete({
    id,
    targetId,
    targetProjectId,
  }: {
    id: string;
    targetId: string;
    targetProjectId: string;
  }): Promise<void> {
    await this.database.staffAccessCopyLedger.updateMany({
      where: { id },
      data: { targetId, targetProjectId },
    });
  }

  async release({ id }: { id: string }): Promise<void> {
    await this.database.staffAccessCopyLedger.deleteMany({ where: { id, targetId: null } });
  }
}
