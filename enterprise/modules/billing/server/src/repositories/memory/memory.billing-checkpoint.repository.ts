// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type BillingCheckpoint,
  BillingCheckpointPort,
} from "../../ports/billing-checkpoint.port.ts";
import { MemoryBillingStore } from "./memory-billing.store.ts";

/** The state a month starts in, before the roll-up has reported anything. */
const UNREPORTED: BillingCheckpoint = {
  lastReportedTotal: 0,
  pendingReportedTotal: null,
  consecutiveFailures: 0,
};

/**
 * The two-phase meter checkpoint, held in a map keyed by organization month.
 * Absent means never reported, which is what the Prisma twin's null says.
 */
export class MemoryBillingCheckpointRepository extends BillingCheckpointPort {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingCheckpointRepository {
    return new MemoryBillingCheckpointRepository(store);
  }

  async tryGetCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillingCheckpoint | null> {
    return this.store.checkpoints.get(MemoryBillingStore.checkpointKey(params)) ?? null;
  }

  async writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
  }): Promise<void> {
    const current = await this.tryGetCheckpoint(params);
    this.write(params, {
      lastReportedTotal: current?.lastReportedTotal ?? params.lastReportedTotal,
      pendingReportedTotal: params.pendingReportedTotal,
      consecutiveFailures: current?.consecutiveFailures ?? UNREPORTED.consecutiveFailures,
    });
  }

  async confirm(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
  }): Promise<void> {
    this.write(params, {
      lastReportedTotal: params.lastReportedTotal,
      pendingReportedTotal: null,
      consecutiveFailures: 0,
    });
  }

  async clearPendingAndIncrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    consecutiveFailures: number;
  }): Promise<void> {
    const current = await this.tryGetCheckpoint(params);
    this.write(params, {
      lastReportedTotal: current?.lastReportedTotal ?? UNREPORTED.lastReportedTotal,
      pendingReportedTotal: null,
      consecutiveFailures: params.consecutiveFailures,
    });
  }

  async incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    consecutiveFailures: number;
  }): Promise<void> {
    this.write(params, {
      lastReportedTotal: params.lastReportedTotal,
      pendingReportedTotal: params.pendingReportedTotal,
      consecutiveFailures: params.consecutiveFailures,
    });
  }

  private write(
    key: { organizationId: string; billingMonth: string },
    checkpoint: BillingCheckpoint,
  ): void {
    this.store.checkpoints.set(MemoryBillingStore.checkpointKey(key), checkpoint);
  }
}
