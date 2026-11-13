/** The Postgres backend of the organization copy ledger: rows are only ever added and read. */
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

  async record(row: StaffAccessCopyLedgerRow): Promise<boolean> {
    const { count } = await this.database.staffAccessCopyLedger.createMany({
      data: [{ ...row, createdAt: toDate(row.createdAt) }],
      skipDuplicates: true,
    });
    return count === 1;
  }
}
