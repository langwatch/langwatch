import type { PrismaClient } from "@prisma/client";

import type {
  HourlySample,
  StorageUsageHourlyRepository,
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
