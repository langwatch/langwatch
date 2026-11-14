/** The Postgres backend of the staff access trail: rows are only ever added and read. */
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient, StaffAccessEvent } from "@langwatch/prisma-client/generated";
import { fromDate, toDate } from "@langwatch/time";

import type {
  StaffAccessEventRepository,
  StaffAccessEventRow,
} from "../staff-access.repository.ts";

type EventDatabase = Pick<PrismaClient, "staffAccessEvent">;

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
