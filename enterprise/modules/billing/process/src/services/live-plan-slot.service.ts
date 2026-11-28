// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  findLivePlanConflicts,
  holdsLivePlanSlot,
  SubscriptionAlreadyActiveError,
  type SubscriptionWrite,
  writtenPlanSlots,
} from "@langwatch/enterprise-billing-contract";

import type { BillingSubscriptionRepository } from "../repositories/subscription.repository.ts";

type LivePlanSlotOptions = {
  subscriptions: Pick<BillingSubscriptionRepository, "findPlanSlots" | "findLivePlanHolders">;
};

/** The one live Stripe-backed plan an organization holds, asked before another module writes. */
export class LivePlanSlotService {
  static create(options: LivePlanSlotOptions): LivePlanSlotService {
    return new LivePlanSlotService(options);
  }

  private readonly subscriptions: LivePlanSlotOptions["subscriptions"];

  private constructor(options: LivePlanSlotOptions) {
    this.subscriptions = options.subscriptions;
  }

  /** Refuses writes that would leave an organization a second live plan, naming its live rows. */
  async assertWriteAllowed({ writes }: { writes: readonly SubscriptionWrite[] }): Promise<void> {
    const ids = writes.flatMap((write) => (write.id === undefined ? [] : [write.id]));
    const stored = ids.length > 0 ? await this.subscriptions.findPlanSlots({ ids }) : [];
    const written = writtenPlanSlots({ stored, writes });
    const organizationIds = [
      ...new Set(written.filter(holdsLivePlanSlot).map((row) => row.organizationId)),
    ];
    if (organizationIds.length === 0) return;
    const rows = await this.subscriptions.findLivePlanHolders({ organizationIds });
    const [conflict] = findLivePlanConflicts({ rows, written });
    if (conflict) throw new SubscriptionAlreadyActiveError(conflict);
  }
}
