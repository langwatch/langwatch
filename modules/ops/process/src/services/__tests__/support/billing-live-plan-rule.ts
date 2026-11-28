/**
 * Billing's one-live-plan rule as a peer stand-in: billing's own contract rule over the rows the
 * test's store holds. `landsAfterCheck` runs once, after the first answer is decided, as another
 * writer landing between the check and the write.
 */
import {
  type BillingApi,
  findLivePlanConflicts,
  type PlanSlotRow,
  SubscriptionAlreadyActiveError,
  writtenPlanSlots,
} from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

export function billingLivePlanRule({
  rows,
  landsAfterCheck,
}: {
  rows: () => Promise<PlanSlotRow[]>;
  landsAfterCheck?: () => Promise<void>;
}): BillingApi {
  let pending = landsAfterCheck;
  return createApiFixture<BillingApi>({
    assertSubscriptionWriteAllowed: async ({ writes }) => {
      const stored = await rows();
      const [conflict] = findLivePlanConflicts({
        rows: stored,
        written: writtenPlanSlots({ stored, writes }),
      });
      const lands = pending;
      pending = undefined;
      await lands?.();
      if (conflict) throw new SubscriptionAlreadyActiveError(conflict);
    },
  });
}

/** A stored admin row as the rule reads it. */
export function planSlotOf(row: Record<string, unknown>): PlanSlotRow {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    status: String(row.status),
    plan: String(row.plan),
    stripeSubscriptionId:
      typeof row.stripeSubscriptionId === "string" ? row.stripeSubscriptionId : null,
  };
}
