/** The partial unique index that holds an organization to one live Stripe-backed plan. */
export const ONE_LIVE_PLAN_INDEX = "Subscription_one_live_stripe_plan_key";

/** Tiered plans stay outside the index: a paid seat checkout goes live before it retires one. */
const TIERED_PLANS: readonly string[] = [
  "LAUNCH",
  "ACCELERATE",
  "LAUNCH_ANNUAL",
  "ACCELERATE_ANNUAL",
  "PRO",
  "GROWTH",
];

/**
 * Whether a stored subscription row takes the organization's one live plan slot, as the index
 * in 20261127180500_subscription_one_live_stripe_plan reads it.
 */
export function holdsLivePlanSlot(row: Record<string, unknown>): boolean {
  return (
    row.status === "ACTIVE" &&
    typeof row.stripeSubscriptionId === "string" &&
    !TIERED_PLANS.includes(String(row.plan))
  );
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
