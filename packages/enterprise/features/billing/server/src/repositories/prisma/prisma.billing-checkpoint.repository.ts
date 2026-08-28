import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { BillingCheckpointPort, type BillingCheckpoint } from "../../ports/billing-checkpoint.port";

/** Prisma implementation of the two-phase billing meter checkpoint. */
export class PrismaBillingCheckpointRepository extends BillingCheckpointPort {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaBillingCheckpointRepository {
    return new PrismaBillingCheckpointRepository(prisma);
  }

  async tryGetCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillingCheckpoint | null> {
    const row = await this.prisma.billingMeterCheckpoint.findUnique({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
    });
    if (!row) return null;
    return {
      lastReportedTotal: row.lastReportedTotal,
      pendingReportedTotal: row.pendingReportedTotal,
      consecutiveFailures: row.consecutiveFailures,
    };
  }

  async writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
  }): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        lastReportedTotal: params.lastReportedTotal,
        pendingReportedTotal: params.pendingReportedTotal,
      },
      update: {
        pendingReportedTotal: params.pendingReportedTotal,
      },
    });
  }

  async confirm(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
  }): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        lastReportedTotal: params.lastReportedTotal,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      },
      update: {
        lastReportedTotal: params.lastReportedTotal,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      },
    });
  }

  async clearPendingAndIncrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void> {
    await this.prisma.billingMeterCheckpoint.update({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      data: {
        pendingReportedTotal: null,
        consecutiveFailures: params.consecutiveFailures,
      },
    });
  }

  async incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    consecutiveFailures: number;
  }): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        lastReportedTotal: params.lastReportedTotal,
        pendingReportedTotal: params.pendingReportedTotal,
        consecutiveFailures: params.consecutiveFailures,
      },
      update: {
        consecutiveFailures: params.consecutiveFailures,
      },
    });
  }
}
