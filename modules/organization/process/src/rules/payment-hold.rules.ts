import type { Plan } from "@langwatch/entitlement-contract";
import {
  type LimitCheckResult,
  MemberAdditionsHeldForPaymentError,
  MemberSeatLimitReachedError,
} from "@langwatch/organization-contract";

type HoldPlan = Pick<Plan, "additionsHeldForPayment" | "overrideAddingLimitations">;

/**
 * True while the plan holds additions for an unpaid invoice
 * (enterprise/modules/billing/specs/payment-recovery.feature). An operator's lift still applies.
 */
export function isAdditionsHeldForPayment(plan: HoldPlan): boolean {
  return plan.additionsHeldForPayment === true && plan.overrideAddingLimitations !== true;
}

/** Refuses a new member or seat while the plan holds additions for an unpaid invoice. */
export function assertAdditionsNotHeldForPayment(plan: HoldPlan): void {
  if (isAdditionsHeldForPayment(plan)) throw new MemberAdditionsHeldForPaymentError();
}

/** A seat-taking write refuses a check that did not allow it, naming an unpaid invoice's hold. */
export function assertSeatFree(result: LimitCheckResult): void {
  if (result.allowed) return;
  if (result.heldForPayment === true) throw new MemberAdditionsHeldForPaymentError();
  throw new MemberSeatLimitReachedError({
    meta: { limitType: result.limitType, current: result.current, max: result.max },
  });
}
