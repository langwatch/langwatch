import type { PrismaClient } from "@prisma/client";

/** A measured storage hour, as needed by the reporting command. */
export interface StorageUsageHour {
  megabytes: number;
  /** The durable per-hour idempotency cursor — null until reported to Stripe. */
  reportedAt: Date | null;
}

/**
 * Read/stamp access to the durable `StorageUsageHourly` measurement rows
 * (ADR-027). The reporting command reads one hour to decide whether to report
 * it, and stamps `reportedAt` once Stripe has accepted it — the stamp is the
 * cursor that guarantees each hour is billed exactly once.
 */
export interface StorageUsageHourlyRepository {
  findHour(params: {
    organizationId: string;
    sealedHour: Date;
  }): Promise<StorageUsageHour | null>;

  markReported(params: {
    organizationId: string;
    sealedHour: Date;
    reportedAt: Date;
  }): Promise<void>;
}

export class PrismaStorageUsageHourlyRepository
  implements StorageUsageHourlyRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findHour(params: {
    organizationId: string;
    sealedHour: Date;
  }): Promise<StorageUsageHour | null> {
    const row = await this.prisma.storageUsageHourly.findUnique({
      where: {
        organizationId_sealedHour: {
          organizationId: params.organizationId,
          sealedHour: params.sealedHour,
        },
      },
      select: { megabytes: true, reportedAt: true },
    });
    return row ?? null;
  }

  async markReported(params: {
    organizationId: string;
    sealedHour: Date;
    reportedAt: Date;
  }): Promise<void> {
    await this.prisma.storageUsageHourly.update({
      where: {
        organizationId_sealedHour: {
          organizationId: params.organizationId,
          sealedHour: params.sealedHour,
        },
      },
      data: { reportedAt: params.reportedAt },
    });
  }
}
