// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  DuplicateSubscriptionsReportRepository,
  type SubscriptionReportRow,
} from "../duplicate-subscriptions-report.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/** The report's one SELECT, over the subscriptions the store already holds. */
export class MemoryDuplicateSubscriptionsReportRepository extends DuplicateSubscriptionsReportRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryDuplicateSubscriptionsReportRepository {
    return new MemoryDuplicateSubscriptionsReportRepository(store);
  }

  async findByStatus(status: string): Promise<SubscriptionReportRow[]> {
    return this.store.subscriptions
      .filter((subscription) => subscription.status === status)
      .map((subscription) => ({
        id: subscription.id,
        organizationId: subscription.organizationId,
        plan: subscription.plan,
        status: subscription.status,
        createdAt: subscription.createdAt,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      }));
  }
}
