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

  /**
   * Inserts a measured hour, doing nothing if the (org, hour) row already
   * exists (ON CONFLICT DO NOTHING). Idempotent so the dispatcher can re-measure
   * a hour across pods/restarts without ever double-counting or clobbering a
   * row that may already be reported.
   */
  recordHour(params: {
    organizationId: string;
    sealedHour: Date;
    megabytes: number;
  }): Promise<void>;

  /**
   * The latest sealed hour already measured for an organization, or null if it
   * has none. The dispatcher's cursor — read per run so it survives restarts
   * and stays correct across pods without in-memory state.
   */
  getLastMeasuredHour(params: { organizationId: string }): Promise<Date | null>;
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

  async recordHour(params: {
    organizationId: string;
    sealedHour: Date;
    megabytes: number;
  }): Promise<void> {
    await this.prisma.storageUsageHourly.createMany({
      data: [
        {
          organizationId: params.organizationId,
          sealedHour: params.sealedHour,
          megabytes: params.megabytes,
        },
      ],
      skipDuplicates: true,
    });
  }

  async getLastMeasuredHour(params: {
    organizationId: string;
  }): Promise<Date | null> {
    const row = await this.prisma.storageUsageHourly.findFirst({
      where: { organizationId: params.organizationId },
      orderBy: { sealedHour: "desc" },
      select: { sealedHour: true },
    });
    return row?.sealedHour ?? null;
  }
}
