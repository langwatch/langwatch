// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import { OverPlanRepository, type OverPlanMark } from "../over-plan.repository.ts";
import type { BillingSubscriptionRecord } from "../subscription.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The over-plan columns on the shared store's subscription rows, conditional like the Prisma twin. */
export class MemoryOverPlanRepository extends OverPlanRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryOverPlanRepository {
    return new MemoryOverPlanRepository(store);
  }

  async mark({ subscriptionId, since }: { subscriptionId: string; since: Instant }): Promise<void> {
    const index = this.store.subscriptions.findIndex((record) => record.id === subscriptionId);
    const record = this.store.subscriptions[index];
    if (!record) return;
    this.store.subscriptions[index] = { ...record, overPlanSince: since, overPlanEndedAt: null };
  }

  async end({
    subscriptionId,
    endedAt,
  }: {
    subscriptionId: string;
    endedAt: Instant;
  }): Promise<boolean> {
    const index = this.store.subscriptions.findIndex((record) => record.id === subscriptionId);
    const record = this.store.subscriptions[index];
    if (!record || !isOpen(record)) return false;
    this.store.subscriptions[index] = { ...record, overPlanEndedAt: endedAt };
    return true;
  }

  async findOpen(): Promise<OverPlanMark[]> {
    return this.marks(() => true).toSorted(
      (a, b) => a.since.epochMilliseconds - b.since.epochMilliseconds,
    );
  }

  async findOpenForOrganization(organizationId: string): Promise<OverPlanMark[]> {
    return this.marks((record) => record.organizationId === organizationId).toSorted(
      (a, b) => b.since.epochMilliseconds - a.since.epochMilliseconds,
    );
  }

  private marks(matches: (record: BillingSubscriptionRecord) => boolean): OverPlanMark[] {
    return this.store.subscriptions.filter(matches).flatMap((record) =>
      isOpen(record) && record.overPlanSince
        ? [
            {
              subscriptionId: record.id,
              organizationId: record.organizationId,
              since: record.overPlanSince,
            },
          ]
        : [],
    );
  }
}

function isOpen(record: BillingSubscriptionRecord): boolean {
  return !!record.overPlanSince && !record.overPlanEndedAt;
}
