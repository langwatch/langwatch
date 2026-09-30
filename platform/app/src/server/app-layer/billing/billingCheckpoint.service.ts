import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Checkpoint data for two-phase billing meter protocol.
 */
export interface BillingCheckpoint {
  lastReportedTotal: number;
  pendingReportedTotal: number | null;
  consecutiveFailures: number;
}

/** What names one checkpoint: the organization, the month and the meter. */
export interface BillingCheckpointKey {
  organizationId: string;
  billingMonth: string;
  /** The Stripe meter event name the running total belongs to. */
  meter: string;
}

/**
 * Service for managing billing meter checkpoints.
 *
 * Encapsulates the two-phase checkpoint protocol used by ReportUsageForMonthCommand:
 * 1. writeIntent — sets pendingReportedTotal before calling Stripe
 * 2. confirm — promotes pending to lastReportedTotal, clears pending, resets failures
 *
 * Also handles failure tracking (consecutiveFailures) for circuit-breaker logic.
 *
 * One checkpoint per meter: each meter reports its own running total in its
 * own unit, and a failure on one must not trip the other's breaker.
 */
export interface BillingCheckpointService {
  getCheckpoint(
    params: BillingCheckpointKey,
  ): Promise<BillingCheckpoint | null>;

  writeIntent(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
      pendingReportedTotal: number;
    },
  ): Promise<void>;

  confirm(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
    },
  ): Promise<void>;

  clearPendingAndIncrementFailures(
    params: BillingCheckpointKey & {
      consecutiveFailures: number;
    },
  ): Promise<void>;

  incrementFailures(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
      pendingReportedTotal: number;
      consecutiveFailures: number;
    },
  ): Promise<void>;
}

function whereKey(params: BillingCheckpointKey) {
  return {
    organizationId_billingMonth_meter: {
      organizationId: params.organizationId,
      billingMonth: params.billingMonth,
      meter: params.meter,
    },
  };
}

/**
 * Prisma-backed billing checkpoint service.
 */
export class PrismaBillingCheckpointService
  implements BillingCheckpointService
{
  constructor(private readonly prisma: PrismaClient) {}

  async getCheckpoint(
    params: BillingCheckpointKey,
  ): Promise<BillingCheckpoint | null> {
    const row = await this.prisma.billingMeterCheckpoint.findUnique({
      where: whereKey(params),
    });
    if (!row) return null;
    return {
      lastReportedTotal: row.lastReportedTotal,
      pendingReportedTotal: row.pendingReportedTotal,
      consecutiveFailures: row.consecutiveFailures,
    };
  }

  async writeIntent(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
      pendingReportedTotal: number;
    },
  ): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: whereKey(params),
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        meter: params.meter,
        lastReportedTotal: params.lastReportedTotal,
        pendingReportedTotal: params.pendingReportedTotal,
      },
      update: {
        pendingReportedTotal: params.pendingReportedTotal,
      },
    });
  }

  async confirm(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
    },
  ): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: whereKey(params),
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        meter: params.meter,
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

  async clearPendingAndIncrementFailures(
    params: BillingCheckpointKey & {
      consecutiveFailures: number;
    },
  ): Promise<void> {
    await this.prisma.billingMeterCheckpoint.update({
      where: whereKey(params),
      data: {
        pendingReportedTotal: null,
        consecutiveFailures: params.consecutiveFailures,
      },
    });
  }

  async incrementFailures(
    params: BillingCheckpointKey & {
      lastReportedTotal: number;
      pendingReportedTotal: number;
      consecutiveFailures: number;
    },
  ): Promise<void> {
    await this.prisma.billingMeterCheckpoint.upsert({
      where: whereKey(params),
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        meter: params.meter,
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
