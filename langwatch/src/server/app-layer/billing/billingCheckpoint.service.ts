import type { PrismaClient } from "@prisma/client";

/**
 * Checkpoint data for two-phase billing meter protocol.
 */
export interface BillingCheckpoint {
  lastReportedTotal: number;
  pendingReportedTotal: number | null;
  consecutiveFailures: number;
}

/**
 * Service for managing billing meter checkpoints.
 *
 * Encapsulates the two-phase checkpoint protocol used by ReportUsageForMonthCommand:
 * 1. writeIntent — sets pendingReportedTotal before calling Stripe
 * 2. confirm — promotes pending to lastReportedTotal, clears pending, resets failures
 *
 * Also handles failure tracking (consecutiveFailures) for circuit-breaker logic.
 */
export interface BillingCheckpointService {
  getCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillingCheckpoint | null>;

  writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
  }): Promise<void>;

  confirm(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
  }): Promise<void>;

  clearPendingAndIncrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void>;

  incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    consecutiveFailures: number;
  }): Promise<void>;
}

/**
 * Prisma-backed billing checkpoint service.
 */
export class PrismaBillingCheckpointService implements BillingCheckpointService {
  constructor(private readonly prisma: PrismaClient) {}

  async getCheckpoint(params: {
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
