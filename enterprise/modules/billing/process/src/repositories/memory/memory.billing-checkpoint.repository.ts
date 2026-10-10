// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type BillingCheckpoint,
  BillingCheckpointRepository,
} from "../billing-checkpoint.repository.ts";
import { MemoryBillingStore } from "./memory.billing.store.ts";

/** The state a month starts in, before the roll-up has reported anything. */
const UNREPORTED: BillingCheckpoint = {
  lastReportedTotal: 0,
  pendingReportedTotal: null,
  consecutiveFailures: 0,
  lastCountedEventId: null,
};

/**
 * The two-phase meter checkpoint, held in a map keyed by organization month.
 * Absent means never reported, which is what the Prisma twin's null says.
 */
export class MemoryBillingCheckpointRepository extends BillingCheckpointRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingCheckpointRepository {
    return new MemoryBillingCheckpointRepository(store);
  }

  async findCheckpoint(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
  }): Promise<BillingCheckpoint | null> {
    return this.store.checkpoints.get(MemoryBillingStore.checkpointKey(params)) ?? null;
  }

  async writeIntent(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    lastReportedTotal: number;
    pendingReportedTotal: number;
    countedEventId?: string;
  }): Promise<void> {
    const current = await this.findCheckpoint(params);
    this.write(params, {
      lastReportedTotal: current?.lastReportedTotal ?? params.lastReportedTotal,
      pendingReportedTotal: params.pendingReportedTotal,
      consecutiveFailures: current?.consecutiveFailures ?? UNREPORTED.consecutiveFailures,
      lastCountedEventId: params.countedEventId,
    });
  }

  async recordCountedEvent(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
    countedEventId: string;
  }): Promise<void> {
    const current = (await this.findCheckpoint(params)) ?? UNREPORTED;
    this.write(params, { ...current, lastCountedEventId: params.countedEventId });
  }

  async confirm(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
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
    meter: string;
    consecutiveFailures: number;
  }): Promise<void> {
    const current = await this.findCheckpoint(params);
    this.write(params, {
      lastReportedTotal: current?.lastReportedTotal ?? UNREPORTED.lastReportedTotal,
      pendingReportedTotal: null,
      consecutiveFailures: params.consecutiveFailures,
    });
  }

  async incrementFailures(params: {
    organizationId: string;
    billingMonth: string;
    meter: string;
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

  /** Keeps the stored month_counted cursor unless the write names a new one. */
  private write(
    key: { organizationId: string; billingMonth: string; meter: string },
    checkpoint: Omit<BillingCheckpoint, "lastCountedEventId"> & {
      lastCountedEventId?: string | undefined;
    },
  ): void {
    const storeKey = MemoryBillingStore.checkpointKey(key);
    const lastCountedEventId =
      checkpoint.lastCountedEventId ??
      this.store.checkpoints.get(storeKey)?.lastCountedEventId ??
      null;
    this.store.checkpoints.set(storeKey, { ...checkpoint, lastCountedEventId });
  }
}
