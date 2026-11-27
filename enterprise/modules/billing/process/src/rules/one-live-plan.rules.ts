import {
  isTieredPlan,
  SubscriptionAlreadyActiveError,
} from "@langwatch/enterprise-billing-contract";

/** The partial unique index that holds an organization to one live Stripe-backed plan. */
export const ONE_LIVE_PLAN_INDEX = "Subscription_one_live_stripe_plan_key";

type PlanSlotRow = {
  id: string;
  organizationId: string;
  status: string;
  plan: string;
  stripeSubscriptionId: string | null;
};

/**
 * Whether the row takes the organization's one live plan slot: ACTIVE, linked to Stripe and not
 * a tiered plan (a seat checkout goes live before it retires one).
 */
export function holdsLivePlanSlot(row: PlanSlotRow): boolean {
  return row.status === "ACTIVE" && row.stripeSubscriptionId !== null && !isTieredPlan(row.plan);
}

/** Refuses a written row that would take a slot another row of its organization holds. */
export function refuseSecondLivePlan({
  rows,
  written,
}: {
  rows: readonly PlanSlotRow[];
  written: PlanSlotRow;
}): void {
  if (!holdsLivePlanSlot(written)) return;
  const taken = rows.some(
    (row) =>
      row.id !== written.id &&
      row.organizationId === written.organizationId &&
      holdsLivePlanSlot(row),
  );
  if (taken) throw new SubscriptionAlreadyActiveError();
}

/** Prisma's unique violation on the one-live-plan index, which it names in the error's meta. */
export function isSecondLivePlanViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code !== "P2002") return false;
  let meta: string;
  try {
    meta = JSON.stringify((error as { meta?: unknown }).meta) ?? "";
  } catch {
    return false;
  }
  return meta.includes(ONE_LIVE_PLAN_INDEX);
}
