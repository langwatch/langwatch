import type { PrismaClient } from "@prisma/client";

import type {
  HourlySample,
  StorageUsageHourlyRepository,
  UnreportedHour,
} from "./storage-usage-hourly.repository";

export class PrismaStorageUsageHourlyRepository
  implements StorageUsageHourlyRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async getLastSampledHour({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Date | null> {
    const row = await this.prisma.storageUsageHourly.findFirst({
      where: { organizationId },
      orderBy: { sealedHour: "desc" },
      select: { sealedHour: true },
    });
    return row?.sealedHour ?? null;
  }

  async findUnreportedHours({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<UnreportedHour[]> {
    return await this.prisma.storageUsageHourly.findMany({
      where: { organizationId, reportedAt: null },
      orderBy: { sealedHour: "asc" },
      take: limit,
      select: { sealedHour: true, megabytes: true },
    });
  }

  async markReported({
    organizationId,
    sealedHour,
    reportedAt,
  }: {
    organizationId: string;
    sealedHour: Date;
    reportedAt: Date;
  }): Promise<void> {
    await this.prisma.storageUsageHourly.update({
      where: { organizationId_sealedHour: { organizationId, sealedHour } },
      data: { reportedAt },
    });
  }

  async recordHours({
    organizationId,
    rows,
  }: {
    organizationId: string;
    rows: HourlySample[];
  }): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.storageUsageHourly.createMany({
      data: rows.map((row) => ({
        organizationId,
        sealedHour: row.sealedHour,
        megabytes: row.megabytes,
      })),
      skipDuplicates: true,
    });
  }
}
