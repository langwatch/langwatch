import type { Plan } from "@langwatch/entitlement-contract";
import { MemberAdditionsHeldForPaymentError } from "@langwatch/organization-contract";

/**
 * Refuses a new member or seat while the plan holds additions for an unpaid invoice
 * (enterprise/modules/billing/specs/payment-recovery.feature). An operator's lift still applies.
 */
export function assertAdditionsNotHeldForPayment(
  plan: Pick<Plan, "additionsHeldForPayment" | "overrideAddingLimitations">,
): void {
  if (plan.additionsHeldForPayment === true && plan.overrideAddingLimitations !== true) {
    throw new MemberAdditionsHeldForPaymentError();
  }
}
