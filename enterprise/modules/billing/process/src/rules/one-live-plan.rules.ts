import {
  findLivePlanConflicts,
  type PlanSlotRow,
  SubscriptionAlreadyActiveError,
} from "@langwatch/enterprise-billing-contract";

/** The partial unique index that holds an organization to one live Stripe-backed plan. */
const ONE_LIVE_PLAN_INDEX = "Subscription_one_live_stripe_plan_key";

/** Refuses a written row that would take a slot another row of its organization holds. */
export function refuseSecondLivePlan({
  rows,
  written,
}: {
  rows: readonly PlanSlotRow[];
  written: PlanSlotRow;
}): void {
  const [conflict] = findLivePlanConflicts({ rows, written: [written] });
  if (conflict) throw new SubscriptionAlreadyActiveError(conflict);
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
