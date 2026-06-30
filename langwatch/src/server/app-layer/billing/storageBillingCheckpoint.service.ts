import type { PrismaClient } from "@prisma/client";

/**
 * Checkpoint data for the storage-meter two-phase reporting protocol.
 *
 * Deliberately a sibling of BillingCheckpoint (billable-events) rather than a
 * shared type: ADR-027 storage billing owns its own persistence so the
 * billable-events checkpoint is never altered to make room for it.
 */
export interface StorageBillingCheckpoint {
  lastReportedTotal: number;
  pendingReportedTotal: number | null;
  consecutiveFailures: number;
}

/**
 * Service for managing the STORAGE_GB meter's reporting checkpoint, backed by
 * the dedicated StorageBillingCheckpoint table.
 *
 * Mirrors the two-phase protocol of BillingCheckpointService:
 * 1. writeIntent — sets pendingReportedTotal before calling Stripe
 * 2. confirm — promotes pending to lastReportedTotal, clears pending, resets failures
 *
 * Also tracks consecutiveFailures for circuit-breaker logic. Keeping a separate
 * service + table (not a meterName discriminator on the shared one) means the
 * storage meter never touches BillingMeterCheckpoint's live unique index.
 */
export interface StorageBillingCheckpointService {
  getCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<StorageBillingCheckpoint | null>;

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

  /**
   * Breaker-only failure record (ADR-027 Phase 3). Storage reporting is
   * per-hour and idempotent via the `StorageUsageHourly.reportedAt` cursor, so
   * it does not use the lastReportedTotal/pendingReportedTotal accumulator —
   * only the consecutive-failure counter that trips the circuit breaker. Upsert
   * so the first failure on a fresh (org, month) creates the row.
   */
  recordFailure(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void>;

  /** Clears the consecutive-failure counter after a successful report. */
  recordSuccess(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<void>;
}

/**
 * Prisma-backed storage billing checkpoint service.
 */
export class PrismaStorageBillingCheckpointService
  implements StorageBillingCheckpointService
{
  constructor(private readonly prisma: PrismaClient) {}

  async getCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<StorageBillingCheckpoint | null> {
    const row = await this.prisma.storageBillingCheckpoint.findUnique({
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
    await this.prisma.storageBillingCheckpoint.upsert({
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
    await this.prisma.storageBillingCheckpoint.upsert({
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
    await this.prisma.storageBillingCheckpoint.update({
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
    await this.prisma.storageBillingCheckpoint.upsert({
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

  async recordFailure(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void> {
    await this.prisma.storageBillingCheckpoint.upsert({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        consecutiveFailures: params.consecutiveFailures,
      },
      update: {
        consecutiveFailures: params.consecutiveFailures,
      },
    });
  }

  async recordSuccess(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<void> {
    await this.prisma.storageBillingCheckpoint.upsert({
      where: {
        organizationId_billingMonth: {
          organizationId: params.organizationId,
          billingMonth: params.billingMonth,
        },
      },
      create: {
        organizationId: params.organizationId,
        billingMonth: params.billingMonth,
        consecutiveFailures: 0,
      },
      update: {
        consecutiveFailures: 0,
      },
    });
  }
}
